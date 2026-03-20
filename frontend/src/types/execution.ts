// Mirror of backend SimEvent / NodeTrace schemas (Phase 3B)

export interface SimEvent {
  payload: unknown;
  mimeType: string;
  attributes: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export interface NodeTrace {
  procId: string;
  procType: string;
  displayName: string;
  input: SimEvent;
  output: SimEvent;
  logs: string[];
  error: string;
  success: boolean;
  skipped?: boolean;
}

export interface ExecuteFlowResponse {
  success: boolean;
  trace: NodeTrace[];
  sub_traces: Record<string, NodeTrace[]>;
  error: string;
}

// Keyed by flowId
export type FlowTraceMap = Record<string, NodeTrace[]>;

// ── Debug session ─────────────────────────────────────────────────────────────

export interface StartDebugResponse {
  session_id: string;
  current_proc_id: string | null;
  current_proc_name: string | null;
  current_flow_id: string | null;
  current_event: SimEvent;
  done: boolean;
}

export interface StepDebugResponse {
  trace: NodeTrace | null;
  extra_traces: NodeTrace[];
  current_proc_id: string | null;
  current_proc_name: string | null;
  current_flow_id: string | null;
  current_event: SimEvent;
  sub_traces: Record<string, NodeTrace[]>;
  done: boolean;
}

export interface EvaluateDebugResponse {
  success: boolean;
  result: unknown;
  output: string;
  error: string;
}

export interface ConsoleEntry {
  id: string;
  procName: string;
  flowName: string;
  message: string;
}

/** Live client-side debug state */
export interface DebugState {
  sessionId: string;
  flowId: string;
  currentProcId: string | null;
  currentProcName: string | null;
  currentFlowId: string | null;
  currentEvent: SimEvent;
  completedTraces: Record<string, NodeTrace>; // procId -> trace (steps already done)
  subTraces: Record<string, NodeTrace[]>;     // flowId -> trace (subflows called so far)
  done: boolean;
  stepping: boolean;                          // waiting for a step response
}
