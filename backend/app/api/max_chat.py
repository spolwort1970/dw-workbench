"""Max AI assistant API endpoints."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models.schemas import (
    MaxChatRequest, MaxSummarizeRequest, MaxSummarizeResponse,
    MaxTestRequest, MaxTestResponse,
)
from app.services.max_runner import stream_chat, summarize, test_connection

router = APIRouter(prefix="/max", tags=["max"])


@router.post("/chat")
async def max_chat(req: MaxChatRequest) -> StreamingResponse:
    if req.provider == "anthropic" and not req.api_key:
        raise HTTPException(status_code=400, detail="api_key is required for Anthropic provider")
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages is required")

    return StreamingResponse(
        stream_chat(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/summarize", response_model=MaxSummarizeResponse)
async def max_summarize(req: MaxSummarizeRequest) -> MaxSummarizeResponse:
    if req.provider == "anthropic" and not req.api_key:
        raise HTTPException(status_code=400, detail="api_key is required for Anthropic provider")
    summary = await summarize(req)
    return MaxSummarizeResponse(summary=summary)


@router.post("/test-connection", response_model=MaxTestResponse)
async def max_test_connection(req: MaxTestRequest) -> MaxTestResponse:
    success, error, project_id = await test_connection(req.provider, req.api_key, req.vertex_region)
    return MaxTestResponse(success=success, error=error, project_id=project_id)
