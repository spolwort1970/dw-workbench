import type {
  SimEvent, ExecuteFlowResponse,
  StartDebugResponse, StepDebugResponse, EvaluateDebugResponse,
} from "../types/execution";
import type { MaxChatRequest, MaxSummarizeRequest, MaxSummarizeResponse, MaxTestRequest, MaxTestResponse } from "../types/max";

const BASE_URL = "http://localhost:8000";

// ── Flow execution ─────────────────────────────────────────────────────────────

export interface FlowDefForExecution {
  id: string;
  name: string;
  type: string;
  processors: ProcessorDefForExecution[];
  source: Record<string, unknown>;
}

export interface ProcessorDefForExecution {
  id: string;
  type: string;
  displayName: string;
  config: Record<string, unknown>;
}

export interface ExecuteFlowRequest {
  flow_id: string;
  flows: FlowDefForExecution[];
  event: SimEvent;
}

export async function executeFlow(req: ExecuteFlowRequest): Promise<ExecuteFlowResponse> {
  const res = await fetch(`${BASE_URL}/execute-flow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Debug API ─────────────────────────────────────────────────────────────────

export async function debugStart(req: ExecuteFlowRequest): Promise<StartDebugResponse> {
  const res = await fetch(`${BASE_URL}/debug/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function debugStep(sessionId: string): Promise<StepDebugResponse> {
  const res = await fetch(`${BASE_URL}/debug/step/${sessionId}`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function debugEvaluate(sessionId: string, expression: string): Promise<EvaluateDebugResponse> {
  const res = await fetch(`${BASE_URL}/debug/evaluate/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expression }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function debugStop(sessionId: string): Promise<void> {
  await fetch(`${BASE_URL}/debug/session/${sessionId}`, { method: "DELETE" });
}

export interface ExecuteDWRequest {
  script: string;
  payload: unknown;
  input_mime_type: string;
  attributes: Record<string, unknown>;
  vars: Record<string, unknown>;
}

export interface ExecuteDWResponse {
  success: boolean;
  output: unknown;
  stdout: string;
  stderr: string;
  error: string;
}

export async function executeDW(req: ExecuteDWRequest): Promise<ExecuteDWResponse> {
  const res = await fetch(`${BASE_URL}/execute-dw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ── Max AI assistant ───────────────────────────────────────────────────────────

export async function streamMaxChat(
  req: MaxChatRequest,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE_URL}/max/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        if (parsed.text) onChunk(parsed.text);
      } catch { /* ignore malformed chunk */ }
    }
  }
}

export async function maxSummarize(req: MaxSummarizeRequest): Promise<MaxSummarizeResponse> {
  const res = await fetch(`${BASE_URL}/max/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function maxTestConnection(req: MaxTestRequest): Promise<MaxTestResponse> {
  const res = await fetch(`${BASE_URL}/max/test-connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}
