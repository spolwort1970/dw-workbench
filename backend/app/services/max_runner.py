"""Max AI assistant — streaming chat and summarization via Anthropic API or Google Vertex AI."""
from __future__ import annotations

import json
import subprocess
from typing import AsyncIterator

import anthropic

from app.models.schemas import MaxChatRequest, MaxSummarizeRequest

SYSTEM_PROMPT = """You are Max, an AI assistant embedded in DW Workbench — a visual DataWeave script builder and flow analyzer for MuleSoft developers.

Your role is to help developers:
- Write, debug, and optimize DataWeave 2.0 transformation scripts
- Understand and design MuleSoft flow architectures
- Interpret execution traces and error messages
- Learn DataWeave concepts, functions, and best practices

When workspace context is provided (script, payload, output, errors, flow summary), use it to give precise, actionable answers. Reference specific lines or values when relevant.

Be concise and technical. Prefer working code examples. When you show DataWeave, use proper %dw 2.0 syntax."""


def _gcloud_project() -> str | None:
    """Auto-detect the active GCP project from gcloud config."""
    try:
        result = subprocess.run(
            ["gcloud", "config", "get-value", "project"],
            capture_output=True, text=True, timeout=5,
        )
        project = result.stdout.strip()
        return project if project and project != "(unset)" else None
    except Exception:
        return None


def _make_client(provider: str, api_key: str, vertex_region: str):
    """Return the appropriate Anthropic async client."""
    if provider == "vertex":
        project_id = _gcloud_project()
        if not project_id:
            raise RuntimeError(
                "Could not detect GCP project from gcloud. "
                "Ensure gcloud is installed and 'gcloud auth application-default login' has been run."
            )
        return anthropic.AsyncAnthropicVertex(project_id=project_id, region=vertex_region), project_id
    else:
        if not api_key:
            raise RuntimeError("Anthropic API key is required.")
        return anthropic.AsyncAnthropic(api_key=api_key), None


def _build_system(req: MaxChatRequest) -> str:
    parts = [SYSTEM_PROMPT]

    ctx = req.context

    if ctx.global_prefs:
        parts.append(f"\n## Global Preferences\n{ctx.global_prefs}")

    if ctx.project_prefs:
        parts.append(f"\n## Project Preferences ({ctx.project_name or 'current project'})\n{ctx.project_prefs}")

    if ctx.session_summary:
        parts.append(f"\n## Session Summary\n{ctx.session_summary}")

    workspace_parts: list[str] = []
    if ctx.project_name:
        workspace_parts.append(f"Project: {ctx.project_name}")
    if ctx.script:
        workspace_parts.append(f"### Current Script\n```dataweave\n{ctx.script}\n```")
    if ctx.payload:
        workspace_parts.append(f"### Input Payload\n```json\n{ctx.payload}\n```")
    if ctx.output:
        workspace_parts.append(f"### Script Output\n```\n{ctx.output}\n```")
    if ctx.error:
        workspace_parts.append(f"### Error\n```\n{ctx.error}\n```")
    if ctx.flow_summary:
        workspace_parts.append(f"### Flow State\n{ctx.flow_summary}")

    if workspace_parts:
        parts.append("\n## Current Workspace\n" + "\n\n".join(workspace_parts))

    return "\n".join(parts)


def _convert_messages(req: MaxChatRequest) -> list[dict]:
    """Convert MaxMessage list to Anthropic API message format."""
    result = []
    for msg in req.messages:
        content: list[dict] = []
        for part in msg.content:
            if part.type == "text" and part.text:
                content.append({"type": "text", "text": part.text})
            elif part.type == "image" and part.data and part.media_type:
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": part.media_type,
                        "data": part.data,
                    },
                })
        if content:
            result.append({"role": msg.role, "content": content})
    return result


async def stream_chat(req: MaxChatRequest) -> AsyncIterator[str]:
    """Yield SSE-formatted text chunks from Claude."""
    client, _ = _make_client(req.provider, req.api_key, req.vertex_region)
    system   = _build_system(req)
    messages = _convert_messages(req)

    async with client.messages.stream(
        model=req.model,
        max_tokens=4096,
        system=system,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield f"data: {json.dumps({'text': text})}\n\n"

    yield "data: [DONE]\n\n"


async def summarize(req: MaxSummarizeRequest) -> str:
    """Produce a concise session summary from message history."""
    client, _ = _make_client(req.provider, req.api_key, req.vertex_region)

    history_text = "\n".join(
        f"{m.role.upper()}: " + " ".join(p.text or "" for p in m.content if p.type == "text")
        for m in req.messages
    )

    prompt_parts = []
    if req.existing_summary:
        prompt_parts.append(f"Previous summary:\n{req.existing_summary}\n")
    prompt_parts.append(
        f"New conversation:\n{history_text}\n\n"
        "Write a concise summary (max 300 words) of this DataWeave/MuleSoft session. "
        "Focus on: what was built or fixed, key decisions made, open questions, "
        "and any script or flow details worth remembering. "
        "If there is a previous summary, merge the new information into it."
    )

    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": "\n".join(prompt_parts)}],
    )
    return response.content[0].text


async def test_connection(provider: str, api_key: str, vertex_region: str) -> tuple[bool, str, str]:
    """Test connectivity. Returns (success, error_message, project_id)."""
    try:
        client, project_id = _make_client(provider, api_key, vertex_region)
        await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=5,
            messages=[{"role": "user", "content": "hi"}],
        )
        return True, "", project_id or ""
    except Exception as e:
        return False, str(e), ""
