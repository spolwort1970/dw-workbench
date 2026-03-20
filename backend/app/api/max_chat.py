"""Max AI assistant API endpoints."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models.schemas import MaxChatRequest, MaxSummarizeRequest, MaxSummarizeResponse
from app.services.max_runner import stream_chat, summarize

router = APIRouter(prefix="/max", tags=["max"])


@router.post("/chat")
async def max_chat(req: MaxChatRequest) -> StreamingResponse:
    if not req.api_key:
        raise HTTPException(status_code=400, detail="api_key is required")
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
    if not req.api_key:
        raise HTTPException(status_code=400, detail="api_key is required")
    summary = await summarize(req)
    return MaxSummarizeResponse(summary=summary)
