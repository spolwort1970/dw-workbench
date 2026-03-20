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
