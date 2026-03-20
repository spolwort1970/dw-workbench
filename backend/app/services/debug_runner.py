"""
Debug session engine — Phase 3B.

Each session holds a call stack of frames. Stepping executes one processor at a
time.  When a flow-reference is encountered, a new frame is pushed so the user
can step INSIDE the subflow before returning to the parent.
"""

import copy
import time
import uuid
from dataclasses import dataclass, field

from app.models.schemas import SimEvent, NodeTrace, FlowDef, ProcessorDef
from app.services.flow_runner import execute_single_processor, evaluate_dw_value, SubTraces, _run_try, _error_type_matches

SESSION_TTL = 1800  # seconds — sessions auto-expire after 30 min of inactivity

_sessions: dict[str, "DebugSession"] = {}


# ── Try context (attached to a call frame when inside a Try body) ─────────────

@dataclass
class TryContext:
    proc:           ProcessorDef
    input_snapshot: SimEvent
    error_handlers: list


# ── Call frame ────────────────────────────────────────────────────────────────

@dataclass
class CallFrame:
    flow_id:     str
    flow_name:   str
    processors:  list          # list[ProcessorDef]
    cursor:      int = 0
    try_context: "TryContext | None" = None


# ── Session ───────────────────────────────────────────────────────────────────

class DebugSession:
    def __init__(self, flow: FlowDef, all_flows: list[FlowDef], initial_event: SimEvent):
        self.session_id   = str(uuid.uuid4())
        self.flow         = flow
        self.all_flows    = all_flows
        self.event        = copy.deepcopy(initial_event)
        self.call_stack:  list[CallFrame] = [CallFrame(flow.id, flow.name, flow.processors)]
        self.trace:       list[NodeTrace] = []
        self.sub_traces:  SubTraces       = {}
        self.visited:     set[str]        = {flow.name}
        self.last_active  = time.time()

    @property
    def done(self) -> bool:
        return len(self.call_stack) == 0

    @property
    def current_proc_id(self) -> str | None:
        if not self.call_stack:
            return None
        frame = self.call_stack[-1]
        if frame.cursor >= len(frame.processors):
            return None
        return frame.processors[frame.cursor].id

    @property
    def current_proc_name(self) -> str | None:
        if not self.call_stack:
            return None
        frame = self.call_stack[-1]
        if frame.cursor >= len(frame.processors):
            return None
        return frame.processors[frame.cursor].displayName

    @property
    def current_flow_id(self) -> str | None:
        return self.call_stack[-1].flow_id if self.call_stack else None

    def touch(self):
        self.last_active = time.time()


# ── Frame cleanup helper ──────────────────────────────────────────────────────

def _cleanup_frames(session: DebugSession):
    """Pop any exhausted frames from the top of the call stack."""
    while session.call_stack:
        frame = session.call_stack[-1]
        if frame.cursor < len(frame.processors):
            break
        session.call_stack.pop()
        # Allow re-entry after a subflow has completed (not a loop)
        if frame.flow_name != session.flow.name:
            session.visited.discard(frame.flow_name)


# ── Session store ─────────────────────────────────────────────────────────────

def _cleanup_expired():
    cutoff  = time.time() - SESSION_TTL
    expired = [sid for sid, s in _sessions.items() if s.last_active < cutoff]
    for sid in expired:
        del _sessions[sid]


def create_session(flow: FlowDef, all_flows: list[FlowDef], initial_event: SimEvent) -> DebugSession:
    _cleanup_expired()
    session = DebugSession(flow, all_flows, initial_event)
    _sessions[session.session_id] = session
    return session


def get_session(session_id: str) -> DebugSession | None:
    session = _sessions.get(session_id)
    if session:
        session.touch()
    return session


def delete_session(session_id: str):
    _sessions.pop(session_id, None)


# ── Step ──────────────────────────────────────────────────────────────────────

def step(session: DebugSession) -> tuple[NodeTrace | None, list[NodeTrace], bool]:
    """
    Execute the processor at the current cursor position.

    Returns (trace_entry, extra_traces, done_after_step).
    extra_traces holds skipped-branch traces when a choice is stepped.
    Returns (None, [], True) if already done.
    """
    if session.done:
        return None, [], True

    frame = session.call_stack[-1]
    proc  = frame.processors[frame.cursor]
    input_snapshot = copy.deepcopy(session.event)

    # ── choice: evaluate conditions, push branch frame, emit skipped traces ──
    if proc.type == "choice":
        config  = proc.config
        routes  = config.get("routes", [])
        whens   = [r for r in routes if r.get("type") == "when"]
        default = next((r for r in routes if r.get("type") == "default"), None)

        frame.cursor += 1  # advance past the choice node

        selected_route = None
        branch_log     = ""
        error          = ""

        for i, route in enumerate(whens):
            val, err = evaluate_dw_value(route.get("expression", {}), session.event)
            if err:
                error = f"When {i + 1} condition error: {err}"
                break
            if val:
                selected_route = route
                branch_log = f"↓ When {i + 1} matched"
                break

        if not error and selected_route is None and default:
            selected_route = default
            branch_log = "↓ Default branch taken"

        if not error and selected_route is None:
            branch_log = "No condition matched (no default)"

        success = not bool(error)

        entry = NodeTrace(
            procId=proc.id, procType="choice", displayName=proc.displayName,
            input=input_snapshot, output=copy.deepcopy(session.event),
            logs=[branch_log] if branch_log else [], error=error, success=success,
        )
        session.trace.append(entry)

        # Skipped traces for non-selected branches
        skipped: list[NodeTrace] = []
        for route in routes:
            if route is selected_route:
                continue
            for p in route.get("processors", []):
                inner = ProcessorDef(**p)
                t = NodeTrace(
                    procId=inner.id, procType=inner.type, displayName=inner.displayName,
                    input=copy.deepcopy(session.event), output=copy.deepcopy(session.event),
                    logs=["ℹ Skipped (branch not selected)"], success=True, skipped=True,
                )
                session.trace.append(t)
                skipped.append(t)

        if not success:
            session.call_stack.clear()
        elif selected_route and selected_route.get("processors"):
            branch_procs = [ProcessorDef(**p) for p in selected_route["processors"]]
            session.call_stack.append(CallFrame(
                flow_id=frame.flow_id,
                flow_name=f"{frame.flow_name}[choice]",
                processors=branch_procs,
            ))

        _cleanup_frames(session)
        return entry, skipped, session.done

    # ── try: push body frame tagged with TryContext ──────────────────────────
    if proc.type == "try":
        config         = proc.config
        body_procs     = config.get("processors", [])
        error_handlers = config.get("errorHandlers", [])
        input_snapshot = copy.deepcopy(session.event)

        frame.cursor += 1  # advance past the try node

        entry = NodeTrace(
            procId=proc.id, procType="try", displayName=proc.displayName,
            input=input_snapshot, output=copy.deepcopy(session.event),
            logs=["↓ Stepping into Try body"], success=True,
        )
        session.trace.append(entry)

        if body_procs:
            tc = TryContext(proc=proc, input_snapshot=input_snapshot, error_handlers=error_handlers)
            session.call_stack.append(CallFrame(
                flow_id=frame.flow_id,
                flow_name=f"{frame.flow_name}[try]",
                processors=[ProcessorDef(**p) for p in body_procs],
                try_context=tc,
            ))

        _cleanup_frames(session)
        return entry, [], session.done

    # ── flow-reference: push subflow frame instead of executing atomically ──
    if proc.type == "flow-reference":
        cfg           = proc.config
        flow_name_val = cfg.get("flowName", {})
        target_name   = (
            flow_name_val.get("content", "").strip()
            if isinstance(flow_name_val, dict) else ""
        )

        frame.cursor += 1  # advance past the flow-ref node in the current frame

        error  = ""
        target_flow = None

        if not target_name:
            error = "Flow Reference: no flow name configured"
        elif target_name in session.visited:
            error = f"Recursive loop detected — '{target_name}' is already in the call stack"
        else:
            target_flow = next((f for f in session.all_flows if f.name == target_name), None)
            if not target_flow:
                error = f"Flow Reference: flow '{target_name}' not found"

        success = error == ""

        if success and target_flow:
            session.visited.add(target_name)
            session.call_stack.append(
                CallFrame(target_flow.id, target_name, target_flow.processors)
            )
            n = len(target_flow.processors)
            logs = [f"↓ Stepping into '{target_name}' ({n} processor{'s' if n != 1 else ''})"]
        else:
            logs = []

        entry = NodeTrace(
            procId      = proc.id,
            procType    = proc.type,
            displayName = proc.displayName,
            input       = input_snapshot,
            output      = copy.deepcopy(session.event),
            logs        = logs,
            error       = error,
            success     = success,
        )
        session.trace.append(entry)

        if not success:
            session.call_stack.clear()

        # Clean up in case the subflow is empty
        _cleanup_frames(session)
        return entry, [], session.done

    # ── normal processor execution ────────────────────────────────────────────
    step_sub: SubTraces = {}

    try:
        new_event, logs, error = execute_single_processor(
            proc, session.event, session.all_flows, session.visited, step_sub
        )
    except Exception as exc:
        error     = f"Unexpected error: {exc}"
        new_event = session.event
        logs      = []

    success = error == ""
    if success:
        session.event = new_event

    session.sub_traces.update(step_sub)

    entry = NodeTrace(
        procId      = proc.id,
        procType    = proc.type,
        displayName = proc.displayName,
        input       = input_snapshot,
        output      = copy.deepcopy(session.event),
        logs        = logs,
        error       = error,
        success     = success,
    )
    session.trace.append(entry)
    frame.cursor += 1

    if not success:
        if frame.try_context:
            # Body processor failed inside a Try — handle with error handlers
            tc = frame.try_context
            session.call_stack.pop()  # remove the try body frame

            # Find matching handler and execute atomically
            selected_handler = None
            for handler_dict in tc.error_handlers:
                h_config  = handler_dict.get("config", {})
                h_type    = h_config.get("errorType", "ANY")
                when_expr = (h_config.get("when") or "").strip()
                if not _error_type_matches(h_type, error):
                    continue
                if not when_expr:
                    selected_handler = handler_dict
                    break
                val, err = evaluate_dw_value({"mode": "expression", "content": when_expr}, session.event)
                if err or val:
                    selected_handler = handler_dict
                    break

            handler_current = session.event
            handler_traces: list[NodeTrace] = []
            handler_sub: SubTraces = {}
            h_config = (selected_handler or {}).get("config", {})
            for h_proc_def in h_config.get("processors", []):
                h_proc  = ProcessorDef(**h_proc_def)
                h_input = copy.deepcopy(handler_current)
                try:
                    h_new, h_logs, h_err = execute_single_processor(
                        h_proc, handler_current, session.all_flows, session.visited, handler_sub
                    )
                except Exception as exc:
                    h_err, h_new, h_logs = f"Unexpected error: {exc}", handler_current, []
                h_success = not bool(h_err)
                if h_success:
                    handler_current = h_new
                handler_traces.append(NodeTrace(
                    procId=h_proc.id, procType=h_proc.type, displayName=h_proc.displayName,
                    input=h_input, output=copy.deepcopy(handler_current),
                    logs=h_logs, error=h_err, success=h_success,
                ))
                if not h_success:
                    break

            session.sub_traces.update(handler_sub)
            handler_type = (selected_handler or {}).get("type", "on-error-propagate")

            if handler_type == "on-error-continue":
                session.event = handler_current
                try_trace = NodeTrace(
                    procId=tc.proc.id, procType="try", displayName=tc.proc.displayName,
                    input=tc.input_snapshot, output=copy.deepcopy(handler_current),
                    logs=[f"⚠ Error caught and handled: {error}"], success=True,
                )
                session.trace.append(try_trace)
                for t in handler_traces:
                    session.trace.append(t)
                _cleanup_frames(session)
            else:
                try_trace = NodeTrace(
                    procId=tc.proc.id, procType="try", displayName=tc.proc.displayName,
                    input=tc.input_snapshot, output=copy.deepcopy(handler_current),
                    logs=[f"✗ Error propagated: {error}"], error=error, success=False,
                )
                session.trace.append(try_trace)
                for t in handler_traces:
                    session.trace.append(t)
                session.call_stack.clear()

            return try_trace, [entry] + handler_traces, session.done
        else:
            session.call_stack.clear()
    else:
        _cleanup_frames(session)

    return entry, [], session.done
