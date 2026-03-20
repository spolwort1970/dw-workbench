import { useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import { DW_LANGUAGE_ID } from "../../dwLanguage";
import type { DebugState, SimEvent } from "../../types/execution";
import { debugEvaluate } from "../../services/api";
import ColorizedJson from "./ColorizedJson";

// ── MuleMessage tree ──────────────────────────────────────────────────────────

function MuleMessage({ event }: { event: SimEvent }) {
  const [openSections, setOpenSections] = useState({ payload: true, attributes: true, variables: true });
  const toggle = (k: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [k]: !s[k] }));

  const attrEntries = Object.entries(event.attributes);
  const varEntries  = Object.entries(event.variables);

  return (
    <div className="debug-message">
      {/* Payload */}
      <div className="debug-section">
        <div className="debug-section__header" onClick={() => toggle("payload")}>
          <span className="debug-section__arrow">{openSections.payload ? "▼" : "▶"}</span>
          <span className="debug-section__name">Payload</span>
          <span className="debug-section__type">{event.mimeType}</span>
        </div>
        {openSections.payload && <ColorizedJson value={event.payload} />}
      </div>

      {/* Attributes */}
      <div className="debug-section">
        <div className="debug-section__header" onClick={() => toggle("attributes")}>
          <span className="debug-section__arrow">{openSections.attributes ? "▼" : "▶"}</span>
          <span className="debug-section__name">Attributes</span>
          {attrEntries.length === 0 && <span className="debug-section__null">null</span>}
        </div>
        {openSections.attributes && attrEntries.length > 0 && (
          <div className="debug-section__kvlist">
            {attrEntries.map(([k, v]) => (
              <div key={k} className="debug-kv">
                <span className="debug-kv__key">{k}</span>
                <span className="debug-kv__eq">=</span>
                <span className={typeof v === "number" ? "debug-kv__num" : typeof v === "boolean" || v === null ? "debug-kv__bool" : "debug-kv__str"}>{JSON.stringify(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Variables */}
      <div className="debug-section">
        <div className="debug-section__header" onClick={() => toggle("variables")}>
          <span className="debug-section__arrow">{openSections.variables ? "▼" : "▶"}</span>
          <span className="debug-section__name">Variables</span>
          {varEntries.length === 0 && <span className="debug-section__null">empty</span>}
        </div>
        {openSections.variables && varEntries.length > 0 && (
          <div className="debug-section__kvlist">
            {varEntries.map(([k, v]) => (
              <div key={k} className="debug-kv">
                <span className="debug-kv__key">{k}</span>
                <span className="debug-kv__eq">=</span>
                <span className={typeof v === "number" ? "debug-kv__num" : typeof v === "boolean" || v === null ? "debug-kv__bool" : "debug-kv__str"}>{JSON.stringify(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── DW Evaluator ──────────────────────────────────────────────────────────────

function DWEvaluator({ sessionId, theme }: { sessionId: string; theme: string }) {
  const [expr, setExpr]       = useState("payload");
  const [result, setResult]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const monacoTheme = theme === "vs" || theme === "solarized-light" ? "vs" : "vs-dark";

  const evaluate = async () => {
    if (!expr.trim() || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await debugEvaluate(sessionId, expr);
      if (res.success) {
        setResult(res.output || JSON.stringify(res.result, null, 2));
      } else {
        setError(res.error);
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="debug-evaluator">
      <div className="debug-evaluator__header">Evaluate Expression</div>
      <div className="debug-evaluator__editor">
        <Editor
          height="80px"
          defaultLanguage={DW_LANGUAGE_ID}
          theme={monacoTheme}
          value={expr}
          onChange={(v) => setExpr(v ?? "")}
          options={{
            fontSize: 12,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: "off",
            wordWrap: "on",
            folding: false,
          }}
        />
      </div>
      <button
        className="debug-evaluator__btn"
        onClick={evaluate}
        disabled={running}
        type="button"
      >
        {running ? "…" : "Evaluate"}
      </button>
      {result !== null && (
        <pre className="debug-evaluator__result debug-evaluator__result--ok">{result}</pre>
      )}
      {error !== null && (
        <pre className="debug-evaluator__result debug-evaluator__result--error">{error}</pre>
      )}
    </div>
  );
}

// ── DebugPanel ────────────────────────────────────────────────────────────────

interface DebugPanelProps {
  debug: DebugState;
  flowName: string;
  theme: string;
  onStep:     () => void;
  onContinue: () => void;
  onStop:     () => void;
}

const DEFAULT_WIDTH = 370;
const MIN_WIDTH     = 260;
const MAX_WIDTH     = 600;

export default function DebugPanel({ debug, flowName, theme, onStep, onContinue, onStop }: DebugPanelProps) {
  const { sessionId, currentProcName, currentFlowId, currentEvent, completedTraces, stepping, done } = debug;

  const completedArr  = Object.values(completedTraces);
  const lastCompleted = completedArr.length > 0 ? completedArr[completedArr.length - 1] : undefined;

  // ── resize handle ──
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const resizingRef  = useRef(false);
  const startXRef    = useRef(0);
  const startWRef    = useRef(0);

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

  // Status line: show subflow context when stepping inside a subflow
  const inSubflow   = currentFlowId && currentFlowId !== debug.flowId;
  const subflowName = inSubflow
    ? completedArr.find((t) => t.procType === "flow-reference")?.logs?.[0]?.match(/↓ Stepping into '(.+?)'/)?.[1] ?? "subflow"
    : null;

  return (
    <div className="debug-panel" style={{ width: panelWidth, minWidth: panelWidth }}>
      {/* ── Resize handle (left edge) ── */}
      <div className="debug-panel__resize-handle" onMouseDown={onResizeMouseDown} />

      {/* ── Header ── */}
      <div className="debug-panel__header">
        <span className="debug-panel__title">Debugging: {flowName}</span>
      </div>

      {/* ── Controls ── */}
      <div className="debug-panel__controls">
        <button
          className="debug-ctrl-btn debug-ctrl-btn--step"
          onClick={onStep}
          disabled={stepping || done}
          type="button"
          title="Step (execute next processor)"
        >
          ⏭ Step
        </button>
        <button
          className="debug-ctrl-btn debug-ctrl-btn--continue"
          onClick={onContinue}
          disabled={stepping || done}
          type="button"
          title="Continue (run to end)"
        >
          ▶▶ Continue
        </button>
        <button
          className="debug-ctrl-btn debug-ctrl-btn--stop"
          onClick={onStop}
          type="button"
          title={done ? "Close debug panel" : "Stop debug session"}
        >
          {done ? "✕ Close" : "■ Stop"}
        </button>
      </div>

      {/* ── Status line ── */}
      <div className="debug-panel__status">
        {done
          ? <span className="debug-panel__status--done">✓ Flow complete</span>
          : stepping
          ? <span className="debug-panel__status--stepping">Executing…</span>
          : currentProcName
          ? (
            <span>
              {inSubflow && <em className="debug-panel__subflow-ctx">{subflowName} › </em>}
              Paused before: <strong>{currentProcName}</strong>
            </span>
          )
          : null
        }
      </div>

      {/* ── Last step error ── */}
      {lastCompleted && !lastCompleted.success && (
        <div className="debug-panel__error">
          <strong>Error in {lastCompleted.displayName}:</strong> {lastCompleted.error}
        </div>
      )}

      {/* ── Last step logs ── */}
      {lastCompleted && lastCompleted.logs.length > 0 && (
        <div className="debug-panel__logs">
          {lastCompleted.logs.map((l: string, i: number) => (
            <div key={i} className="debug-panel__log-line">{l}</div>
          ))}
        </div>
      )}

      {/* ── Scrollable body: Steps + Mule Message + Evaluator ── */}
      <div className="debug-panel__scroll">
        {/* Step trace history */}
        {completedArr.length > 0 && (
          <>
            <div className="debug-panel__section-label">Steps</div>
            <div className="debug-trace-list">
              {completedArr.map((t) => {
                const isInto = t.procType === "flow-reference" && t.success;
                const cls = isInto ? "into" : t.success ? "ok" : "fail";
                const icon = isInto ? "↓" : t.success ? "✓" : "✗";
                const sub = isInto ? t.logs[0]?.replace("↓ Stepping into ", "").replace(/\s*\(\d+.*?\)/, "") : undefined;
                return (
                  <div key={t.procId} className={`debug-trace-entry debug-trace-entry--${cls}`}>
                    <span className="debug-trace-entry__icon">{icon}</span>
                    <span className="debug-trace-entry__name">{t.displayName}</span>
                    {sub && <span className="debug-trace-entry__sub">{sub}</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="debug-panel__section-label">Mule Message</div>
        <MuleMessage event={currentEvent} />
        <DWEvaluator sessionId={sessionId} theme={theme} />
      </div>
    </div>
  );
}
