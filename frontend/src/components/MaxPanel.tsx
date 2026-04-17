import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { createWorker } from 'tesseract.js';
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
  const [messages, setMessages] = useState<MaxMessage[]>(() => {
    try {
      const saved = localStorage.getItem("dw-max-messages");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [sessionSummary, setSessionSummary] = useState<string>(
    () => localStorage.getItem("dw-max-summary") ?? ""
  );
  // Recap is shown as a separate banner (not in messages) so Archive doesn't treat it as conversation.
  // sessionStorage tracks dismissal so it doesn't re-appear on tab switch within the same session.
  const [recap, setRecap] = useState<string | null>(() => {
    if (sessionStorage.getItem("dw-max-recap-dismissed") === "true") return null;
    try {
      const saved = localStorage.getItem("dw-max-messages");
      const parsed = saved ? JSON.parse(saved) : [];
      if (parsed.length === 0) return localStorage.getItem("dw-max-summary");
    } catch { /* ignore */ }
    return null;
  });
  const [input,          setInput]          = useState("");
  const [streaming,      setStreaming]      = useState(false);
  const [pendingImages,  setPendingImages]  = useState<PendingImage[]>([]);

  // ── Ghost overlay state (standalone only) ─────────────────────
  const [isGhosted, setIsGhosted] = useState(false);

  // ── Snap state (standalone only) ──────────────────────────────
  const [snapEdge,     setSnapEdge]     = useState<string | null>(null);
  const [snapMenuOpen, setSnapMenuOpen] = useState(false);

  // ── Context (standalone reads from broadcast) ──────────────────
  const [liveContext, setLiveContext] = useState<MaxContext>(() => {
    if (mode === "standalone") {
      try { return JSON.parse(localStorage.getItem("dw-max-context") ?? "{}"); }
      catch { return {}; }
    }
    return {};
  });
  const activeContext = mode === "standalone" ? liveContext : (context ?? {});

  // ── API key / provider ─────────────────────────────────────────
  const [apiKey,       setApiKey]       = useState(() => localStorage.getItem("dw-max-api-key") ?? "");
  const [provider,     setProvider]     = useState(() => localStorage.getItem("dw-max-provider") ?? "anthropic");
  const [vertexRegion, setVertexRegion] = useState(() => localStorage.getItem("dw-max-vertex-region") ?? "us-east5");

  // ── Refs ────────────────────────────────────────────────────────
  const abortRef           = useRef<AbortController | null>(null);
  const sendingRef         = useRef(false);
  const messagesEndRef     = useRef<HTMLDivElement>(null);
  const textareaRef        = useRef<HTMLTextAreaElement>(null);
  const fileInputRef       = useRef<HTMLInputElement>(null);
  const autoSummaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Effects ────────────────────────────────────────────────────

  // API key / provider sync across settings
  useEffect(() => {
    const handler = () => {
      setApiKey(localStorage.getItem("dw-max-api-key") ?? "");
      setProvider(localStorage.getItem("dw-max-provider") ?? "anthropic");
      setVertexRegion(localStorage.getItem("dw-max-vertex-region") ?? "us-east5");
    };
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

  // Standalone: listen for ghost + snap state from main process
  useEffect(() => {
    if (mode !== "standalone") return;
    const api = (window as any).electronAPI;
    if (!api) return;
    api.on("max-ghost-state", (val: boolean) => setIsGhosted(val));
    api.on("max-snap-state",  (val: { snapped: boolean; edge: string | null }) =>
      setSnapEdge(val.snapped ? val.edge : null)
    );
    return () => {
      api.removeAllListeners("max-ghost-state");
      api.removeAllListeners("max-snap-state");
    };
  }, [mode]);

  // Standalone: hover for 2 seconds while ghosted → restore opacity
  //             mouse leaves without clicking → re-ghost
  useEffect(() => {
    if (mode !== "standalone") return;

    type GhostState = "focused" | "ghosted" | "hover-restored";
    let state: GhostState = "focused";
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;

    const onBlur  = () => {
      state = "ghosted";
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    };
    const onFocus = () => {
      state = "focused";
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    };
    const onMouseMove = () => {
      if (state !== "ghosted" || hoverTimer) return;
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        if (state === "ghosted") {
          state = "hover-restored";
          (window as any).electronAPI?.send("max-hover-restore");
        }
      }, 500);
    };
    const onMouseLeave = () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (state === "hover-restored") {
        state = "ghosted";
        (window as any).electronAPI?.send("max-hover-ghost");
      }
    };

    window.addEventListener("blur",         onBlur);
    window.addEventListener("focus",        onFocus);
    document.addEventListener("mousemove",  onMouseMove);
    document.addEventListener("mouseleave", onMouseLeave);
    return () => {
      window.removeEventListener("blur",         onBlur);
      window.removeEventListener("focus",        onFocus);
      document.removeEventListener("mousemove",  onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      if (hoverTimer) clearTimeout(hoverTimer);
    };
  }, [mode]);

  // Persist messages
  useEffect(() => {
    localStorage.setItem("dw-max-messages", JSON.stringify(messages));
  }, [messages]);

  // Persist summary
  useEffect(() => {
    localStorage.setItem("dw-max-summary", sessionSummary);
  }, [sessionSummary]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-summary timer
  useEffect(() => {
    autoSummaryTimerRef.current = setInterval(() => {
      if (messages.length > 0 && isReady) doSummarize(false);
    }, AUTO_SUMMARY_INTERVAL_MS);
    return () => { if (autoSummaryTimerRef.current) clearInterval(autoSummaryTimerRef.current); };
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Summarize ──────────────────────────────────────────────────
  const isReady = provider === "vertex" || provider === "claude-cli" || !!apiKey;

  const doSummarize = useCallback(async (clearAfter: boolean) => {
    if (!isReady || messages.length === 0) return;
    try {
      const res = await maxSummarize({
        api_key: apiKey,
        provider: provider as any,
        vertex_region: vertexRegion,
        messages,
        existing_summary: sessionSummary || undefined,
      });
      setSessionSummary(res.summary);
      if (clearAfter) { setMessages([]); setRecap(null); sessionStorage.removeItem("dw-max-recap-dismissed"); }
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
    if (!isReady || sendingRef.current) return;
    sendingRef.current = true;

    // Capture and clear immediately so the UI blocks further sends during OCR
    const capturedImages = pendingImages;
    setInput("");
    setPendingImages([]);
    setStreaming(true);
    sessionStorage.setItem("dw-max-recap-dismissed", "true");
    setRecap(null);

    // Run OCR on images only for CLI provider (API providers read images natively)
    const ocrTexts: string[] = [];
    if (capturedImages.length > 0 && provider === "claude-cli") {
      try {
        const worker = await createWorker('eng');
        for (const img of capturedImages) {
          const { data: { text: ocrText } } = await worker.recognize(img.dataUrl);
          if (ocrText.trim()) {
            ocrTexts.push(ocrText.trim());
          }
        }
        await worker.terminate();
      } catch (err) {
        console.error('OCR failed:', err);
      }
    }

    const useOcrOnly = provider === "claude-cli";
    const userContent: MaxContentPart[] = [
      // For CLI provider: images can't be sent, use OCR text instead
      // For API providers: send the image directly (Claude reads it natively)
      ...(!useOcrOnly ? capturedImages.map((img): MaxContentPart => ({ type: "image", data: img.data, media_type: img.mimeType })) : []),
      ...(text ? [{ type: "text" as const, text }] : []),
      ...(useOcrOnly ? ocrTexts.map((ocrText): MaxContentPart => ({
        type: "text" as const,
        text: `\n\n[Text extracted from screenshot]:\n${ocrText}`
      })) : []),
    ];

    const userMsg: MaxMessage = { role: "user", content: userContent };
    const newMessages = [...messages, userMsg];
    setMessages([...newMessages, { role: "assistant", content: [{ type: "text", text: "" }] }]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await streamMaxChat(
        { api_key: apiKey, provider: provider as any, vertex_region: vertexRegion, messages: newMessages, context: { ...activeContext, session_summary: sessionSummary || undefined }, model: "claude-sonnet-4-6" },
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
      sendingRef.current = false;
    }
  }, [input, pendingImages, messages, apiKey, activeContext, sessionSummary, provider, vertexRegion, isReady]);

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
          {isStandalone && (
            <div className="max-snap-wrapper">
              <button
                className={`max-action-btn max-action-btn--snap ${snapEdge ? "max-action-btn--snap-active" : ""}`}
                onClick={() => setSnapMenuOpen(v => !v)}
                title="Snap window to edge"
              >
                QuickSnap {snapEdge ? `· ${snapEdge}` : "▾"}
              </button>
              {snapMenuOpen && (
                <div className="max-snap-menu">
                  {(["left", "right", "bottom"] as const).map(edge => (
                    <button
                      key={edge}
                      className={`max-snap-option ${snapEdge === edge ? "max-snap-option--active" : ""}`}
                      onClick={() => {
                        (window as any).electronAPI?.send("max-snap-to", edge);
                        setSnapMenuOpen(false);
                      }}
                    >
                      {edge.charAt(0).toUpperCase() + edge.slice(1)} edge
                    </button>
                  ))}
                  {snapEdge && (
                    <button
                      className="max-snap-option max-snap-option--float"
                      onClick={() => {
                        (window as any).electronAPI?.send("max-unsnap");
                        setSnapMenuOpen(false);
                      }}
                    >
                      Float (unsnap)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body — hidden when docked + collapsed */}
      {(!isDocked || !collapsed) && (
        <>
          {/* Messages */}
          <div className="max-messages">
            {!isReady && <div className="max-no-key">{provider === "vertex" ? "Configure Google Vertex AI in Settings (gear icon) to use Max." : provider === "claude-cli" ? "Claude Code provider selected — click Test Connection in Settings to verify." : "Enter your Anthropic API key in Settings (gear icon) to use Max."}</div>}
            {recap && (
              <div className="max-recap">
                <div className="max-recap-header">
                  <span>Last session recap</span>
                  <button className="max-recap-dismiss" onClick={() => { sessionStorage.setItem("dw-max-recap-dismissed", "true"); setRecap(null); }} title="Dismiss">✕</button>
                </div>
                <div className="max-recap-body"><ReactMarkdown>{recap}</ReactMarkdown></div>
              </div>
            )}
            {isReady && messages.length === 0 && !recap && <div className="max-empty">Ask Max anything about your DataWeave script or MuleSoft flow.</div>}
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
              placeholder={isReady ? "Ask Max… (Enter to send, Shift+Enter for newline)" : "Configure AI provider in Settings to use Max"}
              disabled={!isReady}
            />
            <div className="max-input-btns">
              <button className="max-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file"><PaperclipIcon /></button>
              {streaming
                ? <button className="max-send-btn max-send-btn--stop" onClick={handleStop} title="Stop"><StopIcon /></button>
                : <button className="max-send-btn" onClick={handleSend} disabled={!isReady || (!input.trim() && pendingImages.length === 0)} title="Send (Enter)"><SendIcon /></button>
              }
            </div>
          </div>
        </>
      )}
      {/* Ghost overlay — standalone mode only */}
      {mode === "standalone" && (
        <div className={`max-ghost-overlay${isGhosted ? " max-ghost-overlay--active" : ""}`} />
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
