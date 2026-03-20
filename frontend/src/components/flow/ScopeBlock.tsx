import React from "react";
import { ArrowRightFromLine, ExternalLink, GitFork, RefreshCw, Shield } from "lucide-react";
import type { ProcessorInstance, ChoiceRoute } from "../../types/flow";
import { PROCESSOR_COLORS, SCOPE_TYPES } from "../../types/flow";
import type { NodeTrace } from "../../types/execution";
import ProcessorCircle from "./ProcessorCircle";

// ── DW expression colorizer ───────────────────────────────────────────────────

function ColorizedExpr({ expr }: { expr: string }) {
  const tokens: { text: string; cls: string }[] = [];
  let s = expr;
  while (s.length > 0) {
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^(true|false|null|is|as|not|and|or)\b/))) {
      tokens.push({ text: m[1], cls: "debug-kv__bool" });
    } else if ((m = s.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/))) {
      tokens.push({ text: m[1], cls: "debug-kv__str" });
    } else if ((m = s.match(/^(-?\d+\.?\d*)/))) {
      tokens.push({ text: m[1], cls: "debug-kv__num" });
    } else if ((m = s.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)/))) {
      tokens.push({ text: m[1], cls: "debug-kv__key" });
    } else if ((m = s.match(/^(==|!=|<=|>=|<|>|&&|\|\||[+\-*/%])/))) {
      tokens.push({ text: m[1], cls: "debug-kv__eq" });
    } else if ((m = s.match(/^(\s+)/))) {
      tokens.push({ text: m[1], cls: "" });
    } else {
      tokens.push({ text: s[0], cls: "debug-kv__eq" });
      m = [s[0]];
    }
    s = s.slice(m[1].length);
  }
  return (
    <>
      {tokens.map((t, i) =>
        t.cls ? <span key={i} className={t.cls}>{t.text}</span> : <React.Fragment key={i}>{t.text}</React.Fragment>
      )}
    </>
  );
}

// ── shared drop zone inside a scope ───────────────────────────────────────────

interface InnerDropZoneProps {
  scopeId: string;
  flowId: string;
  routeId?: string;
  processors: ProcessorInstance[];
  selectedId: string | null;
  nodeTraces: Record<string, NodeTrace>;
  pausedProcId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDrop: (scopeId: string, type: string, routeId?: string) => void;
  onMoveIntoScope: (procId: string, sourceFlowId: string, targetScopeId: string, routeId?: string) => void;
}

function InnerDropZone({ scopeId, flowId, routeId, processors, selectedId, nodeTraces, pausedProcId, onSelect, onDelete, onDrop, onMoveIntoScope }: InnerDropZoneProps) {
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const moveData = e.dataTransfer.getData("processorMove");
    if (moveData) {
      const { procId, sourceFlowId } = JSON.parse(moveData);
      onMoveIntoScope(procId, sourceFlowId, scopeId, routeId);
      return;
    }
    const t = e.dataTransfer.getData("processorType");
    if (t) onDrop(scopeId, t, routeId);
  };

  return (
    <div className="scope-inner-drop" onDragOver={handleDragOver} onDrop={handleDrop}>
      {processors.length === 0 && (
        <span className="scope-inner-drop__hint">Drop processors here</span>
      )}
      {processors.map((p, i) => (
        <React.Fragment key={p.id}>
          {i > 0 && <div className="flow-container__arrow">→</div>}
          {SCOPE_TYPES.includes(p.type) ? (
            <ScopeBlock
              proc={p}
              flowId={flowId}
              selected={selectedId === p.id}
              selectedId={selectedId}
              nodeTraces={nodeTraces}
              pausedProcId={pausedProcId}
              onSelect={onSelect}
              onDelete={onDelete}
              onDropInScope={onDrop}
              onMoveIntoScope={onMoveIntoScope}
            />
          ) : (
            <ProcessorCircle
              id={p.id}
              flowId={flowId}
              type={p.type}
              displayName={p.displayName}
              selected={selectedId === p.id}
              paused={pausedProcId === p.id}
              trace={nodeTraces[p.id]}
              onClick={onSelect}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── ChoiceScopeBlock ───────────────────────────────────────────────────────────

interface ChoiceScopeBlockProps {
  proc: ProcessorInstance;
  flowId: string;
  selected: boolean;
  selectedId: string | null;
  nodeTraces: Record<string, NodeTrace>;
  pausedProcId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDropInScope: (scopeId: string, type: string, routeId?: string) => void;
  onMoveIntoScope: (procId: string, sourceFlowId: string, targetScopeId: string, routeId?: string) => void;
}

function ChoiceScopeBlock({ proc, flowId, selected, selectedId, nodeTraces, pausedProcId, onSelect, onDelete, onDropInScope, onMoveIntoScope }: ChoiceScopeBlockProps) {
  const color = PROCESSOR_COLORS["choice"];
  const routes: ChoiceRoute[] = proc.config.routes ?? [];

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("processorMove", JSON.stringify({ procId: proc.id, sourceFlowId: flowId }));
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
  };

  return (
    <div
      className={`scope-block scope-block--choice${selected ? " scope-block--selected" : ""}`}
      draggable
      onDragStart={handleDragStart}
      onClick={(e) => { e.stopPropagation(); onSelect(proc.id); }}
    >
      <div className="scope-block__choice-body">
        <div className="scope-block__choice-col">
          <div className="scope-block__choice-circle" style={{ backgroundColor: color }}>
            <GitFork size={18} color="#fff" />
          </div>
          <span className="scope-block__choice-label">{proc.displayName}</span>
        </div>

        <div className="scope-block__routes">
          {routes.map((route, i) => (
            <div key={route.id} className="scope-block__route-row">
              <div className="scope-block__route-arrow">→</div>
              <div className="scope-block__route">
                <div className="scope-block__route-label">
                  {route.type === "when" ? (
                    <>
                      <span className="debug-kv__bool">When {i + 1}</span>
                      {route.expression.content && (
                        <><span className="debug-kv__eq">: </span><ColorizedExpr expr={route.expression.content} /></>
                      )}
                    </>
                  ) : (
                    <span className="debug-kv__bool">Default</span>
                  )}
                </div>
                <InnerDropZone
                  scopeId={proc.id}
                  flowId={flowId}
                  routeId={route.id}
                  processors={route.processors}
                  selectedId={selectedId}
                  nodeTraces={nodeTraces}
                  pausedProcId={pausedProcId}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onDrop={onDropInScope}
                  onMoveIntoScope={onMoveIntoScope}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── LinearScopeBlock (ForEach) ────────────────────────────────────────────────

interface LinearScopeBlockProps {
  proc: ProcessorInstance;
  flowId: string;
  selected: boolean;
  selectedId: string | null;
  nodeTraces: Record<string, NodeTrace>;
  pausedProcId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDropInScope: (scopeId: string, type: string, routeId?: string) => void;
  onMoveIntoScope: (procId: string, sourceFlowId: string, targetScopeId: string, routeId?: string) => void;
}

function LinearScopeBlock({ proc, flowId, selected, selectedId, nodeTraces, pausedProcId, onSelect, onDelete, onDropInScope, onMoveIntoScope }: LinearScopeBlockProps) {
  const color = PROCESSOR_COLORS[proc.type];

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("processorMove", JSON.stringify({ procId: proc.id, sourceFlowId: flowId }));
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
  };

  return (
    <div
      className={`scope-block scope-block--linear${selected ? " scope-block--selected" : ""}`}
      style={{ borderColor: color }}
      draggable
      onDragStart={handleDragStart}
      onClick={(e) => { e.stopPropagation(); onSelect(proc.id); }}
    >
      <div className="scope-block__header" style={{ backgroundColor: color }}>
        <RefreshCw size={13} color="#fff" />
        <span>{proc.displayName}</span>
      </div>
      <InnerDropZone
        scopeId={proc.id}
        flowId={flowId}
        processors={proc.config.processors ?? []}
        selectedId={selectedId}
        nodeTraces={nodeTraces}
        pausedProcId={pausedProcId}
        onSelect={onSelect}
        onDelete={onDelete}
        onDrop={onDropInScope}
        onMoveIntoScope={onMoveIntoScope}
      />
    </div>
  );
}

// ── ErrorHandlerScopeBlock ────────────────────────────────────────────────────

interface ErrorHandlerScopeBlockProps {
  handler: ProcessorInstance;
  flowId: string;
  selectedId: string | null;
  nodeTraces: Record<string, NodeTrace>;
  pausedProcId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDropInScope: (scopeId: string, type: string, routeId?: string) => void;
  onMoveIntoScope: (procId: string, sourceFlowId: string, targetScopeId: string, routeId?: string) => void;
}

function ErrorHandlerScopeBlock({ handler, flowId, selectedId, nodeTraces, pausedProcId, onSelect, onDelete, onDropInScope, onMoveIntoScope }: ErrorHandlerScopeBlockProps) {
  const color = PROCESSOR_COLORS[handler.type] ?? "#e05a4e";
  const icon = handler.type === "on-error-continue" ? <ArrowRightFromLine size={12} color="#fff" /> : <ExternalLink size={12} color="#fff" />;
  const isSelected = selectedId === handler.id;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("processorMove", JSON.stringify({ procId: handler.id, sourceFlowId: flowId }));
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
  };

  return (
    <div
      className={`scope-block scope-block--error-handler${isSelected ? " scope-block--selected" : ""}`}
      style={{ borderColor: color }}
      draggable
      onDragStart={handleDragStart}
      onClick={(e) => { e.stopPropagation(); onSelect(handler.id); }}
    >
      <div className="scope-block__header scope-block__header--error-handler" style={{ backgroundColor: color }}>
        <div className="scope-block__header-row">
          {icon}
          <span>{handler.displayName}</span>
          <button
            className="scope-block__delete-btn"
            onClick={(e) => { e.stopPropagation(); onDelete(handler.id); }}
            title="Remove error handler"
          >×</button>
        </div>
        {handler.config.errorType && (
          <div className="scope-block__error-type-badge">{handler.config.errorType}</div>
        )}
      </div>
      <InnerDropZone
        scopeId={handler.id}
        flowId={flowId}
        processors={handler.config.processors ?? []}
        selectedId={selectedId}
        nodeTraces={nodeTraces}
        pausedProcId={pausedProcId}
        onSelect={onSelect}
        onDelete={onDelete}
        onDrop={onDropInScope}
        onMoveIntoScope={onMoveIntoScope}
      />
    </div>
  );
}

// ── ErrorHandlerDropZone ──────────────────────────────────────────────────────

interface ErrorHandlerDropZoneProps {
  tryId: string;
  flowId: string;
  handlers: ProcessorInstance[];
  selectedId: string | null;
  nodeTraces: Record<string, NodeTrace>;
  pausedProcId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDrop: (scopeId: string, type: string, routeId?: string) => void;
  onMoveIntoScope: (procId: string, sourceFlowId: string, targetScopeId: string, routeId?: string) => void;
}

function ErrorHandlerDropZone({ tryId, flowId, handlers, selectedId, nodeTraces, pausedProcId, onSelect, onDelete, onDrop, onMoveIntoScope }: ErrorHandlerDropZoneProps) {
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const moveData = e.dataTransfer.getData("processorMove");
    if (moveData) {
      const { procId, sourceFlowId } = JSON.parse(moveData);
      onMoveIntoScope(procId, sourceFlowId, tryId, "__error_handler__");
      return;
    }
    const t = e.dataTransfer.getData("processorType");
    if (t === "on-error-continue" || t === "on-error-propagate") {
      onDrop(tryId, t, "__error_handler__");
    }
    // Silently reject other types
  };

  return (
    <div className="scope-error-handler-zone" onDragOver={handleDragOver} onDrop={handleDrop}>
      {handlers.length === 0 && (
        <span className="scope-inner-drop__hint">Drop error handler here</span>
      )}
      {handlers.map((h) => (
        <ErrorHandlerScopeBlock
          key={h.id}
          handler={h}
          flowId={flowId}
          selectedId={selectedId}
          nodeTraces={nodeTraces}
          pausedProcId={pausedProcId}
          onSelect={onSelect}
          onDelete={onDelete}
          onDropInScope={onDrop}
          onMoveIntoScope={onMoveIntoScope}
        />
      ))}
    </div>
  );
}

// ── TryScopeBlock ─────────────────────────────────────────────────────────────

function TryScopeBlock({ proc, flowId, selected, selectedId, nodeTraces, pausedProcId, onSelect, onDelete, onDropInScope, onMoveIntoScope }: LinearScopeBlockProps) {
  const color = PROCESSOR_COLORS["try"];
  const handlers: ProcessorInstance[] = proc.config.errorHandlers ?? [];

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("processorMove", JSON.stringify({ procId: proc.id, sourceFlowId: flowId }));
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
  };

  return (
    <div
      className={`scope-block scope-block--try${selected ? " scope-block--selected" : ""}`}
      style={{ borderColor: color }}
      draggable
      onDragStart={handleDragStart}
      onClick={(e) => { e.stopPropagation(); onSelect(proc.id); }}
    >
      <div className="scope-block__header" style={{ backgroundColor: color }}>
        <Shield size={13} color="#fff" />
        <span>{proc.displayName}</span>
      </div>
      <InnerDropZone
        scopeId={proc.id}
        flowId={flowId}
        processors={proc.config.processors ?? []}
        selectedId={selectedId}
        nodeTraces={nodeTraces}
        pausedProcId={pausedProcId}
        onSelect={onSelect}
        onDelete={onDelete}
        onDrop={onDropInScope}
        onMoveIntoScope={onMoveIntoScope}
      />
      <div className="scope-block__try-section-label--handler">▼ Error Handling</div>
      <ErrorHandlerDropZone
        tryId={proc.id}
        flowId={flowId}
        handlers={handlers}
        selectedId={selectedId}
        nodeTraces={nodeTraces}
        pausedProcId={pausedProcId}
        onSelect={onSelect}
        onDelete={onDelete}
        onDrop={onDropInScope}
        onMoveIntoScope={onMoveIntoScope}
      />
    </div>
  );
}

// ── ScopeBlock dispatcher ─────────────────────────────────────────────────────

interface ScopeBlockProps {
  proc: ProcessorInstance;
  flowId: string;
  selected: boolean;
  selectedId: string | null;
  nodeTraces: Record<string, NodeTrace>;
  pausedProcId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDropInScope: (scopeId: string, type: string, routeId?: string) => void;
  onMoveIntoScope: (procId: string, sourceFlowId: string, targetScopeId: string, routeId?: string) => void;
}

export default function ScopeBlock(props: ScopeBlockProps) {
  if (props.proc.type === "choice") return <ChoiceScopeBlock {...props} />;
  if (props.proc.type === "try") return <TryScopeBlock {...props} />;
  if (props.proc.type === "on-error-continue" || props.proc.type === "on-error-propagate") {
    return (
      <ErrorHandlerScopeBlock
        handler={props.proc}
        flowId={props.flowId}
        selectedId={props.selectedId}
        nodeTraces={props.nodeTraces}
        pausedProcId={props.pausedProcId}
        onSelect={props.onSelect}
        onDelete={props.onDelete}
        onDropInScope={props.onDropInScope}
        onMoveIntoScope={props.onMoveIntoScope}
      />
    );
  }
  return <LinearScopeBlock {...props} />;
}
