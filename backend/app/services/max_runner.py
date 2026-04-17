"""Max AI assistant — streaming chat and summarization via Anthropic API, Google Vertex AI, or Claude Code CLI."""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import AsyncIterator

import anthropic

from app.models.schemas import MaxChatRequest, MaxSummarizeRequest

# Claude Code CLI — uses the same auth as the VS Code extension (no API key needed)
CLAUDE_CLI = str(Path.home() / ".local" / "bin" / "claude.exe")

# Hide console window on Windows when launching subprocesses
_SUBPROCESS_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

_CLI_BASE_ARGS = [
    "--tools", "",
    "--permission-mode", "bypassPermissions",
]

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


def _translate_model_for_vertex(model: str) -> str:
    """Convert Anthropic API model IDs to Vertex AI equivalents."""
    mapping = {
        "claude-sonnet-4-6": "claude-3-5-sonnet-v2@20241022",
        "claude-opus-4-6": "claude-3-opus@20240229",
        "claude-haiku-4-5-20251001": "claude-3-5-haiku@20241022",
    }
    return mapping.get(model, model)


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
    if req.provider == "claude-cli":
        async for chunk in _cli_stream_chat(req):
            yield chunk
        return

    client, _ = _make_client(req.provider, req.api_key, req.vertex_region)
    system   = _build_system(req)
    messages = _convert_messages(req)

    model = _translate_model_for_vertex(req.model) if req.provider == "vertex" else req.model

    async with client.messages.stream(
        model=model,
        max_tokens=4096,
        system=system,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield f"data: {json.dumps({'text': text})}\n\n"

    yield "data: [DONE]\n\n"


async def _cli_stream_chat(req: MaxChatRequest) -> AsyncIterator[str]:
    """Yield SSE chunks by streaming the Claude Code CLI subprocess.

    Images have already been processed via OCR in the frontend.
    """
    system = _build_system(req)

    # Filter out ONLY the last message if it's an empty assistant placeholder
    filtered_messages = list(req.messages)
    if (len(filtered_messages) > 1 and
        filtered_messages[-1].role == "assistant" and
        all(not p.text for p in filtered_messages[-1].content if p.type == "text")):
        filtered_messages = filtered_messages[:-1]

    if not filtered_messages:
        raise ValueError("No messages to send to Claude CLI")

    # Build prompt with full conversation history so Claude knows what it already said.
    history_parts: list[str] = []
    for msg in filtered_messages[:-1]:
        role_label = "USER" if msg.role == "user" else "ASSISTANT"
        text = " ".join(p.text or "" for p in msg.content if p.type == "text").strip()
        if text:
            history_parts.append(f"{role_label}: {text}")

    last_msg = filtered_messages[-1]
    last_text = " ".join(p.text or "" for p in last_msg.content if p.type == "text").strip()

    if history_parts:
        prompt_text = (
            "Here is our conversation so far:\n\n"
            + "\n\n".join(history_parts)
            + "\n\n---\n\nNow respond to this latest message:\n\n"
            + last_text
        )
    else:
        prompt_text = last_text

    cmd = [
        CLAUDE_CLI,
        "-p", prompt_text,
        "--system-prompt", system,
        "--model", req.model,
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        *_CLI_BASE_ARGS,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        creationflags=_SUBPROCESS_FLAGS,
    )

    assert proc.stdout is not None

    async for raw_line in proc.stdout:
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            event = json.loads(line)
            if event.get("type") == "stream_event":
                inner = event.get("event", {})
                if inner.get("type") == "content_block_delta":
                    delta = inner.get("delta", {})
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        yield f"data: {json.dumps({'text': delta['text']})}\n\n"
        except json.JSONDecodeError:
            pass

    await proc.wait()
    yield "data: [DONE]\n\n"


async def summarize(req: MaxSummarizeRequest) -> str:
    """Produce a concise session summary from message history."""
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
    prompt = "\n".join(prompt_parts)

    if req.provider == "claude-cli":
        proc = await asyncio.create_subprocess_exec(
            CLAUDE_CLI, "-p", prompt, "--model", "haiku",
            *_CLI_BASE_ARGS,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=_SUBPROCESS_FLAGS,
        )
        stdout, _ = await proc.communicate()
        return stdout.decode("utf-8", errors="replace").strip()

    client, _ = _make_client(req.provider, req.api_key, req.vertex_region)
    model = "claude-3-5-haiku@20241022" if req.provider == "vertex" else "claude-haiku-4-5-20251001"

    response = await client.messages.create(
        model=model,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


async def test_connection(provider: str, api_key: str, vertex_region: str) -> tuple[bool, str, str]:
    """Test connectivity. Returns (success, error_message, project_id)."""
    if provider == "claude-cli":
        try:
            proc = await asyncio.create_subprocess_exec(
                CLAUDE_CLI, "-p", "hi", "--model", "haiku",
                *_CLI_BASE_ARGS,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=_SUBPROCESS_FLAGS,
            )
            _, stderr = await proc.communicate()
            if proc.returncode == 0:
                return True, "", "Claude Code CLI"
            return False, stderr.decode("utf-8", errors="replace").strip() or "Unknown error", ""
        except Exception as e:
            return False, str(e), ""

    try:
        client, project_id = _make_client(provider, api_key, vertex_region)
        model = "claude-3-5-haiku@20241022" if provider == "vertex" else "claude-haiku-4-5-20251001"
        await client.messages.create(
            model=model,
            max_tokens=5,
            messages=[{"role": "user", "content": "hi"}],
        )
        return True, "", project_id or ""
    except Exception as e:
        return False, str(e), ""
