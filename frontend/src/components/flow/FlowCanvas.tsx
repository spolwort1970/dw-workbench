import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import type { FlowDef, FlowCanvasState, ProcessorInstance } from "../../types/flow";
import {
  makeFlow,
  makeProcessor,
  addToScope,
  updateProcessorInList,
  removeFromList,
  reorderProcessor,
  deepCloneProcessor,
  migrateFlows,
  type ProcessorType,
} from "../../types/flow";
import type { NodeTrace, FlowTraceMap, DebugState, ConsoleEntry, StepDebugResponse } from "../../types/execution";
import { executeFlow, debugStart, debugStep, debugStop, executeDW } from "../../services/api";
import FlowContainer from "./FlowContainer";
import FlowPalette from "./FlowPalette";
import BottomPanel, { type PanelSelection } from "./BottomPanel";
import DebugPanel from "./DebugPanel";
import ConsolePanel from "./ConsolePanel";

let _consoleEntryId = 0;

function makeConsoleEntries(traces: NodeTrace[], flowName: string): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  for (const trace of traces) {
    for (const message of trace.logs) {
      entries.push({ id: String(_consoleEntryId++), procName: trace.displayName, flowName, message });
    }
  }
  return entries;
}

const FLOW_MARGIN = 20;
const FLOW_GAP    = 30;

/** Re-stack flows in their current array order at clean positions. */
function restack(flows: FlowDef[], heights?: Record<string, number>): FlowDef[] {
  let y = FLOW_MARGIN;
  return flows.map((f) => {
    const out = { ...f, x: FLOW_MARGIN, y };
    y += (heights?.[f.id] ?? estimateFlowHeight(f)) + FLOW_GAP;
    return out;
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

function findProcessorInFlow(flow: FlowDef, id: string): ProcessorInstance | null {
  const search = (list: ProcessorInstance[]): ProcessorInstance | null => {
    for (const p of list) {
      if (p.id === id) return p;
      if (p.type === "for-each") {
        const found = search(p.config.processors ?? []);
        if (found) return found;
      }
      if (p.type === "try") {
        const found = search(p.config.processors ?? []);
        if (found) return found;
        for (const h of (p.config.errorHandlers ?? [])) {
          if (h.id === id) return h;
          const hFound = search(h.config.processors ?? []);
          if (hFound) return hFound;
        }
      }
      if (p.type === "on-error-continue" || p.type === "on-error-propagate") {
        const found = search(p.config.processors ?? []);
        if (found) return found;
      }
      if (p.type === "choice") {
        for (const r of (p.config.routes ?? [])) {
          const found = search(r.processors);
          if (found) return found;
        }
      }
    }
    return null;
  };
  // Search main processor tree
  const found = search(flow.processors);
  if (found) return found;
  // Search flow-level error handlers and their children
  for (const h of (flow.errorHandlers ?? [])) {
    if (h.id === id) return h;
    const inner = search(h.config.processors ?? []);
    if (inner) return inner;
  }
  return null;
}

/** Remove a processor by id from anywhere in a FlowDef (processors tree + flow-level errorHandlers). */
function removeFromFlowDef(flow: FlowDef, id: string): FlowDef {
  const newProcessors = removeFromList(flow.processors, id);
  const eh = flow.errorHandlers ?? [];
  const newEH = eh
    .filter((h) => h.id !== id)
    .map((h) => {
      const inner = removeFromList(h.config.processors ?? [], id);
      return inner !== h.config.processors ? { ...h, config: { ...h.config, processors: inner } } : h;
    });
  const unchanged = newProcessors === flow.processors && newEH.length === eh.length && newEH.every((h, i) => h === eh[i]);
  return unchanged ? flow : { ...flow, processors: newProcessors, errorHandlers: newEH };
}

/** Estimate the rendered height of a flow container for stacking purposes. */
function estimateFlowHeight(flow: FlowDef): number {
  // titlebar ~34px + body padding ~24px + row ~80px
  const baseHeight = 148;
  // Scopes render in a horizontal row — only the tallest one affects height.
  let maxScopeExtra = 0;
  for (const p of flow.processors) {
    if (p.type === "for-each" || p.type === "try") {
      maxScopeExtra = Math.max(maxScopeExtra, 70);
    } else if (p.type === "choice") {
      const routeCount = (p.config.routes ?? []).length;
      maxScopeExtra = Math.max(maxScopeExtra, 52 + routeCount * 49);
    }
  }
  return baseHeight + maxScopeExtra;
}

/** Calculate the y position for a new flow, stacked below all existing ones. */
function nextFlowY(flows: FlowDef[]): number {
  if (flows.length === 0) return FLOW_MARGIN;
  let bottom = FLOW_MARGIN;
  for (const f of flows) {
    bottom = Math.max(bottom, f.y + estimateFlowHeight(f));
  }
  return bottom + FLOW_GAP;
}

// ── FlowCanvas ────────────────────────────────────────────────────────────────

export interface FlowCanvasHandle {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface FlowCanvasProps {
  initialState: FlowCanvasState;
  theme?: string;
  onChange: (state: FlowCanvasState) => void;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
}

const FlowCanvas = forwardRef<FlowCanvasHandle, FlowCanvasProps>(function FlowCanvas(
  { initialState, theme = "vs-dark", onChange, onHistoryChange },
  ref,
) {
  const [state, setState] = useState<FlowCanvasState>(() => ({
    flows: migrateFlows(initialState?.flows ?? []),
  }));
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [traces, setTraces]               = useState<FlowTraceMap>({});
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null);
  const [debugState, setDebugState]       = useState<DebugState | null>(null);
  const [consoleLogs, setConsoleLogs]     = useState<ConsoleEntry[]>([]);
  const [consoleOpen, setConsoleOpen]     = useState(false);
  const [consolePinned, setConsolePinned] = useState(false);
  const stateRef    = useRef(state);
  const clipboard   = useRef<{ proc: ProcessorInstance; flowId: string } | null>(null);
  const history     = useRef<FlowCanvasState[]>([]);
  const redoStack   = useRef<FlowCanvasState[]>([]);
  const flowHeights = useRef<Record<string, number>>({});
  useEffect(() => { stateRef.current = state; }, [state]);

  const notifyHistory = useCallback(() => {
    onHistoryChange?.(history.current.length > 0, redoStack.current.length > 0);
  }, [onHistoryChange]);

  const handleFlowHeightChange = useCallback((flowId: string, height: number) => {
    if (flowHeights.current[flowId] === height) return;
    flowHeights.current[flowId] = height;
    const next = { flows: restack(stateRef.current.flows, flowHeights.current) };
    stateRef.current = next;
    setState(next);
    onChange(next);
  }, [onChange]);

  const update = useCallback((nextOrFn: FlowCanvasState | ((prev: FlowCanvasState) => FlowCanvasState)) => {
    const prev = stateRef.current;
    const raw  = typeof nextOrFn === "function" ? nextOrFn(prev) : nextOrFn;
    if (raw === prev) return;
    const next = { ...raw, flows: restack(raw.flows, flowHeights.current) };
    history.current = [...history.current.slice(-49), prev];
    redoStack.current = [];
    stateRef.current = next;
    setState(next);
    onChange(next);
    notifyHistory();
  }, [onChange, notifyHistory]);

  const undo = useCallback(() => {
    if (history.current.length === 0) return;
    const prev = history.current[history.current.length - 1];
    history.current = history.current.slice(0, -1);
    redoStack.current = [...redoStack.current.slice(-49), stateRef.current];
    setState(prev);
    onChange(prev);
    notifyHistory();
  }, [onChange, notifyHistory]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current[redoStack.current.length - 1];
    redoStack.current = redoStack.current.slice(0, -1);
    history.current = [...history.current.slice(-49), stateRef.current];
    setState(next);
    onChange(next);
    notifyHistory();
  }, [onChange, notifyHistory]);

  useImperativeHandle(ref, () => ({
    undo,
    redo,
    get canUndo() { return history.current.length > 0; },
    get canRedo() { return redoStack.current.length > 0; },
  }), [undo, redo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // Clear stale traces whenever a flow is edited
  const clearTrace = useCallback((flowId: string) => {
    setTraces((prev) => {
      if (!prev[flowId]) return prev;
      const next = { ...prev };
      delete next[flowId];
      return next;
    });
  }, []);

  // ── build execution request for a flow (shared by run + debug) ──
  const buildExecRequest = useCallback(async (flowId: string) => {
    const current = stateRef.current;
    const flow    = current.flows.find((f) => f.id === flowId);
    if (!flow) return null;

    const src = flow.source;
    let initialPayload: unknown = src.value?.content ?? "";
    if (src.mimeType === "application/json" && typeof initialPayload === "string") {
      try { initialPayload = JSON.parse(initialPayload); } catch { /* keep as string */ }
    }

    const resolveKVPairs = async (pairs: { key: string; value: { mode: string; content: string } }[]) => {
      const entries = await Promise.all(
        pairs.filter((p) => p.key).map(async (p) => {
          if (p.value.mode === "literal") return [p.key, p.value.content] as [string, unknown];
          try {
            const res = await executeDW({
              script: `%dw 2.0\noutput application/json\n---\n${p.value.content}`,
              payload: null, input_mime_type: "application/json", attributes: {}, vars: {},
            });
            if (!res.success) return [p.key, p.value.content] as [string, unknown];
            try { return [p.key, JSON.parse(String(res.output))] as [string, unknown]; }
            catch { return [p.key, res.output] as [string, unknown]; }
          } catch {
            return [p.key, p.value.content] as [string, unknown];
          }
        })
      );
      return Object.fromEntries(entries);
    };

    const [attributes, variables] = await Promise.all([
      resolveKVPairs(src.attributes ?? []),
      resolveKVPairs(src.variables  ?? []),
    ]);

    const event = { payload: initialPayload, mimeType: src.mimeType ?? "application/json", attributes, variables };
    const flows = current.flows.map((f) => ({
      id: f.id, name: f.name, type: f.type, source: {},
      processors:    f.processors.map((p) => ({ id: p.id, type: p.type, displayName: p.displayName, config: p.config })),
      errorHandlers: (f.errorHandlers ?? []).map((h) => ({ id: h.id, type: h.type, displayName: h.displayName, config: h.config })),
    }));
    return { flow_id: flowId, flows, event };
  }, []);

  // ── append logs from a debug step response ──
  const appendDebugStepLogs = useCallback((res: StepDebugResponse, debugFlowId: string) => {
    const flows = stateRef.current.flows;
    const debugFlowName = flows.find((f) => f.id === debugFlowId)?.name ?? "";
    const newEntries: ConsoleEntry[] = [];
    if (res.trace) newEntries.push(...makeConsoleEntries([res.trace], debugFlowName));
    for (const t of res.extra_traces) newEntries.push(...makeConsoleEntries([t], debugFlowName));
    for (const [subFlowId, subTrace] of Object.entries(res.sub_traces)) {
      const subName = flows.find((f) => f.id === subFlowId)?.name ?? subFlowId;
      newEntries.push(...makeConsoleEntries(subTrace, subName));
    }
    if (newEntries.length > 0) setConsoleLogs((prev) => [...prev, ...newEntries]);
  }, []);

  // ── run flow ──
  const handleRunFlow = useCallback(async (flowId: string) => {
    const req = await buildExecRequest(flowId);
    if (!req) return;
    setRunningFlowId(flowId);
    try {
      const result = await executeFlow(req);
      setTraces((prev) => ({ ...prev, [flowId]: result.trace, ...result.sub_traces }));
      // ── populate console ──
      const flows = stateRef.current.flows;
      const flowName = flows.find((f) => f.id === flowId)?.name ?? flowId;
      const entries: ConsoleEntry[] = makeConsoleEntries(result.trace, flowName);
      for (const [subFlowId, subTrace] of Object.entries(result.sub_traces)) {
        const subName = flows.find((f) => f.id === subFlowId)?.name ?? subFlowId;
        entries.push(...makeConsoleEntries(subTrace, subName));
      }
      setConsoleLogs(entries);
      setConsoleOpen(true);
      const allTraces = [result.trace, ...Object.values(result.sub_traces)];
      const failed    = allTraces.flat().find((n) => !n.success);
      const autoSelect = failed ?? result.trace[0];
      if (autoSelect) setSelectedId(autoSelect.procId);
    } catch (err) {
      console.error("Flow execution failed:", err);
    } finally {
      setRunningFlowId(null);
    }
  }, [buildExecRequest]);

  // ── start debug session ──
  const handleDebugFlow = useCallback(async (flowId: string) => {
    if (debugState) return; // already debugging
    const req = await buildExecRequest(flowId);
    if (!req) return;
    try {
      const res = await debugStart(req);
      setConsoleLogs([]);
      setConsoleOpen(true);
      setDebugState({
        sessionId:       res.session_id,
        flowId,
        currentProcId:   res.current_proc_id,
        currentProcName: res.current_proc_name,
        currentFlowId:   res.current_flow_id,
        currentEvent:    res.current_event,
        completedTraces: {},
        subTraces:       {},
        done:            res.done,
        stepping:        false,
      });
      setSelectedId(res.current_proc_id);
    } catch (err) {
      console.error("Debug start failed:", err);
    }
  }, [debugState, buildExecRequest]);

  // ── step one processor ──
  const handleDebugStep = useCallback(async () => {
    if (!debugState || debugState.stepping || debugState.done) return;
    setDebugState((prev) => prev ? { ...prev, stepping: true } : prev);
    try {
      const res = await debugStep(debugState.sessionId);
      setDebugState((prev) => {
        if (!prev) return prev;
        const completedTraces = { ...prev.completedTraces };
        if (res.trace) completedTraces[res.trace.procId] = res.trace;
        for (const t of res.extra_traces) completedTraces[t.procId] = t;
        const subTraces = { ...prev.subTraces, ...res.sub_traces };
        // Update run-mode traces so badges appear on subflow processors too
        setTraces((t) => ({ ...t, ...res.sub_traces }));
        return {
          ...prev,
          currentProcId:   res.current_proc_id,
          currentProcName: res.current_proc_name,
          currentFlowId:   res.current_flow_id,
          currentEvent:    res.current_event,
          completedTraces,
          subTraces,
          done:            res.done,
          stepping:        false,
        };
      });
      appendDebugStepLogs(res, debugState.flowId);
      if (res.current_proc_id) setSelectedId(res.current_proc_id);
      else if (res.trace)      setSelectedId(res.trace.procId);
    } catch (err) {
      console.error("Debug step failed:", err);
      setDebugState((prev) => prev ? { ...prev, stepping: false } : prev);
    }
  }, [debugState, appendDebugStepLogs]);

  // ── continue (run to end) ──
  const handleDebugContinue = useCallback(async () => {
    if (!debugState || debugState.stepping || debugState.done) return;
    // Step repeatedly until done
    let session = debugState;
    while (!session.done) {
      setDebugState((prev) => prev ? { ...prev, stepping: true } : prev);
      try {
        const res = await debugStep(session.sessionId);
        setDebugState((prev) => {
          if (!prev) return prev;
          const completedTraces = { ...prev.completedTraces };
          if (res.trace) completedTraces[res.trace.procId] = res.trace;
          for (const t of res.extra_traces) completedTraces[t.procId] = t;
          const subTraces = { ...prev.subTraces, ...res.sub_traces };
          setTraces((t) => ({ ...t, ...res.sub_traces }));
          session = { ...prev, currentProcId: res.current_proc_id, currentProcName: res.current_proc_name, currentFlowId: res.current_flow_id, currentEvent: res.current_event, completedTraces, subTraces, done: res.done, stepping: false };
          return session;
        });
        appendDebugStepLogs(res, debugState.flowId);
        if (res.done) break;
      } catch (err) {
        console.error("Debug continue step failed:", err);
        setDebugState((prev) => prev ? { ...prev, stepping: false } : prev);
        break;
      }
    }
  }, [debugState, appendDebugStepLogs]);

  // ── commit traces to canvas (called when session finishes naturally) ──
  const commitDebugTraces = useCallback((ds: typeof debugState) => {
    if (!ds) return;
    const allTraces = Object.values(ds.completedTraces);
    if (allTraces.length === 0) return;
    // Partition traces into the flow they belong to
    const tracesByFlow: Record<string, NodeTrace[]> = {};
    const flows = stateRef.current.flows;
    for (const t of allTraces) {
      const flow = flows.find((f) => findProcessorInFlow(f, t.procId));
      const fid = flow?.id ?? ds.flowId;
      (tracesByFlow[fid] ??= []).push(t);
    }
    setTraces((prev) => ({ ...prev, ...tracesByFlow, ...ds.subTraces }));
    const mainTraces = tracesByFlow[ds.flowId] ?? [];
    const failed = mainTraces.find((t) => !t.success);
    const autoSelect = failed ?? mainTraces[mainTraces.length - 1];
    if (autoSelect) setSelectedId(autoSelect.procId);
  }, []);

  // ── close debug panel (user-initiated) ──
  const handleDebugStop = useCallback(async () => {
    if (!debugState) return;
    try { await debugStop(debugState.sessionId); } catch { /* ignore */ }
    commitDebugTraces(debugState);
    setDebugState(null);
  }, [debugState, commitDebugTraces]);

  // ── when session finishes naturally: commit traces but keep panel open ──
  useEffect(() => {
    if (debugState?.done && !debugState.stepping) {
      commitDebugTraces(debugState);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugState?.done, debugState?.stepping]);

  // ── window-level keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isTyping = (e.target as HTMLElement).closest("input, textarea, [contenteditable]");

      // ArrowLeft / ArrowRight — reorder selected processor within its container
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selectedId && !selectedId.startsWith("source:") && !isTyping) {
        e.preventDefault();
        const direction = e.key === "ArrowLeft" ? -1 : 1;
        update((prev) => ({
          flows: prev.flows.map((f) => ({
            ...f,
            processors: reorderProcessor(f.processors, selectedId, direction),
          })),
        }));
        return;
      }

      // Delete selected processor
      if (e.key === "Delete" && selectedId && !selectedId.startsWith("source:")) {
        update((prev) => ({
          flows: prev.flows.map((f) => removeFromFlowDef(f, selectedId)),
        }));
        setSelectedId(null);
        return;
      }

      // Ctrl/Cmd+C — copy selected processor
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedId && !selectedId.startsWith("source:")) {
        for (const flow of stateRef.current.flows) {
          const proc = findProcessorInFlow(flow, selectedId);
          if (proc) { clipboard.current = { proc, flowId: flow.id }; break; }
        }
        return;
      }

      // Ctrl/Cmd+V — paste clipboard processor
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard.current && !isTyping) {
        e.preventDefault();
        const { proc, flowId } = clipboard.current;
        const cloned = deepCloneProcessor(proc);
        const isErrorHandler = proc.type === "on-error-continue" || proc.type === "on-error-propagate";

        // If pasting an error handler and a Try scope is selected → paste into its errorHandlers
        if (isErrorHandler && selectedId) {
          let pasted = false;
          update((prev) => {
            const flows = prev.flows.map((f) => {
              const sel = findProcessorInFlow(f, selectedId);
              if (sel?.type === "try") {
                pasted = true;
                return { ...f, processors: addToScope(f.processors, selectedId, cloned, "__error_handler__") };
              }
              return f;
            });
            if (pasted) return { flows };
            // Fallback: paste to top-level of original flow
            const target = prev.flows.find((f) => f.id === flowId) ?? prev.flows[0];
            if (!target) return prev;
            return { flows: prev.flows.map((f) => f.id === target.id ? { ...f, processors: [...f.processors, cloned] } : f) };
          });
        } else {
          update((prev) => {
            const target = prev.flows.find((f) => f.id === flowId) ?? prev.flows[0];
            if (!target) return prev;
            return { flows: prev.flows.map((f) => f.id === target.id ? { ...f, processors: [...f.processors, cloned] } : f) };
          });
        }
        setSelectedId(cloned.id);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, update]);

  // ── canvas drag-over / drop ──
  const onCanvasDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const onCanvasDrop = (e: React.DragEvent) => {
    // Processor dragged to canvas = delete it
    const moveData = e.dataTransfer.getData("processorMove");
    if (moveData) {
      const { procId } = JSON.parse(moveData);
      update((prev) => ({
        flows: prev.flows.map((f) => removeFromFlowDef(f, procId)),
      }));
      setSelectedId((id) => id === procId ? null : id);
      return;
    }
    // Flow/subflow dragged from palette
    const flowType = e.dataTransfer.getData("flowType") as "flow" | "subflow" | "";
    if (!flowType) return;
    update((prev) => {
      const name = flowType === "subflow"
        ? `subflow${prev.flows.filter((f) => f.type === "subflow").length + 1}`
        : `flow${prev.flows.filter((f) => f.type === "flow").length + 1}`;
      const y = nextFlowY(prev.flows);
      const newFlow = makeFlow(flowType, name, FLOW_MARGIN, y);
      return { flows: [...prev.flows, newFlow] };
    });
  };

  // ── source selection ──
  const handleSelectSource = useCallback((flowId: string) => {
    setSelectedId(`source:${flowId}`);
  }, []);

  // ── processor selection ──
  const handleSelectProcessor = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  // ── drop processor onto a flow's top-level process zone ──
  const handleDropProcessor = useCallback((flowId: string, type: string) => {
    const newProc = makeProcessor(type as ProcessorType);
    clearTrace(flowId);
    update((prev) => ({
      flows: prev.flows.map((f) =>
        f.id === flowId ? { ...f, processors: [...f.processors, newProc] } : f
      ),
    }));
  }, [update, clearTrace]);

  // ── move existing processor into a scope route ──
  const handleMoveIntoScope = useCallback((procId: string, sourceFlowId: string, targetScopeId: string, routeId?: string) => {
    update((prev) => {
      let movedProc: ProcessorInstance | null = null;
      const afterRemove = prev.flows.map((f) => {
        if (f.id !== sourceFlowId) return f;
        movedProc = findProcessorInFlow(f, procId);
        return removeFromFlowDef(f, procId);
      });
      if (!movedProc) return prev;
      return {
        flows: afterRemove.map((f) => ({
          ...f,
          processors: addToScope(f.processors, targetScopeId, movedProc!, routeId),
        })),
      };
    });
  }, [update]);

  // ── move existing processor between flows ──
  const handleMoveProcessor = useCallback((procId: string, sourceFlowId: string, targetFlowId: string) => {
    update((prev) => {
      const sourceFlow = prev.flows.find((f) => f.id === sourceFlowId);
      if (!sourceFlow) return prev;

      // If same flow and proc is already at the top level, it's a no-op (arrow keys handle reorder)
      const isTopLevel = sourceFlow.processors.some((p) => p.id === procId);
      if (sourceFlowId === targetFlowId && isTopLevel) return prev;

      let movedProc: ProcessorInstance | null = null;
      const afterRemove = prev.flows.map((f) => {
        if (f.id !== sourceFlowId) return f;
        movedProc = findProcessorInFlow(f, procId);
        return removeFromFlowDef(f, procId);
      });
      if (!movedProc) return prev;

      // Same flow but proc was nested (e.g. dragged out of a scope/error-handler zone) → just remove
      if (sourceFlowId === targetFlowId) return { flows: afterRemove };

      return {
        flows: afterRemove.map((f) =>
          f.id === targetFlowId ? { ...f, processors: [...f.processors, movedProc!] } : f
        ),
      };
    });
  }, [update]);

  // ── delete an error handler by id ──
  const handleDeleteHandler = useCallback((id: string) => {
    update((prev) => ({
      flows: prev.flows.map((f) => removeFromFlowDef(f, id)),
    }));
  }, [update]);

  // ── drop new error handler onto flow-level error handling section ──
  const handleDropFlowErrorHandler = useCallback((flowId: string, type: string) => {
    const newProc = makeProcessor(type as ProcessorType);
    update((prev) => ({
      flows: prev.flows.map((f) =>
        f.id === flowId ? { ...f, errorHandlers: [...(f.errorHandlers ?? []), newProc] } : f
      ),
    }));
  }, [update]);

  // ── move existing processor into flow-level error handlers ──
  const handleMoveIntoFlowErrorHandlers = useCallback((procId: string, sourceFlowId: string, targetFlowId: string) => {
    update((prev) => {
      let movedProc: ProcessorInstance | null = null;
      const afterRemove = prev.flows.map((f) => {
        if (f.id !== sourceFlowId) return f;
        movedProc = findProcessorInFlow(f, procId);
        return removeFromFlowDef(f, procId);
      });
      if (!movedProc) return prev;
      const moved = movedProc as ProcessorInstance;
      // Only allow error handler types in the flow error handler zone
      if (moved.type !== "on-error-continue" && moved.type !== "on-error-propagate") return prev;
      return {
        flows: afterRemove.map((f) =>
          f.id === targetFlowId ? { ...f, errorHandlers: [...(f.errorHandlers ?? []), moved] } : f
        ),
      };
    });
  }, [update]);

  // ── drop processor into a scope ──
  const handleDropInScope = useCallback((scopeId: string, type: string, routeId?: string) => {
    const newProc = makeProcessor(type as ProcessorType);
    update((prev) => ({
      flows: prev.flows.map((f) => ({
        ...f,
        processors: addToScope(f.processors, scopeId, newProc, routeId),
      })),
    }));
  }, [update]);

  // ── move a flow — drag it freely on Y; others shift out of the way in real time ──
  const handleMoveFlow = useCallback((flowId: string, _dx: number, dy: number) => {
    setState((prev) => {
      const flow = prev.flows.find((f) => f.id === flowId);
      if (!flow) return prev;

      const newY   = Math.max(0, flow.y + dy);
      const others = prev.flows.filter((f) => f.id !== flowId);

      // Find where dragged flow's top crosses another flow's midpoint
      let insertIdx = others.length;
      for (let i = 0; i < others.length; i++) {
        if (newY < others[i].y + estimateFlowHeight(others[i]) / 2) {
          insertIdx = i;
          break;
        }
      }

      // Stack others with a gap left for the dragged flow
      let y = FLOW_MARGIN;
      const stackedOthers: FlowDef[] = [];
      for (let i = 0; i < others.length; i++) {
        if (i === insertIdx) y += estimateFlowHeight(flow) + FLOW_GAP;
        stackedOthers.push({ ...others[i], x: FLOW_MARGIN, y });
        y += estimateFlowHeight(others[i]) + FLOW_GAP;
      }

      // Place dragged flow at cursor Y
      const result = [...stackedOthers];
      result.splice(insertIdx, 0, { ...flow, x: FLOW_MARGIN, y: newY });

      const next = { flows: result };
      onChange(next);
      return next;
    });
  }, [onChange]);

  // ── snap everything to clean positions when drag ends ──
  const handleMoveFlowEnd = useCallback((_flowId: string) => {
    update((prev) => ({ flows: restack(prev.flows) }));
  }, [update]);

  // ── delete a flow — remaining flows close the gap automatically ──
  const handleDeleteFlow = useCallback((flowId: string) => {
    if (selectedId?.startsWith(`source:${flowId}`) || selectedId === flowId) {
      setSelectedId(null);
    }
    update((prev) => ({ flows: restack(prev.flows.filter((f) => f.id !== flowId)) }));
  }, [selectedId, update]);

  // ── add flow (from palette drop onto existing container) ──
  const handleAddFlow = useCallback((flowType: "flow" | "subflow") => {
    update((prev) => {
      const name = flowType === "subflow"
        ? `subflow${prev.flows.filter((f) => f.type === "subflow").length + 1}`
        : `flow${prev.flows.filter((f) => f.type === "flow").length + 1}`;
      const y = nextFlowY(prev.flows);
      return { flows: [...prev.flows, makeFlow(flowType, name, FLOW_MARGIN, y)] };
    });
  }, [update]);

  // ── rename flow ──
  const handleRenameFlow = useCallback((flowId: string, name: string) => {
    update((prev) => ({ flows: prev.flows.map((f) => f.id === flowId ? { ...f, name } : f) }));
  }, [update]);

  // ── update source config ──
  const handleUpdateSource = useCallback((flowId: string, config: FlowDef["source"]) => {
    setState((prev) => {
      const next: FlowCanvasState = {
        flows: prev.flows.map((f) => f.id === flowId ? { ...f, source: config } : f),
      };
      onChange(next);
      return next;
    });
  }, [onChange]);

  // ── rename processor (display name) ──
  const handleRenameProcessor = useCallback(
    (flowId: string, procId: string, name: string) => {
      const updater = (p: ProcessorInstance) => ({ ...p, displayName: name });
      const next: FlowCanvasState = {
        flows: stateRef.current.flows.map((f) => {
          if (f.id !== flowId) return f;
          const newProcessors = updateProcessorInList(f.processors, procId, updater);
          const newEH = (f.errorHandlers ?? []).map((h) => {
            if (h.id === procId) return updater(h);
            const inner = updateProcessorInList(h.config.processors ?? [], procId, updater);
            return inner !== h.config.processors ? { ...h, config: { ...h.config, processors: inner } } : h;
          });
          return { ...f, processors: newProcessors, errorHandlers: newEH };
        }),
      };
      setState(next);
      onChange(next);
    },
    [onChange]
  );

  // ── update processor config ──
  const handleUpdateProcessor = useCallback(
    (flowId: string, procId: string, config: Record<string, any>) => {
      clearTrace(flowId);
      const updater = (p: ProcessorInstance) => ({ ...p, config });
      setState((prev) => {
        const next: FlowCanvasState = {
          flows: prev.flows.map((f) => {
            if (f.id !== flowId) return f;
            const newProcessors = updateProcessorInList(f.processors, procId, updater);
            const newEH = (f.errorHandlers ?? []).map((h) => {
              if (h.id === procId) return updater(h);
              const inner = updateProcessorInList(h.config.processors ?? [], procId, updater);
              return inner !== h.config.processors ? { ...h, config: { ...h.config, processors: inner } } : h;
            });
            return { ...f, processors: newProcessors, errorHandlers: newEH };
          }),
        };
        onChange(next);
        return next;
      });
    },
    [onChange, clearTrace]
  );

  // ── resolve selection → PanelSelection ──
  const panelSelection: PanelSelection = (() => {
    if (!selectedId) return null;
    if (selectedId.startsWith("source:")) {
      const flowId = selectedId.slice("source:".length);
      const flow = state.flows.find((f) => f.id === flowId);
      return flow ? { kind: "source", flow } : null;
    }
    for (const flow of state.flows) {
      const proc = findProcessorInFlow(flow, selectedId);
      if (proc) {
        const flowTrace = traces[flow.id] ?? [];
        const nodeTrace =
          flowTrace.find((t) => t.procId === selectedId) ??
          debugState?.completedTraces[selectedId] ??
          null;
        return { kind: "processor", proc, flowId: flow.id, nodeTrace };
      }
    }
    return null;
  })();

  const allFlows = state.flows.map((f) => ({ id: f.id, name: f.name }));

  const debugCompletedArr = debugState ? Object.values(debugState.completedTraces) : [];
  const lastDebugTrace = debugCompletedArr.length > 0 ? debugCompletedArr[debugCompletedArr.length - 1] : null;

  return (
    <div className="flow-canvas-root">
      <div className="flow-canvas-scroll">
        <div className="flow-canvas-main">
        <div
          className="flow-canvas-area"
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
          onClick={() => {
            setSelectedId(null);
            if (!consolePinned) setConsoleOpen(false);
          }}
        >
          {state.flows.length === 0 && (
            <div className="flow-canvas-area__hint">
              Drag a Flow or Sub Flow from the palette to get started
            </div>
          )}
          {state.flows.map((flow) => {
            // Merge run-mode traces with any completed debug traces for this flow
            const runTrace  = traces[flow.id] ?? [];
            const nodeTraces: Record<string, NodeTrace> = {};
            for (const t of runTrace) nodeTraces[t.procId] = t;
            if (debugState) {
              for (const t of Object.values(debugState.completedTraces)) nodeTraces[t.procId] = t;
            }
            const pausedProcId = debugState?.currentProcId ?? null;
            return (
              <FlowContainer
                key={flow.id}
                flow={flow}
                selectedId={selectedId}
                nodeTraces={nodeTraces}
                pausedProcId={pausedProcId}
                isRunning={runningFlowId === flow.id}
                isDebugging={!!debugState}
                onRun={handleRunFlow}
                onDebug={handleDebugFlow}
                onRenameFlow={handleRenameFlow}
                onSelectSource={handleSelectSource}
                onSelectProcessor={handleSelectProcessor}
                onDropProcessor={handleDropProcessor}
                onMoveProcessor={handleMoveProcessor}
                onDropInScope={handleDropInScope}
                onMoveIntoScope={handleMoveIntoScope}
                onDeleteHandler={handleDeleteHandler}
                onDropFlowErrorHandler={handleDropFlowErrorHandler}
                onMoveIntoFlowErrorHandlers={handleMoveIntoFlowErrorHandlers}
                onMoveFlow={handleMoveFlow}
                onMoveFlowEnd={handleMoveFlowEnd}
                onDeleteFlow={handleDeleteFlow}
                onHeightChange={handleFlowHeightChange}
                onAddFlow={handleAddFlow}
              />
            );
          })}
        </div>

        {consoleOpen && (
          <ConsolePanel
            entries={consoleLogs}
            pinned={consolePinned}
            onClear={() => setConsoleLogs([])}
            onClose={() => setConsoleOpen(false)}
            onTogglePin={() => setConsolePinned((p) => !p)}
          />
        )}
        </div>{/* end flow-canvas-main */}

        <BottomPanel
          selection={panelSelection}
          allFlows={allFlows}
          theme={theme}
          lastDebugTrace={lastDebugTrace}
          onUpdateSource={handleUpdateSource}
          onUpdateProcessor={handleUpdateProcessor}
          onRenameProcessor={handleRenameProcessor}
        />
      </div>

      {debugState ? (
        <DebugPanel
          debug={debugState}
          flowName={state.flows.find((f) => f.id === debugState.flowId)?.name ?? ""}
          theme={theme}
          onStep={handleDebugStep}
          onContinue={handleDebugContinue}
          onStop={handleDebugStop}
        />
      ) : (
        <FlowPalette />
      )}
    </div>
  );
});

export default FlowCanvas;
