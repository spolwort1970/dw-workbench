from pydantic import BaseModel
from typing import Any


class ExecuteDWRequest(BaseModel):
    script: str
    payload: Any = None
    input_mime_type: str = "application/json"
    attributes: dict[str, Any] = {}
    vars: dict[str, Any] = {}


class ExecuteDWResponse(BaseModel):
    success: bool
    output: Any = None
    stdout: str = ""
    stderr: str = ""
    error: str = ""


# ── Flow execution ─────────────────────────────────────────────────────────────

class SimEvent(BaseModel):
    """The Mule message travelling through a flow."""
    payload: Any = None
    mimeType: str = "application/json"
    attributes: dict[str, Any] = {}
    variables: dict[str, Any] = {}


class NodeTrace(BaseModel):
    """Execution record for a single processor."""
    procId: str
    procType: str
    displayName: str
    input: SimEvent
    output: SimEvent
    logs: list[str] = []
    error: str = ""
    success: bool = True
    skipped: bool = False


class ProcessorDef(BaseModel):
    id: str
    type: str
    displayName: str
    config: dict[str, Any] = {}


class FlowDef(BaseModel):
    id: str
    name: str
    type: str  # "flow" | "subflow"
    processors: list[ProcessorDef] = []
    errorHandlers: list[ProcessorDef] = []
    source: dict[str, Any] = {}


class ExecuteFlowRequest(BaseModel):
    flow_id: str
    flows: list[FlowDef]  # all flows in the canvas (for flow-reference resolution)
    event: SimEvent        # initial SimEvent (built from source config)


class ExecuteFlowResponse(BaseModel):
    success: bool
    trace: list[NodeTrace] = []
    sub_traces: dict[str, list[NodeTrace]] = {}  # flowId -> trace for each called subflow
    error: str = ""


# ── Debug session ─────────────────────────────────────────────────────────────

class StartDebugRequest(BaseModel):
    flow_id: str
    flows: list[FlowDef]
    event: SimEvent


class StartDebugResponse(BaseModel):
    session_id: str
    current_proc_id: str | None
    current_proc_name: str | None
    current_flow_id: str | None
    current_event: SimEvent
    done: bool


class StepDebugResponse(BaseModel):
    trace: NodeTrace | None = None
    extra_traces: list[NodeTrace] = []   # skipped branch traces from choice
    current_proc_id: str | None
    current_proc_name: str | None
    current_flow_id: str | None
    current_event: SimEvent
    sub_traces: dict[str, list[NodeTrace]] = {}
    done: bool


class EvaluateDebugRequest(BaseModel):
    expression: str


class EvaluateDebugResponse(BaseModel):
    success: bool
    result: Any = None
    output: str = ""
    error: str = ""


# ── Max AI assistant ───────────────────────────────────────────────────────────

class MaxContentPart(BaseModel):
    """A single part of a message — text or base64 image."""
    type: str  # "text" | "image"
    text: str | None = None
    # For images: base64-encoded data and media type
    data: str | None = None
    media_type: str | None = None  # e.g. "image/png"


class MaxMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: list[MaxContentPart]


class MaxContext(BaseModel):
    """Optional workspace snapshot sent with each request."""
    script: str | None = None
    payload: str | None = None
    output: str | None = None
    error: str | None = None
    flow_summary: str | None = None
    project_name: str | None = None
    session_summary: str | None = None
    global_prefs: str | None = None
    project_prefs: str | None = None


class MaxChatRequest(BaseModel):
    api_key: str = ""
    provider: str = "anthropic"       # "anthropic" | "vertex"
    vertex_region: str = "us-east5"   # only used when provider="vertex"
    messages: list[MaxMessage]
    context: MaxContext = MaxContext()
    model: str = "claude-sonnet-4-6"


class MaxSummarizeRequest(BaseModel):
    api_key: str = ""
    provider: str = "anthropic"
    vertex_region: str = "us-east5"
    messages: list[MaxMessage]
    existing_summary: str | None = None


class MaxSummarizeResponse(BaseModel):
    summary: str


class MaxTestRequest(BaseModel):
    provider: str = "anthropic"
    api_key: str = ""
    vertex_region: str = "us-east5"


class MaxTestResponse(BaseModel):
    success: bool
    error: str = ""
    project_id: str = ""   # echoed back so user can see what was detected
