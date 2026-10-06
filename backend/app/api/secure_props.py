from fastapi import APIRouter
from app.models.schemas import (
    SecurePropsRequest,
    SecurePropsResponse,
    SecurePropsEnvsResponse,
)
from app.services.secure_props_runner import run_secure_props, environments_payload

router = APIRouter()


@router.get("/secure-properties/envs", response_model=SecurePropsEnvsResponse)
def secure_props_envs() -> SecurePropsEnvsResponse:
    return SecurePropsEnvsResponse(**environments_payload())


@router.post("/secure-properties", response_model=SecurePropsResponse)
def secure_properties(req: SecurePropsRequest) -> SecurePropsResponse:
    result = run_secure_props(
        operation=req.operation,
        environment=req.environment,
        algorithm=req.algorithm,
        mode=req.mode,
        use_random_iv=req.use_random_iv,
        value=req.value,
    )
    return SecurePropsResponse(**result)
