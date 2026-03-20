from fastapi import APIRouter
from app.models.schemas import ExecuteDWRequest, ExecuteDWResponse
from app.services.dw_runner import run_dw

router = APIRouter()


@router.post("/execute-dw", response_model=ExecuteDWResponse)
def execute_dw(req: ExecuteDWRequest) -> ExecuteDWResponse:
    result = run_dw(
        script=req.script,
        payload=req.payload,
        input_mime_type=req.input_mime_type,
        attributes=req.attributes,
        vars_=req.vars,
    )
    return ExecuteDWResponse(**result)
