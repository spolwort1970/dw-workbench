import { useEffect, useRef, useState } from "react";
import type { ConsoleEntry } from "../../types/execution";

function getLogLevel(msg: string): "info" | "warn" | "error" | "meta" {
  if (msg.startsWith("[ERROR]")) return "error";
  if (msg.startsWith("[WARN]"))  return "warn";
  if (msg.startsWith("[INFO]"))  return "info";
  if (msg.startsWith("✗"))       return "error";
  if (msg.startsWith("⚠"))       return "warn";
  return "meta";
}

interface ConsolePanelProps {
  entries: ConsoleEntry[];
  pinned: boolean;
  onClear:  () => void;
  onClose:  () => void;
  onTogglePin: () => void;
}

const DEFAULT_WIDTH = 340;
const MIN_WIDTH     = 220;
const MAX_WIDTH     = 600;

export default function ConsolePanel({ entries, pinned, onClear, onClose, onTogglePin }: ConsolePanelProps) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const resizingRef = useRef(false);
  const startXRef   = useRef(0);
  const startWRef   = useRef(0);
  const bottomRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startXRef.current   = e.clientX;
    startWRef.current   = panelWidth;
    const onMove = (me: MouseEvent) => {
      if (!resizingRef.current) return;
      const dx = startXRef.current - me.clientX; // drag left = wider
      setPanelWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWRef.current + dx)));
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="console-panel"
      style={{ width: panelWidth, minWidth: panelWidth }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Resize handle (left edge) ── */}
      <div className="console-panel__resize-handle" onMouseDown={onResizeMouseDown} />

      {/* ── Header ── */}
      <div className="console-panel__header">
        <span className="console-panel__title">Console</span>
        <span className="console-panel__count">{entries.length} line{entries.length !== 1 ? "s" : ""}</span>
        <button
          className={`console-panel__pin${pinned ? " console-panel__pin--active" : ""}`}
          onClick={onTogglePin}
          type="button"
          title={pinned ? "Unpin (auto-hide on canvas click)" : "Pin (keep open)"}
        >
          📌
        </button>
        <button className="console-panel__clear" onClick={onClear} type="button" title="Clear console">
          Clear
        </button>
        <button className="console-panel__close" onClick={onClose} type="button" title="Close console">
          ×
        </button>
      </div>

      {/* ── Log body ── */}
      <div className="console-panel__body">
        {entries.length === 0 ? (
          <div className="console-panel__empty">No output yet. Run a flow to see logs here.</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`console-line console-line--${getLogLevel(entry.message)}`}>
              <span className="console-line__source">{entry.flowName} › {entry.procName}</span>
              <span className="console-line__msg">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
