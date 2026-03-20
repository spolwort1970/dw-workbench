import React, { useRef, useEffect, useState } from "react";
import { Package } from "lucide-react";
import type { FlowDef, ProcessorInstance } from "../../types/flow";
import { SCOPE_TYPES } from "../../types/flow";
import type { NodeTrace } from "../../types/execution";
import ProcessorCircle from "./ProcessorCircle";
import ScopeBlock from "./ScopeBlock";

// ── ProcessorList ─────────────────────────────────────────────────────────────

interface ProcessorListProps {
  processors: ProcessorInstance[];
  flowId: string;
  selectedId: string | null;
  nodeTraces: Record<string, NodeTrace>;
  pausedProcId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDropInScope: (scopeId: string, type: string, routeId?: string) => void;
  onMoveIntoScope: (procId: string, sourceFlowId: string, targetScopeId: string, routeId?: string) => void;
}

function ProcessorList({ processors, flowId, selectedId, nodeTraces, pausedProcId, onSelect, onDelete, onDropInScope, onMoveIntoScope }: ProcessorListProps) {
  return (
    <>
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
              onDropInScope={onDropInScope}
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
    </>
  );
}

// ── FlowContainer ─────────────────────────────────────────────────────────────

interface FlowContainerProps {
  flow: FlowDef;
  selectedId: string | null;
  nodeTraces: Record<string, NodeTrace>;
  pausedProcId: string | null;
  isRunning: boolean;
  isDebugging: boolean;
  onRun: (flowId: string) => void;
  onDebug: (flowId: string) => void;
  onRenameFlow: (flowId: string, name: string) => void;
  onSelectSource: (flowId: string) => void;
  onSelectProcessor: (id: string) => void;
  onDropProcessor: (flowId: string, type: string) => void;
  onMoveProcessor: (procId: string, sourceFlowId: string, targetFlowId: string) => void;
  onDropInScope: (scopeId: string, type: string, routeId?: string) => void;
  onMoveIntoScope: (procId: string, sourceFlowId: string, targetScopeId: string, routeId?: string) => void;
  onDeleteHandler: (id: string) => void;
  onDropFlowErrorHandler: (flowId: string, type: string) => void;
  onMoveIntoFlowErrorHandlers: (procId: string, sourceFlowId: string, targetFlowId: string) => void;
  onMoveFlow: (flowId: string, dx: number, dy: number) => void;
  onMoveFlowEnd: (flowId: string) => void;
  onDeleteFlow: (flowId: string) => void;
  onHeightChange: (flowId: string, height: number) => void;
  onAddFlow: (type: "flow" | "subflow") => void;
}

export default function FlowContainer({
  flow,
  selectedId,
  nodeTraces,
  pausedProcId,
  isRunning,
  isDebugging,
  onRun,
  onDebug,
  onRenameFlow,
  onSelectSource,
  onSelectProcessor,
  onDropProcessor,
  onMoveProcessor,
  onDropInScope,
  onMoveIntoScope,
  onDeleteHandler,
  onDropFlowErrorHandler,
  onMoveIntoFlowErrorHandlers,
  onMoveFlow,
  onMoveFlowEnd,
  onDeleteFlow,
  onHeightChange,
  onAddFlow,
}: FlowContainerProps) {
  const dragOrigin   = useRef<{ x: number; y: number } | null>(null);
  const hasDragged   = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ehExpanded, setEhExpanded] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onHeightChange(flow.id, el.offsetHeight));
    ro.observe(el);
    onHeightChange(flow.id, el.offsetHeight);
    return () => ro.disconnect();
  }, [flow.id, onHeightChange]);
  const sourceSelected = selectedId === `source:${flow.id}`;

  // ── drag titlebar to reposition ──
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    hasDragged.current = false;
    dragOrigin.current = { x: e.clientX, y: e.clientY };

    const onMouseMove = (me: MouseEvent) => {
      if (!dragOrigin.current) return;
      hasDragged.current = true;
      onMoveFlow(flow.id, me.clientX - dragOrigin.current.x, me.clientY - dragOrigin.current.y);
      dragOrigin.current = { x: me.clientX, y: me.clientY };
    };
    const onMouseUp = () => {
      dragOrigin.current = null;
      onMoveFlowEnd(flow.id);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // ── drop zone for top-level processors ──
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const flowType = e.dataTransfer.getData("flowType");
    if (flowType === "flow" || flowType === "subflow") { onAddFlow(flowType); return; }
    const moveData = e.dataTransfer.getData("processorMove");
    if (moveData) {
      const { procId, sourceFlowId } = JSON.parse(moveData);
      onMoveProcessor(procId, sourceFlowId, flow.id);
      return;
    }
    const t = e.dataTransfer.getData("processorType");
    if (t) onDropProcessor(flow.id, t);
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("flowtype")) { e.preventDefault(); e.stopPropagation(); }
  };
  const handleContainerDrop = (e: React.DragEvent) => {
    const flowType = e.dataTransfer.getData("flowType");
    if (flowType === "flow" || flowType === "subflow") { e.preventDefault(); e.stopPropagation(); onAddFlow(flowType); }
  };

  const handleEHDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleEHDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const moveData = e.dataTransfer.getData("processorMove");
    if (moveData) {
      const { procId, sourceFlowId } = JSON.parse(moveData);
      onMoveIntoFlowErrorHandlers(procId, sourceFlowId, flow.id);
      return;
    }
    const t = e.dataTransfer.getData("processorType");
    if (t === "on-error-continue" || t === "on-error-propagate") {
      onDropFlowErrorHandler(flow.id, t);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flow-container"
      style={{ left: flow.x, top: flow.y }}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Title bar ── */}
      <div className="flow-container__titlebar" onMouseDown={onHeaderMouseDown}>
        <span className="flow-container__type-badge">{flow.type === "subflow" ? "Sub Flow" : "Flow"}</span>
        <input
          className="flow-container__name-input"
          value={flow.name}
          onChange={(e) => onRenameFlow(flow.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          spellCheck={false}
        />
        <button
          className="flow-container__delete-btn"
          onClick={(e) => { e.stopPropagation(); onDeleteFlow(flow.id); }}
          type="button"
          title="Delete flow"
        >
          ×
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flow-container__body">

        {/* Processor row area */}
        <div className="flow-container__processor-row-area">
          {/* Input block — only for regular flows (event seed / permanent Set Payload) */}
          {flow.type === "flow" && (
            <>
              <div className="flow-container__input-block">
                <div
                  className={`processor-circle-wrapper${sourceSelected ? " processor-circle-wrapper--selected" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onSelectSource(flow.id); }}
                  title="Input — configure the initial payload, attributes, and variables"
                >
                  <div className="processor-circle" style={{ backgroundColor: "#00a65a" }}>
                    <span className="processor-circle__icon"><Package size={18} color="#fff" /></span>
                  </div>
                  <span className="processor-circle__label">Input</span>
                </div>
                <div className="flow-container__input-btns">
                  <button
                    className={`flow-container__input-run${isRunning ? " flow-container__input-run--running" : ""}`}
                    onClick={(e) => { e.stopPropagation(); if (!isRunning && !isDebugging) onRun(flow.id); }}
                    type="button"
                    title="Run this flow"
                    disabled={isRunning || isDebugging}
                  >
                    {isRunning ? "…" : "▶ Run"}
                  </button>
                  <button
                    className="flow-container__input-debug"
                    onClick={(e) => { e.stopPropagation(); if (!isRunning && !isDebugging) onDebug(flow.id); }}
                    type="button"
                    title="Debug this flow step by step"
                    disabled={isRunning || isDebugging}
                  >
                    ⚙ Debug
                  </button>
                </div>
              </div>
              <div className="flow-container__arrow">→</div>
            </>
          )}

          {/* Processor chain drop zone */}
          <div
            className="flow-container__process-zone"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {flow.processors.length === 0 ? (
              <div className="flow-container__empty-hint">Drop processors here</div>
            ) : (
              <div className="flow-container__processor-row">
                <ProcessorList
                  processors={flow.processors}
                  flowId={flow.id}
                  selectedId={selectedId}
                  nodeTraces={nodeTraces}
                  pausedProcId={pausedProcId}
                  onSelect={onSelectProcessor}
                  onDelete={onDeleteHandler}
                  onDropInScope={onDropInScope}
                  onMoveIntoScope={onMoveIntoScope}
                />
              </div>
            )}
          </div>
        </div>{/* end processor-row-area */}

        {/* ── Flow-level Error Handling section ── */}
        <div className="flow-error-handler-section">
          <div
            className="flow-error-handler-section__label"
            onClick={(e) => { e.stopPropagation(); setEhExpanded((v) => !v); }}
          >
            {ehExpanded ? "▼" : "▶"} Error Handling
          </div>
          {ehExpanded && <div className="scope-error-handler-zone" onDragOver={handleEHDragOver} onDrop={handleEHDrop}>
            {(flow.errorHandlers ?? []).length === 0 && (
              <span className="scope-inner-drop__hint">Drop error handler here</span>
            )}
            {(flow.errorHandlers ?? []).map((h) => (
              <ScopeBlock
                key={h.id}
                proc={h}
                flowId={flow.id}
                selected={selectedId === h.id}
                selectedId={selectedId}
                nodeTraces={nodeTraces}
                pausedProcId={pausedProcId}
                onSelect={onSelectProcessor}
                onDelete={onDeleteHandler}
                onDropInScope={onDropInScope}
                onMoveIntoScope={onMoveIntoScope}
              />
            ))}
          </div>}
        </div>
      </div>
    </div>
  );
}
