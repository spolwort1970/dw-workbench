"""
Linear flow execution engine — Phase 3B.

Supported processors: set-payload, transform, set-variable, logger, flow-reference, choice, try, for-each, raise-error.
"""

import copy
import json
import re
from typing import Any
from app.models.schemas import SimEvent, NodeTrace, ProcessorDef, FlowDef
from app.services.dw_runner import run_dw

_SUPPORTED   = {"set-payload", "transform", "set-variable", "logger", "flow-reference", "choice", "try", "raise-error", "for-each"}
_SCOPE_TYPES: set[str] = set()

SubTraces = dict[str, list[NodeTrace]]


# ── DWValue evaluation ────────────────────────────────────────────────────────

def evaluate_dw_value(dw_val: dict, event: SimEvent) -> tuple[Any, str]:
    """
    Evaluate a DWValue {"mode": "expression"|"literal", "content": str}.
    Returns (value, error).
    """
    if not dw_val:
        return (None, "")
    mode    = dw_val.get("mode", "literal")
    content = dw_val.get("content", "")
    if mode == "literal":
        return (content, "")
    script = f"%dw 2.0\noutput application/json\n---\n{content}"
    result = run_dw(
        script=script,
        payload=event.payload,
        input_mime_type=event.mimeType,
        attributes=event.attributes,
        vars_=event.variables,
    )
    if not result["success"]:
        return (None, result["error"])
    try:
        return (json.loads(result["output"]), "")
    except Exception:
        return (result["output"], "")


def evaluate_expression(expression: str, event: SimEvent) -> tuple[Any, str]:
    """Evaluate a bare DW expression string against a SimEvent. Used by the debug evaluator."""
    script = f"%dw 2.0\noutput application/json\n---\n{expression}"
    result = run_dw(
        script=script,
        payload=event.payload,
        input_mime_type=event.mimeType,
        attributes=event.attributes,
        vars_=event.variables,
    )
    if not result["success"]:
        return (None, result["error"])
    try:
        return (json.loads(result["output"]), "")
    except Exception:
        return (result["output"], "")


# ── Individual processor runners ──────────────────────────────────────────────

def _run_set_payload(proc: ProcessorDef, event: SimEvent) -> tuple[SimEvent, list[str], str]:
    cfg   = proc.config
    value, err = evaluate_dw_value(cfg.get("value"), event)
    if err:
        return event, [], err
    mime = cfg.get("mimeType", "application/json")
    return event.model_copy(update={"payload": value, "mimeType": mime}), [], ""


def _run_transform(proc: ProcessorDef, event: SimEvent) -> tuple[SimEvent, list[str], str]:
    cfg     = proc.config
    outputs = cfg.get("outputs", [])
    current = event
    logs: list[str] = []

    for out in outputs:
        target = out.get("target", "payload")

        if target == "payload":
            script = out.get("script", "")
            if not script.strip():
                continue
            result = run_dw(
                script=script,
                payload=current.payload,
                input_mime_type=current.mimeType,
                attributes=current.attributes,
                vars_=current.variables,
            )
            if not result["success"]:
                return current, logs, result["error"]
            try:
                new_payload = json.loads(result["output"])
            except Exception:
                new_payload = result["output"]
            mime    = _detect_output_mime(script)
            current = current.model_copy(update={"payload": new_payload, "mimeType": mime})

        elif target == "variable":
            name = out.get("variableName", "").strip()
            if not name:
                continue
            val, err = evaluate_dw_value(out.get("value"), current)
            if err:
                return current, logs, f"variable '{name}': {err}"
            current = current.model_copy(update={"variables": {**current.variables, name: val}})

        elif target == "attributes":
            key = out.get("attributeKey", "").strip()
            if not key:
                continue
            val, err = evaluate_dw_value(out.get("value"), current)
            if err:
                return current, logs, f"attribute '{key}': {err}"
            current = current.model_copy(update={"attributes": {**current.attributes, key: val}})

    return current, logs, ""


def _detect_output_mime(script: str) -> str:
    m = re.search(r"output\s+([\w/+\-]+)", script)
    return m.group(1) if m else "application/json"


def _run_set_variable(proc: ProcessorDef, event: SimEvent) -> tuple[SimEvent, list[str], str]:
    cfg  = proc.config
    name = cfg.get("variableName", "").strip()
    if not name:
        return event, [], "Set Variable: variableName is empty"
    val, err = evaluate_dw_value(cfg.get("value"), event)
    if err:
        return event, [], err
    return event.model_copy(update={"variables": {**event.variables, name: val}}), [], ""


def _run_logger(proc: ProcessorDef, event: SimEvent) -> tuple[SimEvent, list[str], str]:
    cfg      = proc.config
    level    = cfg.get("level", "INFO")
    category = cfg.get("category", "")
    msg, err = evaluate_dw_value(cfg.get("message"), event)
    if err:
        return event, [], err
    prefix = f"[{level}]" + (f" [{category}]" if category else "")
    return event, [f"{prefix} {msg}"], ""


def _error_type_matches(handler_type: str, error: str) -> bool:
    """Check if the handler's error type matches the actual error string."""
    if not handler_type or handler_type.upper() == "ANY":
        return True
    return error.upper().startswith(handler_type.upper())


def _run_raise_error(proc: ProcessorDef, event: SimEvent) -> tuple[SimEvent, list[str], str]:
    error_type  = (proc.config.get("errorType") or "").strip()
    description = (proc.config.get("description") or "").strip()
    if not error_type:
        return event, [], "Raise Error: error type is required"
    error_msg = f"{error_type}: {description}" if description else error_type
    return event, [], error_msg


def _run_flow_reference(
    proc: ProcessorDef,
    event: SimEvent,
    all_flows: list[FlowDef],
    visited: set[str],
    sub_traces: SubTraces,
) -> tuple[SimEvent, list[str], str]:
    cfg            = proc.config
    flow_name_val  = cfg.get("flowName", {})
    target_name    = flow_name_val.get("content", "").strip() if isinstance(flow_name_val, dict) else ""

    if not target_name:
        return event, [], "Flow Reference: no flow name configured"
    if target_name in visited:
        return event, [], f"Flow Reference: recursive loop detected — '{target_name}' is already in the call stack"

    target_flow = next((f for f in all_flows if f.name == target_name), None)
    if not target_flow:
        return event, [], f"Flow Reference: flow '{target_name}' not found"

    result_event, sub_trace, nested_sub_traces, err = execute_flow(
        target_flow, all_flows, event, visited | {target_name}
    )
    sub_traces[target_flow.id] = sub_trace
    sub_traces.update(nested_sub_traces)

    logs = [f"[→ {target_name}] {n.displayName}: {'OK' if n.success else n.error}" for n in sub_trace]
    return result_event, logs, err


# ── For Each ──────────────────────────────────────────────────────────────────

def _run_for_each(
    proc: ProcessorDef,
    event: SimEvent,
    all_flows: list[FlowDef],
    visited: set[str],
    sub_traces: SubTraces,
) -> tuple[SimEvent, list[NodeTrace], str]:
    """
    Execute a for-each scope.
    - Evaluates the collection expression
    - Iterates in batches (batchSize, default 1)
    - Sets payload = current item, counter variable = 1-based index for each iteration
    - Runs the body processors for each item
    - Restores the original payload after completion (MuleSoft behaviour)
    - Variables/attributes set inside the loop persist after the loop
    Returns (final_event, flat_traces, error).
    """
    config           = proc.config
    collection_val   = config.get("collection", {})
    counter_var      = (config.get("counterVariableName") or "counter").strip()
    root_msg_var     = (config.get("rootMessageVariableName") or "rootMessage").strip()
    batch_size       = max(1, int(config.get("batchSize") or 1))
    body_procs       = config.get("processors", [])
    input_snapshot   = copy.deepcopy(event)

    # ── Evaluate collection ──
    collection, err = evaluate_dw_value(collection_val, event)
    if err:
        trace = NodeTrace(
            procId=proc.id, procType="for-each", displayName=proc.displayName,
            input=input_snapshot, output=copy.deepcopy(event),
            error=f"For Each: collection error: {err}", success=False,
        )
        return event, [trace], trace.error

    if not isinstance(collection, list):
        collection = list(collection.values()) if isinstance(collection, dict) else [collection]

    # ── Store rootMessage before loop (original payload + attributes) ──
    root_message = {"payload": copy.deepcopy(event.payload), "attributes": copy.deepcopy(event.attributes)}

    all_traces: list[NodeTrace] = []
    current = event.model_copy(update={
        "variables": {**event.variables, root_msg_var: root_message},
    })

    # ── Batch items ──
    batches = [collection[i:i + batch_size] for i in range(0, len(collection), batch_size)] if collection else []

    for batch_idx, batch in enumerate(batches):
        item    = batch[0] if batch_size == 1 else batch
        counter = batch_idx + 1

        # Set payload = item, counter variable, preserve everything else
        iter_event = current.model_copy(update={
            "payload":   item,
            "mimeType":  "application/json",
            "variables": {**current.variables, counter_var: counter},
        })

        iter_event, iter_traces, error = _run_processor_list(
            body_procs, iter_event, all_flows, visited, sub_traces
        )
        all_traces.extend(iter_traces)

        if error:
            fe_trace = NodeTrace(
                procId=proc.id, procType="for-each", displayName=proc.displayName,
                input=input_snapshot, output=copy.deepcopy(iter_event),
                logs=[f"✗ Error on iteration {counter}"], error=error, success=False,
            )
            return iter_event, [fe_trace] + all_traces, error

        # Carry forward variables/attributes but NOT payload (restored at end)
        current = current.model_copy(update={
            "variables":  iter_event.variables,
            "attributes": iter_event.attributes,
        })

    # ── Restore original payload after loop ──
    final_event = current.model_copy(update={
        "payload":  event.payload,
        "mimeType": event.mimeType,
    })

    fe_trace = NodeTrace(
        procId=proc.id, procType="for-each", displayName=proc.displayName,
        input=input_snapshot, output=copy.deepcopy(final_event),
        logs=[f"✓ Processed {len(batches)} iteration(s)"], success=True,
    )
    return final_event, [fe_trace] + all_traces, ""


# ── Shared inner processor-list runner ───────────────────────────────────────

def _run_processor_list(
    proc_defs: list,
    event: SimEvent,
    all_flows: list[FlowDef],
    visited: set[str],
    sub_traces: SubTraces,
) -> tuple[SimEvent, list[NodeTrace], str]:
    """
    Execute a flat list of processor defs (dicts or ProcessorDef objects).
    Handles nested choice/try scopes transparently.
    Returns (final_event, traces, error).
    """
    current = event
    traces: list[NodeTrace] = []

    for proc_def in proc_defs:
        proc = proc_def if isinstance(proc_def, ProcessorDef) else ProcessorDef(**proc_def)
        input_snapshot = copy.deepcopy(current)

        if proc.type == "for-each":
            new_event, scope_traces, error = _run_for_each(proc, current, all_flows, visited, sub_traces)
            traces.extend(scope_traces)
            if error:
                return new_event, traces, error
            current = new_event
            continue

        if proc.type == "choice":
            new_event, scope_traces, error = _run_choice(proc, current, all_flows, visited, sub_traces)
            traces.extend(scope_traces)
            if error:
                return new_event, traces, error
            current = new_event
            continue

        if proc.type == "try":
            new_event, scope_traces, error = _run_try(proc, current, all_flows, visited, sub_traces)
            traces.extend(scope_traces)
            if error:
                return new_event, traces, error
            current = new_event
            continue

        try:
            new_event, logs, error = execute_single_processor(proc, current, all_flows, visited, sub_traces)
        except Exception as exc:
            error, new_event, logs = f"Unexpected error: {exc}", current, []

        success = not bool(error)
        if success:
            current = new_event
        traces.append(NodeTrace(
            procId=proc.id, procType=proc.type, displayName=proc.displayName,
            input=input_snapshot, output=copy.deepcopy(current),
            logs=logs, error=error, success=success,
        ))
        if not success:
            return current, traces, error

    return current, traces, ""


# ── Choice ────────────────────────────────────────────────────────────────────

def _run_choice(
    proc: ProcessorDef,
    event: SimEvent,
    all_flows: list[FlowDef],
    visited: set[str],
    sub_traces: SubTraces,
) -> tuple[SimEvent, list[NodeTrace], str]:
    """
    Execute a choice processor.
    Returns (new_event, flat_traces, error).
    flat_traces = [choice_node_trace] + [inner_proc_traces...] + [skipped_traces...]
    """
    config  = proc.config
    routes  = config.get("routes", [])
    whens   = [r for r in routes if r.get("type") == "when"]
    default = next((r for r in routes if r.get("type") == "default"), None)
    input_snapshot = copy.deepcopy(event)

    # ── Find the first matching when, or fall back to default ──
    selected_route = None
    branch_log     = ""
    for i, route in enumerate(whens):
        val, err = evaluate_dw_value(route.get("expression", {}), event)
        if err:
            choice_trace = NodeTrace(
                procId=proc.id, procType="choice", displayName=proc.displayName,
                input=input_snapshot, output=copy.deepcopy(event),
                error=f"When {i + 1} condition error: {err}", success=False,
            )
            return event, [choice_trace], choice_trace.error
        if val:
            selected_route = route
            branch_log = f"When {i + 1} matched"
            break

    if selected_route is None and default:
        selected_route = default
        branch_log = "Default branch taken"

    if selected_route is None:
        branch_log = "No condition matched (no default)"

    # ── Execute selected branch ──
    current, inner_traces, error = _run_processor_list(
        (selected_route or {}).get("processors", []), event, all_flows, visited, sub_traces
    )
    if error:
        choice_trace = NodeTrace(
            procId=proc.id, procType="choice", displayName=proc.displayName,
            input=input_snapshot, output=copy.deepcopy(current),
            logs=[branch_log], error=error, success=False,
        )
        return current, [choice_trace] + inner_traces, error

    # ── Skipped traces for non-selected branches ──
    skipped: list[NodeTrace] = []
    for route in routes:
        if route is selected_route:
            continue
        for p in route.get("processors", []):
            inner_proc = ProcessorDef(**p)
            skipped.append(NodeTrace(
                procId=inner_proc.id, procType=inner_proc.type, displayName=inner_proc.displayName,
                input=copy.deepcopy(event), output=copy.deepcopy(event),
                logs=["ℹ Skipped (branch not selected)"], success=True, skipped=True,
            ))

    choice_trace = NodeTrace(
        procId=proc.id, procType="choice", displayName=proc.displayName,
        input=input_snapshot, output=copy.deepcopy(current),
        logs=[branch_log], success=True,
    )
    return current, [choice_trace] + inner_traces + skipped, ""


# ── Try ───────────────────────────────────────────────────────────────────────

def _run_try(
    proc: ProcessorDef,
    event: SimEvent,
    all_flows: list[FlowDef],
    visited: set[str],
    sub_traces: SubTraces,
) -> tuple[SimEvent, list[NodeTrace], str]:
    """
    Execute a try scope.
    Returns (new_event, flat_traces, error).
    flat_traces = [try_node_trace] + [body_traces...] + [handler_traces...]
    On error-continue: error is swallowed, execution continues.
    On error-propagate: error is re-raised after running handler processors.
    """
    config         = proc.config
    body_procs     = config.get("processors", [])
    error_handlers = config.get("errorHandlers", [])
    input_snapshot = copy.deepcopy(event)

    # ── Execute body ──
    current, body_traces, body_error = _run_processor_list(
        body_procs, event, all_flows, visited, sub_traces
    )

    if not body_error:
        try_trace = NodeTrace(
            procId=proc.id, procType="try", displayName=proc.displayName,
            input=input_snapshot, output=copy.deepcopy(current),
            logs=["✓ Try body completed successfully"], success=True,
        )
        return current, [try_trace] + body_traces, ""

    # ── Find matching error handler ──
    selected_handler = None
    for handler in error_handlers:
        h_config  = handler.get("config", {})
        h_type    = h_config.get("errorType", "ANY")
        when_expr = (h_config.get("when") or "").strip()
        if not _error_type_matches(h_type, body_error):
            continue
        if not when_expr:
            selected_handler = handler
            break
        val, err = evaluate_dw_value({"mode": "expression", "content": when_expr}, current)
        if err or val:
            selected_handler = handler
            break

    # ── Execute handler processors ──
    h_config      = (selected_handler or {}).get("config", {})
    log_exception = h_config.get("logException", True)
    handler_logs  = [f"[ERROR] Caught: {body_error}"] if log_exception and selected_handler else []

    handler_current, handler_traces, _ = _run_processor_list(
        h_config.get("processors", []), current, all_flows, visited, sub_traces
    )

    handler_type = (selected_handler or {}).get("type", "on-error-propagate")

    if handler_type == "on-error-continue":
        try_trace = NodeTrace(
            procId=proc.id, procType="try", displayName=proc.displayName,
            input=input_snapshot, output=copy.deepcopy(handler_current),
            logs=handler_logs + [f"⚠ Error caught and handled: {body_error}"], success=True,
        )
        return handler_current, [try_trace] + body_traces + handler_traces, ""
    else:
        try_trace = NodeTrace(
            procId=proc.id, procType="try", displayName=proc.displayName,
            input=input_snapshot, output=copy.deepcopy(handler_current),
            logs=handler_logs + [f"✗ Error propagated: {body_error}"], error=body_error, success=False,
        )
        return handler_current, [try_trace] + body_traces + handler_traces, body_error


# ── Public: execute one processor (used by both run and debug) ────────────────

def execute_single_processor(
    proc: ProcessorDef,
    event: SimEvent,
    all_flows: list[FlowDef],
    visited: set[str],
    sub_traces: SubTraces,
) -> tuple[SimEvent, list[str], str]:
    """
    Execute a single processor against the given event.
    Mutates sub_traces in place for any flow-reference calls.
    Returns (new_event, logs, error).
    """
    if proc.type in _SCOPE_TYPES:
        return event, [f"ℹ Scope '{proc.displayName}' skipped — not supported in linear execution (Phase 3B)"], ""

    if proc.type not in _SUPPORTED:
        return event, [], f"Unsupported processor type: {proc.type}"

    if proc.type == "set-payload":
        return _run_set_payload(proc, event)
    if proc.type == "transform":
        return _run_transform(proc, event)
    if proc.type == "set-variable":
        return _run_set_variable(proc, event)
    if proc.type == "logger":
        return _run_logger(proc, event)
    if proc.type == "flow-reference":
        return _run_flow_reference(proc, event, all_flows, visited, sub_traces)
    if proc.type == "raise-error":
        return _run_raise_error(proc, event)

    return event, [], f"Unsupported processor type: {proc.type}"


# ── Full flow execution (run mode) ────────────────────────────────────────────

def execute_flow(
    flow: FlowDef,
    all_flows: list[FlowDef],
    initial_event: SimEvent,
    visited: set[str] | None = None,
) -> tuple[SimEvent, list[NodeTrace], SubTraces, str]:
    """
    Execute a flow linearly.
    If the main processor chain raises an unhandled error, route it through
    the flow-level errorHandlers (same semantics as a Try scope error handler).
    Returns (final_event, trace, sub_traces, top_level_error).
    """
    if visited is None:
        visited = {flow.name}

    event      = copy.deepcopy(initial_event)
    sub_traces: SubTraces = {}

    event, trace, error = _run_processor_list(flow.processors, event, all_flows, visited, sub_traces)

    if not error or not flow.errorHandlers:
        return event, trace, sub_traces, error

    # ── Route through flow-level error handlers ──
    selected_handler: ProcessorDef | None = None
    for handler in flow.errorHandlers:
        h_config  = handler.config
        h_type    = h_config.get("errorType", "ANY")
        when_expr = (h_config.get("when") or "").strip()
        if not _error_type_matches(h_type, error):
            continue
        if not when_expr:
            selected_handler = handler
            break
        val, err = evaluate_dw_value({"mode": "expression", "content": when_expr}, event)
        if err or val:
            selected_handler = handler
            break

    if selected_handler is None:
        return event, trace, sub_traces, error

    h_config      = selected_handler.config
    log_exception = h_config.get("logException", True)
    handler_logs  = [f"[ERROR] Caught: {error}"] if log_exception else []

    handler_current, handler_traces, _ = _run_processor_list(
        h_config.get("processors", []), event, all_flows, visited, sub_traces
    )

    if selected_handler.type == "on-error-continue":
        return handler_current, trace + handler_traces, sub_traces, ""
    else:
        # on-error-propagate: run handlers but re-raise the error
        _ = handler_logs  # already logged above — attach to first handler trace if any
        return handler_current, trace + handler_traces, sub_traces, error
