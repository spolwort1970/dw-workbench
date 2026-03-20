from fastapi import APIRouter, HTTPException
from app.models.schemas import ExecuteFlowRequest, ExecuteFlowResponse
from app.services.flow_runner import execute_flow

router = APIRouter()


@router.post("/execute-flow", response_model=ExecuteFlowResponse)
def execute_flow_endpoint(req: ExecuteFlowRequest) -> ExecuteFlowResponse:
    target = next((f for f in req.flows if f.id == req.flow_id), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Flow '{req.flow_id}' not found")

    _final_event, trace, sub_traces, error = execute_flow(
        flow=target,
        all_flows=req.flows,
        initial_event=req.event,
        visited={target.name},
    )
    success = error == "" and all(n.success for n in trace)
    return ExecuteFlowResponse(success=success, trace=trace, sub_traces=sub_traces, error=error)
