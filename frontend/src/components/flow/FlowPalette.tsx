import { FileText, GitFork, Link, Package, RefreshCw, Shield, Tag, Workflow, GitBranch, Zap, ArrowRightFromLine, ExternalLink, AlertOctagon } from "lucide-react";
import { PALETTE_ITEMS, PROCESSOR_COLORS, type PaletteItem } from "../../types/flow";

const PALETTE_COLORS: Record<string, string> = {
  ...PROCESSOR_COLORS,
  "flow":    "#2c7be5",
  "subflow": "#00a65a",
};

const PALETTE_ICONS: Record<string, React.ReactNode> = {
  "flow":               <Workflow      size={14} color="#fff" />,
  "subflow":            <GitBranch     size={14} color="#fff" />,
  "flow-reference":     <Link          size={14} color="#fff" />,
  "set-payload":        <Package       size={14} color="#fff" />,
  "transform":          <Zap           size={14} color="#fff" />,
  "set-variable":       <Tag           size={14} color="#fff" />,
  "logger":             <FileText      size={14} color="#fff" />,
  "choice":             <GitFork       size={14} color="#fff" />,
  "for-each":           <RefreshCw     size={14} color="#fff" />,
  "try":                <Shield        size={14} color="#fff" />,
  "on-error-continue":  <ArrowRightFromLine size={14} color="#fff" />,
  "on-error-propagate": <ExternalLink       size={14} color="#fff" />,
  "raise-error":        <AlertOctagon  size={14} color="#fff" />,
};

// ── PaletteRow ─────────────────────────────────────────────────────────────────

function PaletteRow({ item }: { item: PaletteItem }) {
  const onDragStart = (e: React.DragEvent) => {
    if (item.type === "flow" || item.type === "subflow") {
      e.dataTransfer.setData("flowType", item.type);
    } else {
      e.dataTransfer.setData("processorType", item.type);
    }
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      className="palette-row palette-row--circle"
      draggable
      onDragStart={onDragStart}
      title={`Drag to add ${item.label}`}
    >
      <div className="palette-circle" style={{ backgroundColor: PALETTE_COLORS[item.type] }}>
        <span className="palette-circle__icon">{PALETTE_ICONS[item.type]}</span>
      </div>
      <span className="palette-row__label">{item.label}</span>
    </div>
  );
}

// ── FlowPalette ────────────────────────────────────────────────────────────────

export default function FlowPalette() {
  const flowItems  = PALETTE_ITEMS.filter((i) => i.category === "flow");
  const coreItems  = PALETTE_ITEMS.filter((i) => i.category === "core");
  const scopeItems = PALETTE_ITEMS.filter((i) => i.category === "scope");
  const errorItems = PALETTE_ITEMS.filter((i) => i.category === "error");

  return (
    <div className="flow-palette">
      <div className="flow-palette__section">
        <div className="flow-palette__section-title">Flows</div>
        {flowItems.map((item) => <PaletteRow key={item.type} item={item} />)}
      </div>
      <div className="flow-palette__section">
        <div className="flow-palette__section-title">Processors</div>
        {coreItems.map((item) => <PaletteRow key={item.type} item={item} />)}
      </div>
      <div className="flow-palette__section">
        <div className="flow-palette__section-title">Scopes</div>
        {scopeItems.map((item) => <PaletteRow key={item.type} item={item} />)}
      </div>
      <div className="flow-palette__section">
        <div className="flow-palette__section-title">Error Handling</div>
        {errorItems.map((item) => <PaletteRow key={item.type} item={item} />)}
      </div>
    </div>
  );
}
