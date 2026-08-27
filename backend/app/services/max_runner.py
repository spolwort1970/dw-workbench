"""Max AI assistant — streaming chat and summarization via Anthropic API, Google Vertex AI, or Claude Code CLI."""
from __future__ import annotations

import asyncio
import functools
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import AsyncIterator

import anthropic

from app.models.schemas import MaxChatRequest, MaxSummarizeRequest

# Claude Code CLI — signs in with the user's Claude account, so no API key is needed.
#
# The path was previously hardcoded to ~/.local/bin/claude.exe, which only exists for
# the native installer. An npm global install (the common case on Windows) puts it in
# %APPDATA%\npm instead, so the provider was listed in the UI but could never start.


def _native_exe_for(shim: Path) -> str | None:
    """
    Resolve an npm .cmd/.ps1 shim to the real executable it wraps.

    Going through the shim means going through cmd.exe, which re-parses the argv
    and mangles the multi-line prompt we pass to -p — short prompts survive, real
    ones come back empty. The bundled .exe takes the arguments verbatim.
    """
    native = shim.parent / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
    try:
        return str(native) if native.exists() else None
    except OSError:
        return None


@functools.lru_cache(maxsize=1)
def _find_claude_cli() -> str | None:
    """Locate the Claude Code CLI, or None if it isn't installed."""
    override = os.environ.get("DW_CLAUDE_CLI")
    if override and Path(override).exists():
        return override

    appdata = Path(os.environ.get("APPDATA", "") or os.devnull)

    # Prefer a real executable over a shell shim.
    direct = [
        Path.home() / ".local" / "bin" / "claude.exe",
        appdata / "npm" / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe",
    ]
    for c in direct:
        try:
            if c.exists():
                return str(c)
        except OSError:
            continue

    # shutil.which honours PATHEXT on Windows, so it finds claude.cmd / claude.ps1.
    found = shutil.which("claude")
    if found:
        return _native_exe_for(Path(found)) or found

    fallbacks = [
        Path.home() / ".local" / "bin" / "claude",
        appdata / "npm" / "claude.cmd",
        Path("/usr/local/bin/claude"),
    ]
    for c in fallbacks:
        try:
            if c.exists():
                return _native_exe_for(c) or str(c)
        except OSError:
            continue
    return None


def _cli_command(cli: str) -> list[str]:
    """
    Argv prefix for launching the CLI.

    A .cmd shim is a batch file — Windows cannot exec it directly, so it has to be
    run through cmd.exe or the subprocess call fails with ENOENT.
    """
    if sys.platform == "win32" and cli.lower().endswith((".cmd", ".bat")):
        return [os.environ.get("COMSPEC", "cmd.exe"), "/c", cli]
    return [cli]


# ── Model selection ───────────────────────────────────────────────────────────
#
# The user picks a family ("opus" / "sonnet"); the exact model is resolved at
# request time. Anthropic model IDs carry no floating "latest" alias, so the newest
# member of a family is discovered from the Models API and cached — that way the app
# follows new releases without a code change, and falls back to a known-good ID when
# the lookup is unavailable (offline, or the CLI provider, which has no Models API).

MODEL_FAMILIES = ("opus", "sonnet")

FAMILY_FALLBACK = {
    "opus":   "claude-opus-5",
    "sonnet": "claude-sonnet-5",
}

# Cheap model for the background summarizer — never the user's choice.
SUMMARY_MODEL = "claude-haiku-4-5"

_model_cache: dict[str, tuple[float, str]] = {}
_MODEL_CACHE_TTL = 6 * 60 * 60   # re-check for new releases a few times a day


def _family_of(model_id: str) -> str | None:
    for fam in MODEL_FAMILIES:
        if model_id.startswith(f"claude-{fam}-"):
            return fam
    return None


async def resolve_model(family: str, provider: str, api_key: str, vertex_region: str) -> str:
    """Newest model ID in `family`, falling back to a pinned known-good ID."""
    family = family if family in MODEL_FAMILIES else "sonnet"
    fallback = FAMILY_FALLBACK[family]

    # The CLI takes a family alias directly and does its own resolution.
    if provider == "claude-cli":
        return family

    cached = _model_cache.get(f"{provider}:{family}")
    if cached and (time.time() - cached[0]) < _MODEL_CACHE_TTL:
        return cached[1]

    try:
        client, _ = _make_client(provider, api_key, vertex_region)
        listing = await client.models.list()
        matches = [m for m in listing.data if _family_of(m.id) == family]
        if matches:
            # The API returns newest first; created_at breaks ties when present.
            newest = max(matches, key=lambda m: getattr(m, "created_at", "") or "")
            resolved = newest.id
            _model_cache[f"{provider}:{family}"] = (time.time(), resolved)
            return resolved
    except Exception:
        pass   # offline, bad key, or an older API — the pinned ID is still correct

    return fallback

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

Be concise and technical. Prefer working code examples. When you show DataWeave, use proper %dw 2.0 syntax.

## Building flows on the canvas

You can put flows directly onto the user's Flow Analyzer canvas. When they ask you
to build, add, scaffold, or change a flow, emit a ```dwflow fenced block holding
JSON. The app turns it into a button the user presses to apply it, so say what you
built in a sentence and let the block speak for itself — never also paste the same
flow as prose or XML.

Only emit a block when they want something built. For questions about an existing
flow, just answer.

```dwflow
{
  "flows": [
    {
      "name": "orderIntakeFlow",
      "type": "flow",
      "source": { "mimeType": "application/json", "payload": "{\\n  \\"orderId\\": \\"A-1\\"\\n}" },
      "processors": [
        { "type": "transform", "script": "%dw 2.0\\noutput application/json\\n---\\n{ id: payload.orderId }" },
        { "type": "set-variable", "name": "audit", "value": "uuid()" },
        { "type": "logger", "message": "received", "level": "INFO" },
        { "type": "choice", "routes": [
          { "when": "payload.total > 100", "processors": [ { "type": "logger", "message": "large" } ] },
          { "otherwise": true, "processors": [ { "type": "set-payload", "value": "small" } ] }
        ] },
        { "type": "for-each", "collection": "payload.items", "processors": [
          { "type": "logger", "message": "item" }
        ] },
        { "type": "try", "processors": [ { "type": "flow-reference", "flowName": "persistOrder" } ],
          "errorHandlers": [
            { "type": "on-error-continue", "errorType": "DB:CONNECTIVITY", "processors": [
              { "type": "raise-error", "errorType": "APP:RETRY", "description": "retry later" }
            ] }
          ] }
      ],
      "errorHandlers": [
        { "type": "on-error-propagate", "errorType": "ANY", "processors": [
          { "type": "logger", "message": { "expr": "error.description" }, "level": "ERROR" }
        ] }
      ]
    }
  ]
}
```

Rules for the block:
- Valid JSON only. No comments, no trailing commas. Escape newlines in strings as \\n.
- Processor types: set-payload, transform, set-variable, logger, choice, for-each,
  try, on-error-continue, on-error-propagate, raise-error, flow-reference.
- transform takes "script" for a payload transform, or "outputs" for several
  targets: [{"target":"variable","name":"x","value":"payload.a"}].
- Do not invent ids, x/y positions, or a "config" wrapper — the app fills those in.
- A plain string for "message" or "value" is literal text. For a DataWeave
  expression use {"expr": "error.description"}. "value" on set-variable and
  "collection" on for-each are already expressions, so a plain string is fine there.
- "type": "subflow" for a subflow. A flow-reference targets another flow by name,
  so include that flow in the same block when you reference one you are creating."""


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


def _build_system(req: MaxChatRequest, model_id: str | None = None) -> str:
    parts = [SYSTEM_PROMPT]

    # Max has no way to introspect this — without being told, it can only guess at
    # which model it is, and it guesses wrong.
    if model_id:
        family = _family_of(model_id) or (model_id if model_id in MODEL_FAMILIES else None)
        label = {"opus": "Claude Opus", "sonnet": "Claude Sonnet"}.get(family or "", "Claude")
        via = {
            "claude-cli": "the user's Claude account via the Claude Code CLI",
            "vertex":     "Google Vertex AI",
        }.get(req.provider, "the Anthropic API")
        parts.append(
            f"\n## Your model\n"
            f"You are running as {label} (model id `{model_id}`), through {via}. "
            "If the user asks which model you are, tell them this exactly — do not guess "
            "or claim a different version. They choose the model family in Settings."
        )

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
    model = await resolve_model(req.model_family, req.provider, req.api_key, req.vertex_region)

    if req.provider == "claude-cli":
        async for chunk in _cli_stream_chat(req, model):
            yield chunk
        return

    client, _ = _make_client(req.provider, req.api_key, req.vertex_region)
    system   = _build_system(req, model)
    messages = _convert_messages(req)

    async with client.messages.stream(
        model=model,
        max_tokens=4096,
        system=system,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield f"data: {json.dumps({'text': text})}\n\n"

    yield "data: [DONE]\n\n"


async def _cli_stream_chat(req: MaxChatRequest, model: str) -> AsyncIterator[str]:
    """Yield SSE chunks by streaming the Claude Code CLI subprocess.

    Images have already been processed via OCR in the frontend.
    """
    system = _build_system(req, model)

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

    cli = _find_claude_cli()
    if not cli:
        raise RuntimeError(
            "Claude Code CLI not found. Install it (npm install -g @anthropic-ai/claude-code), "
            "or set DW_CLAUDE_CLI to its full path, then restart DW Workbench."
        )

    cmd = [
        *_cli_command(cli),
        "-p", prompt_text,
        "--system-prompt", system,
        "--model", model,
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
        cli = _find_claude_cli()
        if not cli:
            return ""
        proc = await asyncio.create_subprocess_exec(
            *_cli_command(cli), "-p", prompt, "--model", "haiku",
            *_CLI_BASE_ARGS,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=_SUBPROCESS_FLAGS,
        )
        stdout, _ = await proc.communicate()
        return stdout.decode("utf-8", errors="replace").strip()

    client, _ = _make_client(req.provider, req.api_key, req.vertex_region)
    response = await client.messages.create(
        model=SUMMARY_MODEL,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


async def test_connection(provider: str, api_key: str, vertex_region: str) -> tuple[bool, str, str]:
    """Test connectivity. Returns (success, error_message, project_id)."""
    if provider == "claude-cli":
        try:
            cli = _find_claude_cli()
            if not cli:
                return False, (
                    "Claude Code CLI not found. Install it with "
                    "`npm install -g @anthropic-ai/claude-code`, or set DW_CLAUDE_CLI "
                    "to its full path."
                ), ""
            proc = await asyncio.create_subprocess_exec(
                *_cli_command(cli), "-p", "hi", "--model", "haiku",
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
        await client.messages.create(
            model=SUMMARY_MODEL,
            max_tokens=5,
            messages=[{"role": "user", "content": "hi"}],
        )
        return True, "", project_id or ""
    except Exception as e:
        return False, str(e), ""
