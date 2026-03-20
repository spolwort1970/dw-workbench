from fastapi import APIRouter, HTTPException
from app.models.schemas import (
    StartDebugRequest, StartDebugResponse,
    StepDebugResponse,
    EvaluateDebugRequest, EvaluateDebugResponse,
    SimEvent,
)
from app.services.debug_runner import create_session, get_session, delete_session, step
from app.services.flow_runner import evaluate_expression

router = APIRouter(prefix="/debug")


def _require_session(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Debug session not found or expired")
    return session


@router.post("/start", response_model=StartDebugResponse)
def debug_start(req: StartDebugRequest) -> StartDebugResponse:
    target = next((f for f in req.flows if f.id == req.flow_id), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Flow '{req.flow_id}' not found")

    session = create_session(target, req.flows, req.event)
    return StartDebugResponse(
        session_id        = session.session_id,
        current_proc_id   = session.current_proc_id,
        current_proc_name = session.current_proc_name,
        current_flow_id   = session.current_flow_id,
        current_event     = session.event,
        done              = session.done,
    )


@router.post("/step/{session_id}", response_model=StepDebugResponse)
def debug_step(session_id: str) -> StepDebugResponse:
    session                       = _require_session(session_id)
    trace_entry, extra_traces, done = step(session)
    return StepDebugResponse(
        trace             = trace_entry,
        extra_traces      = extra_traces,
        current_proc_id   = session.current_proc_id,
        current_proc_name = session.current_proc_name,
        current_flow_id   = session.current_flow_id,
        current_event     = session.event,
        sub_traces        = session.sub_traces,
        done              = done,
    )


@router.post("/evaluate/{session_id}", response_model=EvaluateDebugResponse)
def debug_evaluate(session_id: str, req: EvaluateDebugRequest) -> EvaluateDebugResponse:
    session = _require_session(session_id)
    result, error = evaluate_expression(req.expression, session.event)
    if error:
        return EvaluateDebugResponse(success=False, error=error)
    import json
    try:
        output = json.dumps(result, indent=2)
    except Exception:
        output = str(result)
    return EvaluateDebugResponse(success=True, result=result, output=output)


@router.delete("/session/{session_id}")
def debug_stop(session_id: str):
    delete_session(session_id)
    return {"status": "stopped"}
