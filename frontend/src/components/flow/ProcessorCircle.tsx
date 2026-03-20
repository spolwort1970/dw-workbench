import { AlertOctagon, ArrowRightFromLine, ExternalLink, FileText, GitFork, Link, Package, RefreshCw, Shield, Tag, Zap } from "lucide-react";
import type { ProcessorType } from "../../types/flow";
import { PROCESSOR_COLORS } from "../../types/flow";
import type { NodeTrace } from "../../types/execution";

const ICONS: Record<ProcessorType, React.ReactNode> = {
  "set-payload":        <Package      size={18} color="#fff" />,
  "transform":          <Zap          size={18} color="#fff" />,
  "set-variable":       <Tag          size={18} color="#fff" />,
  "logger":             <FileText     size={18} color="#fff" />,
  "choice":             <GitFork      size={18} color="#fff" />,
  "for-each":           <RefreshCw    size={18} color="#fff" />,
  "try":                <Shield       size={18} color="#fff" />,
  "flow-reference":     <Link         size={18} color="#fff" />,
  "on-error-continue":  <ArrowRightFromLine size={18} color="#fff" />,
  "on-error-propagate": <ExternalLink       size={18} color="#fff" />,
  "raise-error":        <AlertOctagon size={18} color="#fff" />,
};

// ── ProcessorCircle ────────────────────────────────────────────────────────────

interface ProcessorCircleProps {
  id: string;
  flowId: string;
  type: ProcessorType;
  displayName: string;
  selected: boolean;
  paused?: boolean;
  trace?: NodeTrace;
  onClick: (id: string) => void;
  onDoubleClick?: (id: string) => void;
}

export default function ProcessorCircle({
  id,
  flowId,
  type,
  displayName,
  selected,
  paused,
  trace,
  onClick,
  onDoubleClick,
}: ProcessorCircleProps) {
  const color = PROCESSOR_COLORS[type];

  // Determine badge: skipped scope = info, error = fail, success = ok
  const badge = !trace ? null
    : trace.skipped ? "skipped"
    : trace.success ? "ok"
    : "fail";

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData("processorMove", JSON.stringify({ procId: id, sourceFlowId: flowId }));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      className={`processor-circle-wrapper${selected ? " processor-circle-wrapper--selected" : ""}${paused ? " processor-circle-wrapper--paused" : ""}`}
      draggable
      onDragStart={handleDragStart}
      onClick={(e) => { e.stopPropagation(); onClick(id); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(id); }}
      title={displayName}
    >
      <div
        className="processor-circle"
        style={{ backgroundColor: color, borderColor: selected ? "#fff" : color }}
      >
        <span className="processor-circle__icon">{ICONS[type]}</span>
      </div>
      {badge && (
        <span className={`processor-circle__badge processor-circle__badge--${badge}`}>
          {badge === "fail" ? "✗" : "✓"}
        </span>
      )}
      <span className="processor-circle__label">{displayName}</span>
    </div>
  );
}
