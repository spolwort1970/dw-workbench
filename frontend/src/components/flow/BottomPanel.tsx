import { useEffect, useState } from "react";
import type { FlowDef, ProcessorInstance } from "../../types/flow";
import type { NodeTrace } from "../../types/execution";
import { ProcessorConfigForm, SourceConfigForm } from "./config/ProcessorForms";
import ColorizedJson from "./ColorizedJson";

// ── Selection union type ───────────────────────────────────────────────────────

export type PanelSelection =
  | { kind: "source";    flow: FlowDef }
  | { kind: "processor"; proc: ProcessorInstance; flowId: string; nodeTrace: NodeTrace | null }
  | null;

// ── TraceView ─────────────────────────────────────────────────────────────────

function TraceEvent({ event }: { event: NodeTrace["input"] }) {
  const [open, setOpen] = useState({ payload: true, attributes: true, variables: true });
  const toggle = (k: keyof typeof open) => setOpen((s) => ({ ...s, [k]: !s[k] }));
  const attrEntries = Object.entries(event.attributes);
  const varEntries  = Object.entries(event.variables);
  return (
    <div className="debug-message">
      <div className="debug-section">
        <div className="debug-section__header" onClick={() => toggle("payload")}>
          <span className="debug-section__arrow">{open.payload ? "▼" : "▶"}</span>
          <span className="debug-section__name">Payload</span>
          <span className="debug-section__type">{event.mimeType}</span>
        </div>
        {open.payload && <ColorizedJson value={event.payload} />}
      </div>

      <div className="debug-section">
        <div className="debug-section__header" onClick={() => toggle("attributes")}>
          <span className="debug-section__arrow">{open.attributes ? "▼" : "▶"}</span>
          <span className="debug-section__name">Attributes</span>
          {attrEntries.length === 0 && <span className="debug-section__null">null</span>}
        </div>
        {open.attributes && attrEntries.length > 0 && (
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

      <div className="debug-section">
        <div className="debug-section__header" onClick={() => toggle("variables")}>
          <span className="debug-section__arrow">{open.variables ? "▼" : "▶"}</span>
          <span className="debug-section__name">Variables</span>
          {varEntries.length === 0 && <span className="debug-section__null">empty</span>}
        </div>
        {open.variables && varEntries.length > 0 && (
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

function TraceView({ trace }: { trace: NodeTrace; theme: string }) {
  return (
    <div className="trace-view">
      {!trace.success && (
        <div className="trace-view__error">
          <strong>Error:</strong> {trace.error}
        </div>
      )}
      {trace.logs.length > 0 && (
        <div className="trace-view__logs">
          {trace.logs.map((l, i) => <div key={i} className="trace-view__log-line">{l}</div>)}
        </div>
      )}
      <div className="trace-view__split">
        <div className="trace-view__half">
          <div className="trace-view__half-label">
            Input <span className="trace-view__half-proc">— {trace.displayName}</span>
          </div>
          <TraceEvent event={trace.input} />
        </div>
        <div className="trace-view__half trace-view__half--right">
          <div className="trace-view__half-label">
            Output <span className="trace-view__half-proc">— {trace.displayName}</span>
          </div>
          <TraceEvent event={trace.output} />
        </div>
      </div>
    </div>
  );
}

// ── BottomPanel ────────────────────────────────────────────────────────────────

interface BottomPanelProps {
  selection: PanelSelection;
  allFlows: { id: string; name: string }[];
  theme: string;
  lastDebugTrace: NodeTrace | null;
  onUpdateSource:     (flowId: string, config: FlowDef["source"]) => void;
  onUpdateProcessor:  (flowId: string, procId: string, config: Record<string, any>) => void;
  onRenameProcessor:  (flowId: string, procId: string, name: string) => void;
}

export default function BottomPanel({ selection, allFlows, theme, lastDebugTrace, onUpdateSource, onUpdateProcessor, onRenameProcessor }: BottomPanelProps) {
  const [tab, setTab] = useState("payload");

  const selectionKey = !selection ? null
    : selection.kind === "source"    ? `source:${selection.flow.id}`
    : `proc:${selection.proc.id}`;

  useEffect(() => {
    setTab("payload");
  }, [selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const isTransform  = selection?.kind === "processor" && selection.proc.type === "transform";
  const nodeTrace    = (selection?.kind === "processor" ? selection.nodeTrace : null) ?? lastDebugTrace;
  const configTabs   = selection?.kind === "source" || isTransform
    ? ["payload", "variables", "attributes"]
    : null;

  return (
    <div className="bottom-panel">
      {/* ── Header ── */}
      <div className="bottom-panel__header">
        <span className="bottom-panel__title">
          {!selection && "Select a node to configure it"}
          {selection?.kind === "source"    && `Input — ${selection.flow.name}`}
          {selection?.kind === "processor" && selection.proc.displayName}
        </span>
      </div>

      {/* ── Body ── */}
      {selection && (
        <div className={`bottom-panel__body${nodeTrace ? " bottom-panel__body--split" : ""}`}>

          {/* ── Left: config pane ── */}
          <div className="bottom-panel__config">

            {/* Source (Input) */}
            {selection.kind === "source" && (
              <>
                <div className="config-tabs">
                  {configTabs!.map((t) => (
                    <button key={t} className={`config-tab${tab === t ? " config-tab--active" : ""}`}
                      onClick={() => setTab(t)} type="button">
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
                <SourceConfigForm
                  config={selection.flow.source}
                  onChange={(cfg) => onUpdateSource(selection.flow.id, cfg)}
                  theme={theme}
                  tab={tab}
                />
              </>
            )}

            {/* Display Name row — all processors */}
            {selection.kind === "processor" && (
              <div className="config-display-name">
                <label className="config-display-name__label">Display Name</label>
                <input
                  className="config-display-name__input"
                  value={selection.proc.displayName}
                  onChange={(e) => onRenameProcessor(selection.flowId, selection.proc.id, e.target.value)}
                  spellCheck={false}
                />
              </div>
            )}

            {/* Transform processor */}
            {selection.kind === "processor" && isTransform && (
              <>
                <div className="config-tabs">
                  {configTabs!.map((t) => (
                    <button key={t} className={`config-tab${tab === t ? " config-tab--active" : ""}`}
                      onClick={() => setTab(t)} type="button">
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
                <ProcessorConfigForm
                  processor={selection.proc}
                  theme={theme}
                  tab={tab}
                  flowNames={allFlows.filter((f) => f.id !== selection.flowId).map((f) => f.name)}
                  onChange={(cfg) => onUpdateProcessor(selection.flowId, selection.proc.id, cfg)}
                />
              </>
            )}

            {/* All other processors */}
            {selection.kind === "processor" && !isTransform && (
              <>
                <div className="config-tabs">
                  <span className="config-tab config-tab--active">Config</span>
                </div>
                <ProcessorConfigForm
                  processor={selection.proc}
                  theme={theme}
                  tab={tab}
                  flowNames={allFlows.filter((f) => f.id !== selection.flowId).map((f) => f.name)}
                  onChange={(cfg) => onUpdateProcessor(selection.flowId, selection.proc.id, cfg)}
                />
              </>
            )}

          </div>

          {/* ── Right: trace pane (only when trace exists) ── */}
          {nodeTrace && (
            <div className="bottom-panel__trace">
              <div className="config-tabs">
                <span className="config-tab config-tab--active">
                  Trace {nodeTrace.success ? "✓" : "✗"}
                </span>
              </div>
              <TraceView trace={nodeTrace} theme={theme} />
            </div>
          )}

        </div>
      )}
    </div>
  );
}
