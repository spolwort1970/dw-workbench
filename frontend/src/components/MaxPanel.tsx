import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { streamMaxChat, maxSummarize } from "../services/api";
import type { MaxMessage, MaxContext, MaxContentPart } from "../types/max";

const AUTO_SUMMARY_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_PANEL_HEIGHT = 280;   // docked mode only
const MIN_PANEL_HEIGHT     = 140;
const DEFAULT_INPUT_HEIGHT = 110;
const MIN_INPUT_HEIGHT     = 60;
const MAX_INPUT_HEIGHT     = 320;

interface PendingImage {
  dataUrl: string;
  data: string;
  mimeType: string;
}

export type MaxMode = "docked" | "tab" | "standalone";

interface Props {
  context?: MaxContext;
  mode?: MaxMode;
  onPopOut?: () => void;   // called when user clicks pop-out button (tab mode)
}

export default function MaxPanel({ context, mode = "tab", onPopOut }: Props) {
  // ── Panel sizing (docked only) ──────────────────────────────────
  const [collapsed,   setCollapsed]   = useState(false);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);

  // ── Inner sash (messages / input split) ────────────────────────
  const [inputHeight, setInputHeight] = useState(DEFAULT_INPUT_HEIGHT);

  // ── Chat state ─────────────────────────────────────────────────
  const [messages,       setMessages]       = useState<MaxMessage[]>([]);
  const [sessionSummary, setSessionSummary] = useState<string>(
    () => localStorage.getItem("dw-max-summary") ?? ""
  );
  const [input,          setInput]          = useState("");
  const [streaming,      setStreaming]      = useState(false);
  const [pendingImages,  setPendingImages]  = useState<PendingImage[]>([]);

  // ── Context (standalone reads from broadcast) ──────────────────
  const [liveContext, setLiveContext] = useState<MaxContext>(() => {
    if (mode === "standalone") {
      try { return JSON.parse(localStorage.getItem("dw-max-context") ?? "{}"); }
      catch { return {}; }
    }
    return {};
  });
  const activeContext = mode === "standalone" ? liveContext : (context ?? {});

  // ── API key ────────────────────────────────────────────────────
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("dw-max-api-key") ?? "");

  // ── Refs ────────────────────────────────────────────────────────
  const abortRef           = useRef<AbortController | null>(null);
  const messagesEndRef     = useRef<HTMLDivElement>(null);
  const textareaRef        = useRef<HTMLTextAreaElement>(null);
  const fileInputRef       = useRef<HTMLInputElement>(null);
  const autoSummaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Effects ────────────────────────────────────────────────────

  // API key sync across settings
  useEffect(() => {
    const handler = () => setApiKey(localStorage.getItem("dw-max-api-key") ?? "");
    window.addEventListener("dw-api-key-changed", handler);
    return () => window.removeEventListener("dw-api-key-changed", handler);
  }, []);

  // Standalone: listen for live context broadcasts
  useEffect(() => {
    if (mode !== "standalone") return;
    const ch = new BroadcastChannel("dw-max-context");
    ch.onmessage = (e) => setLiveContext(e.data);
    return () => ch.close();
  }, [mode]);

  // Standalone: set window title
  useEffect(() => {
    if (mode === "standalone") document.title = "Max — DW Workbench";
  }, [mode]);

  // Persist summary
  useEffect(() => {
    localStorage.setItem("dw-max-summary", sessionSummary);
  }, [sessionSummary]);

  // Startup recap from saved summary
  useEffect(() => {
    const saved = localStorage.getItem("dw-max-summary");
    if (saved) {
      setMessages([{
        role: "assistant",
        content: [{ type: "text", text: `Welcome back! Here's what we were working on last time:\n\n${saved}\n\nWhat would you like to pick up on?` }],
      }]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-summary timer
  useEffect(() => {
    autoSummaryTimerRef.current = setInterval(() => {
      if (messages.length > 0 && apiKey) doSummarize(false);
    }, AUTO_SUMMARY_INTERVAL_MS);
    return () => { if (autoSummaryTimerRef.current) clearInterval(autoSummaryTimerRef.current); };
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Summarize ──────────────────────────────────────────────────
  const doSummarize = useCallback(async (clearAfter: boolean) => {
    if (!apiKey || messages.length === 0) return;
    try {
      const res = await maxSummarize({
        api_key: apiKey,
        messages,
        existing_summary: sessionSummary || undefined,
      });
      setSessionSummary(res.summary);
      if (clearAfter) setMessages([]);
    } catch { /* ignore */ }
  }, [messages, sessionSummary, apiKey]);

  // ── Outer sash (docked mode panel height) ─────────────────────
  const onOuterSashMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY, startH = panelHeight;
    const onMove = (me: MouseEvent) => setPanelHeight(Math.max(MIN_PANEL_HEIGHT, startH + startY - me.clientY));
    const onUp   = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [panelHeight]);

  // ── Inner sash (messages / input) ─────────────────────────────
  const onInnerSashMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY, startH = inputHeight;
    const onMove = (me: MouseEvent) => {
      const next = startH + startY - me.clientY;
      setInputHeight(Math.max(MIN_INPUT_HEIGHT, Math.min(MAX_INPUT_HEIGHT, next)));
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [inputHeight]);

  // ── Image handling ─────────────────────────────────────────────
  const addImages = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setPendingImages((prev) => [...prev, { dataUrl, data: dataUrl.split(",")[1], mimeType: file.type }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) { const dt = new DataTransfer(); dt.items.add(file); addImages(dt.files); }
      }
    }
  }, [addImages]);

  // ── Send / Stop ────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    if (!apiKey) return;

    const userContent: MaxContentPart[] = [
      ...pendingImages.map((img): MaxContentPart => ({ type: "image", data: img.data, media_type: img.mimeType })),
      ...(text ? [{ type: "text" as const, text }] : []),
    ];

    const userMsg: MaxMessage = { role: "user", content: userContent };
    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, { role: "assistant", content: [{ type: "text", text: "" }] }]);
    setInput("");
    setPendingImages([]);
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await streamMaxChat(
        { api_key: apiKey, messages: newMessages, context: { ...activeContext, session_summary: sessionSummary || undefined }, model: "claude-sonnet-4-6" },
        (chunk) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role !== "assistant") return prev;
            return [...prev.slice(0, -1), { ...last, content: [{ type: "text", text: (last.content[0]?.text ?? "") + chunk }] }];
          });
        },
        abort.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role !== "assistant") return prev;
          return [...prev.slice(0, -1), { ...last, content: [{ type: "text", text: `_Error: ${msg}_` }] }];
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, pendingImages, messages, apiKey, activeContext, sessionSummary]);

  const handleStop    = useCallback(() => abortRef.current?.abort(), []);
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!streaming) handleSend(); }
  }, [streaming, handleSend]);

  // ── Export / Archive ───────────────────────────────────────────
  const handleExport = useCallback(() => {
    const lines: string[] = [`# Max Session — ${new Date().toLocaleString()}\n`];
    if (sessionSummary) lines.push(`## Session Summary\n${sessionSummary}\n\n---\n`);
    messages.forEach((msg) => {
      const role = msg.role === "user" ? "**You**" : "**Max**";
      const text = msg.content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
      const imgs = msg.content.filter((p) => p.type === "image").length;
      lines.push(`${role}: ${text}${imgs > 0 ? `\n_[${imgs} image(s) attached]_` : ""}\n`);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "max-session.md"; a.click();
    URL.revokeObjectURL(url);
  }, [messages, sessionSummary]);

  const handleArchive = useCallback(async () => { await doSummarize(true); }, [doSummarize]);

  // ── Render ─────────────────────────────────────────────────────
  const isDocked     = mode === "docked";
  const isStandalone = mode === "standalone";
  const isTab        = mode === "tab";

  return (
    <div
      className={`max-panel max-panel--${mode} ${isDocked && collapsed ? "max-panel--collapsed" : ""}`}
      style={isDocked && !collapsed ? { height: panelHeight } : undefined}
    >
      {/* Outer sash — docked mode only */}
      {isDocked && !collapsed && (
        <div className="max-sash" onMouseDown={onOuterSashMouseDown} title="Drag to resize" />
      )}

      {/* Header */}
      <div className="max-header">
        {isDocked ? (
          <button className="max-title-btn" onClick={() => setCollapsed(v => !v)} title={collapsed ? "Expand Max" : "Collapse Max"}>
            <span className="max-title-caret">{collapsed ? "▸" : "▾"}</span>
            Max
          </button>
        ) : (
          <span className="max-title-label">Max</span>
        )}

        <div className="max-header-actions">
          {!collapsed && (
            <>
              {sessionSummary && <span className="max-summary-badge" title={sessionSummary}>Summary ✓</span>}
              <button className="max-action-btn" onClick={handleExport}  title="Export conversation as Markdown" disabled={messages.length === 0}>Export</button>
              <button className="max-action-btn" onClick={handleArchive} title="Summarize and clear conversation"  disabled={messages.length === 0 || streaming}>Archive</button>
            </>
          )}
          {isTab && onPopOut && (
            <button className="max-action-btn max-action-btn--popout" onClick={onPopOut} title="Open Max in its own window">
              ↗ Pop out
            </button>
          )}
        </div>
      </div>

      {/* Body — hidden when docked + collapsed */}
      {(!isDocked || !collapsed) && (
        <>
          {/* Messages */}
          <div className="max-messages">
            {!apiKey && <div className="max-no-key">Enter your Anthropic API key in Settings (gear icon) to use Max.</div>}
            {apiKey && messages.length === 0 && <div className="max-empty">Ask Max anything about your DataWeave script or MuleSoft flow.</div>}
            {messages.map((msg, i) => (
              <div key={i} className={`max-message max-message--${msg.role}`}>
                <span className="max-message-role">{msg.role === "user" ? "You" : "Max"}</span>
                <div className="max-message-body">
                  {msg.content.map((part, j) => {
                    if (part.type === "image" && part.data)
                      return <img key={j} className="max-image-thumb" src={`data:${part.media_type};base64,${part.data}`} alt="attached" />;
                    if (msg.role === "assistant")
                      return <ReactMarkdown key={j}>{part.text ?? ""}</ReactMarkdown>;
                    return <p key={j}>{part.text}</p>;
                  })}
                  {msg.role === "assistant" && streaming && i === messages.length - 1 && <span className="max-cursor" />}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Inner sash */}
          <div className="max-inner-sash" onMouseDown={onInnerSashMouseDown} title="Drag to resize input area" />

          {/* Pending images */}
          {pendingImages.length > 0 && (
            <div className="max-pending-images">
              {pendingImages.map((img, i) => (
                <div key={i} className="max-pending-thumb">
                  <img src={img.dataUrl} alt="pending" />
                  <button className="max-pending-remove" onClick={() => setPendingImages(prev => prev.filter((_, idx) => idx !== i))} title="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="max-input-bar" style={{ height: inputHeight }}>
            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addImages(e.target.files); e.target.value = ""; }} />
            <textarea
              ref={textareaRef}
              className="max-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={apiKey ? "Ask Max… (Enter to send, Shift+Enter for newline)" : "Add API key in Settings to use Max"}
              disabled={!apiKey}
            />
            <div className="max-input-btns">
              <button className="max-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file"><PaperclipIcon /></button>
              {streaming
                ? <button className="max-send-btn max-send-btn--stop" onClick={handleStop} title="Stop"><StopIcon /></button>
                : <button className="max-send-btn" onClick={handleSend} disabled={!apiKey || (!input.trim() && pendingImages.length === 0)} title="Send (Enter)"><SendIcon /></button>
              }
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
function StopIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>;
}
function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
