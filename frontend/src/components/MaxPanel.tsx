import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { streamMaxChat, maxSummarize } from "../services/api";
import type { MaxMessage, MaxContext, MaxContentPart } from "../types/max";

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 140;
const AUTO_SUMMARY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

interface PendingImage {
  dataUrl: string; // full data URL for preview
  data: string;    // base64 only (no prefix)
  mimeType: string;
}

interface Props {
  context: MaxContext;
}

export default function MaxPanel({ context }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const [messages, setMessages] = useState<MaxMessage[]>([]);
  const [sessionSummary, setSessionSummary] = useState<string>("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);

  const [apiKey, setApiKey] = useState(() => localStorage.getItem("dw-max-api-key") ?? "");

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSummaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync when the user saves a key in Settings (same window — storage event won't fire)
  useEffect(() => {
    const handler = () => setApiKey(localStorage.getItem("dw-max-api-key") ?? "");
    window.addEventListener("dw-api-key-changed", handler);
    return () => window.removeEventListener("dw-api-key-changed", handler);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);


  // Auto-summary timer
  useEffect(() => {
    autoSummaryTimerRef.current = setInterval(() => {
      if (messages.length > 0 && apiKey) {
        doSummarize(false);
      }
    }, AUTO_SUMMARY_INTERVAL_MS);
    return () => {
      if (autoSummaryTimerRef.current) clearInterval(autoSummaryTimerRef.current);
    };
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSummarize = useCallback(async (clearAfter: boolean) => {
    const key = apiKey;
    if (!key || messages.length === 0) return;
    try {
      const res = await maxSummarize({
        api_key: key,
        messages,
        existing_summary: sessionSummary || undefined,
      });
      setSessionSummary(res.summary);
      if (clearAfter) setMessages([]);
    } catch { /* ignore summarize errors */ }
  }, [messages, sessionSummary]);

  // Sash drag: resize panel height by dragging its top border
  const onSashMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = panelHeight;
    const onMove = (me: MouseEvent) => {
      const delta = startY - me.clientY;
      setPanelHeight(Math.max(MIN_HEIGHT, startH + delta));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelHeight]);

  const addImages = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const base64 = dataUrl.split(",")[1];
        setPendingImages((prev) => [...prev, { dataUrl, data: base64, mimeType: file.type }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        addImages(item.getAsFile() ? (() => {
          const dt = new DataTransfer();
          dt.items.add(item.getAsFile()!);
          return dt.files;
        })() : null);
      }
    }
  }, [addImages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    const key = apiKey;
    if (!key) return;

    const userContent: MaxContentPart[] = [
      ...pendingImages.map((img): MaxContentPart => ({
        type: "image", data: img.data, media_type: img.mimeType,
      })),
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
        {
          api_key: key,
          messages: newMessages,
          context: { ...context, session_summary: sessionSummary || undefined },
          model: "claude-sonnet-4-6",
        },
        (chunk) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role !== "assistant") return prev;
            const updated: MaxMessage = {
              ...last,
              content: [{ type: "text", text: (last.content[0]?.text ?? "") + chunk }],
            };
            return [...prev.slice(0, -1), updated];
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
          const updated: MaxMessage = {
            ...last,
            content: [{ type: "text", text: `_Error: ${msg}_` }],
          };
          return [...prev.slice(0, -1), updated];
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, pendingImages, messages, context, sessionSummary]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) handleSend();
    }
  }, [streaming, handleSend]);

  const handleExport = useCallback(() => {
    const lines: string[] = [`# Max Session — ${new Date().toLocaleString()}\n`];
    if (sessionSummary) lines.push(`## Session Summary\n${sessionSummary}\n\n---\n`);
    messages.forEach((msg) => {
      const role = msg.role === "user" ? "**You**" : "**Max**";
      const textParts = msg.content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
      const imgCount = msg.content.filter((p) => p.type === "image").length;
      const imgNote = imgCount > 0 ? `\n_[${imgCount} image(s) attached]_` : "";
      lines.push(`${role}: ${textParts}${imgNote}\n`);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "max-session.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [messages, sessionSummary]);

  const handleArchive = useCallback(async () => {
    await doSummarize(true);
  }, [doSummarize]);

  const key = apiKey;

  return (
    <div className={`max-panel ${collapsed ? "max-panel--collapsed" : ""}`}
      style={collapsed ? undefined : { height: panelHeight }}>

      {/* Sash */}
      {!collapsed && (
        <div className="max-sash" onMouseDown={onSashMouseDown} title="Drag to resize Max panel" />
      )}

      {/* Header */}
      <div className="max-header">
        <button
          className="max-title-btn"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand Max" : "Collapse Max"}
        >
          <span className="max-title-caret">{collapsed ? "▸" : "▾"}</span>
          Max
        </button>
        {!collapsed && (
          <div className="max-header-actions">
            {sessionSummary && (
              <span className="max-summary-badge" title={sessionSummary}>Summary ✓</span>
            )}
            <button className="max-action-btn" onClick={handleExport} title="Export conversation as Markdown" disabled={messages.length === 0}>
              Export
            </button>
            <button className="max-action-btn" onClick={handleArchive} title="Summarize and clear conversation" disabled={messages.length === 0 || streaming}>
              Archive
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Messages */}
          <div className="max-messages">
            {!key && (
              <div className="max-no-key">
                Enter your Anthropic API key in Settings (gear icon) to use Max.
              </div>
            )}
            {key && messages.length === 0 && (
              <div className="max-empty">
                Ask Max anything about your DataWeave script or MuleSoft flow.
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`max-message max-message--${msg.role}`}>
                <span className="max-message-role">{msg.role === "user" ? "You" : "Max"}</span>
                <div className="max-message-body">
                  {msg.content.map((part, j) => {
                    if (part.type === "image" && part.data) {
                      return (
                        <img
                          key={j}
                          className="max-image-thumb"
                          src={`data:${part.media_type};base64,${part.data}`}
                          alt="attached"
                        />
                      );
                    }
                    if (msg.role === "assistant") {
                      return <ReactMarkdown key={j}>{part.text ?? ""}</ReactMarkdown>;
                    }
                    return <p key={j}>{part.text}</p>;
                  })}
                  {msg.role === "assistant" && streaming && i === messages.length - 1 && (
                    <span className="max-cursor" />
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Pending images */}
          {pendingImages.length > 0 && (
            <div className="max-pending-images">
              {pendingImages.map((img, i) => (
                <div key={i} className="max-pending-thumb">
                  <img src={img.dataUrl} alt="pending" />
                  <button
                    className="max-pending-remove"
                    onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                    title="Remove image"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="max-input-bar">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => { addImages(e.target.files); e.target.value = ""; }}
            />
            <textarea
              ref={textareaRef}
              className="max-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={key ? "Ask Max… (Enter to send, Shift+Enter for newline)" : "Add API key in Settings to use Max"}
              disabled={!key}
              rows={5}
            />
            <button
              className="max-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file"
            >
              <PaperclipIcon />
            </button>
            {streaming ? (
              <button className="max-send-btn max-send-btn--stop" onClick={handleStop} title="Stop">
                <StopIcon />
              </button>
            ) : (
              <button
                className="max-send-btn"
                onClick={handleSend}
                disabled={!key || (!input.trim() && pendingImages.length === 0)}
                title="Send (Enter)"
              >
                <SendIcon />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}


function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
