import type {
  ChoiceRoute,
  DWValue,
  FlowCanvasState,
  FlowDef,
  ProcessorInstance,
  TransformOutput,
} from "../types/flow";

// Renders the Flow Analyzer canvas as text for Max.
//
// Max is given the workspace as a prompt block (see backend max_runner.py, which
// already expects a `flow_summary`). Without this the assistant could only ever see
// the Script Console, so any question about a flow got answered from nothing.
//
// The canvas is a nested structure — scopes contain processors which contain
// scopes — so this walks it depth-first and indents, keeping the shape legible
// rather than dumping JSON.

/** Long DataWeave scripts are trimmed; Max needs the shape, not every line. */
const MAX_SCRIPT_LINES = 40;
const MAX_SCRIPT_CHARS = 1500;
/** Whole-summary ceiling, so a large canvas can't crowd out the conversation. */
const MAX_SUMMARY_CHARS = 12000;

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function clipScript(script: string, depth: number): string {
  const pad = indent(depth + 1);
  let text = (script ?? "").trim();
  if (!text) return `${pad}(empty)`;

  let clipped = false;
  const lines = text.split("\n");
  if (lines.length > MAX_SCRIPT_LINES) {
    text = lines.slice(0, MAX_SCRIPT_LINES).join("\n");
    clipped = true;
  }
  if (text.length > MAX_SCRIPT_CHARS) {
    text = text.slice(0, MAX_SCRIPT_CHARS);
    clipped = true;
  }
  const body = text.split("\n").map((l) => pad + l).join("\n");
  return clipped ? `${body}\n${pad}… (truncated)` : body;
}

/** A DWValue as `expr` or `"literal"`, blank-safe. */
function renderValue(v: DWValue | undefined): string {
  if (!v || !v.content?.trim()) return "(empty)";
  const content = v.content.trim();
  const oneLine = content.includes("\n")
    ? `${content.split("\n")[0]} …`
    : content;
  return v.mode === "literal" ? JSON.stringify(oneLine) : oneLine;
}

function summarizeTransform(p: ProcessorInstance, depth: number, out: string[]): void {
  const outputs: TransformOutput[] = p.config?.outputs ?? [];
  if (outputs.length === 0) {
    out.push(`${indent(depth + 1)}(no outputs)`);
    return;
  }
  for (const o of outputs) {
    const target =
      o.target === "variable"   ? `vars.${o.variableName || "?"}`
      : o.target === "attributes" ? `attributes.${o.attributeKey || "?"}`
      : "payload";
    if (o.target === "payload") {
      out.push(`${indent(depth + 1)}→ ${target}:`);
      out.push(clipScript(o.script ?? "", depth + 1));
    } else {
      out.push(`${indent(depth + 1)}→ ${target} = ${renderValue(o.value)}`);
    }
  }
}

function summarizeProcessors(procs: ProcessorInstance[], depth: number, out: string[]): void {
  procs.forEach((p, i) => {
    const pad   = indent(depth);
    const label = p.displayName || p.type;
    const cfg   = p.config ?? {};

    switch (p.type) {
      case "transform":
        out.push(`${pad}${i + 1}. ${label}`);
        summarizeTransform(p, depth, out);
        break;

      case "set-payload":
        out.push(`${pad}${i + 1}. ${label} = ${renderValue(cfg.value)} [${cfg.mimeType ?? "?"}]`);
        break;

      case "set-variable":
        out.push(`${pad}${i + 1}. ${label}: vars.${cfg.variableName || "?"} = ${renderValue(cfg.value)}`);
        break;

      case "logger":
        out.push(`${pad}${i + 1}. ${label} [${cfg.level ?? "INFO"}]${cfg.category ? ` (${cfg.category})` : ""}: ${renderValue(cfg.message)}`);
        break;

      case "flow-reference":
        out.push(`${pad}${i + 1}. ${label} → ${renderValue(cfg.flowName)}`);
        break;

      case "raise-error":
        out.push(`${pad}${i + 1}. ${label}: ${cfg.errorType || "?"}${cfg.description ? ` — ${cfg.description}` : ""}`);
        break;

      case "choice": {
        out.push(`${pad}${i + 1}. ${label}`);
        const routes: ChoiceRoute[] = cfg.routes ?? [];
        for (const r of routes) {
          const head = r.type === "default"
            ? `${indent(depth + 1)}otherwise:`
            : `${indent(depth + 1)}when ${renderValue(r.expression)}:`;
          out.push(head);
          if (r.processors?.length) summarizeProcessors(r.processors, depth + 2, out);
          else out.push(`${indent(depth + 2)}(empty)`);
        }
        break;
      }

      case "for-each": {
        out.push(`${pad}${i + 1}. ${label} over ${renderValue(cfg.collection)} (batch ${cfg.batchSize ?? 1}, counter ${cfg.counterVariableName || "counter"})`);
        if (cfg.processors?.length) summarizeProcessors(cfg.processors, depth + 1, out);
        else out.push(`${indent(depth + 1)}(empty)`);
        break;
      }

      case "try": {
        out.push(`${pad}${i + 1}. ${label} (${cfg.transactionalAction ?? "INDIFFERENT"})`);
        if (cfg.processors?.length) summarizeProcessors(cfg.processors, depth + 1, out);
        else out.push(`${indent(depth + 1)}(empty)`);
        const handlers: ProcessorInstance[] = cfg.errorHandlers ?? [];
        if (handlers.length) {
          out.push(`${indent(depth + 1)}error handlers:`);
          summarizeProcessors(handlers, depth + 2, out);
        }
        break;
      }

      case "on-error-continue":
      case "on-error-propagate": {
        out.push(`${pad}${i + 1}. ${label} (${cfg.errorType || "ANY"}${cfg.when ? `, when ${cfg.when}` : ""})`);
        if (cfg.processors?.length) summarizeProcessors(cfg.processors, depth + 1, out);
        else out.push(`${indent(depth + 1)}(empty)`);
        break;
      }

      default:
        out.push(`${pad}${i + 1}. ${label}`);
    }
  });
}

function summarizeOneFlow(f: FlowDef, out: string[]): void {
  out.push(`${f.type === "subflow" ? "subflow" : "flow"} "${f.name}"`);

  // A subflow is invoked by a flow-reference and never has its own inbound
  // message, so its source config is noise in the prompt.
  const src = f.type === "subflow" ? null : f.source;
  if (src) {
    const bits = [`mime ${src.mimeType || "?"}`];
    if (src.attributeTemplate && src.attributeTemplate !== "none") bits.push(`${src.attributeTemplate} attributes`);
    if (src.attributes?.length) bits.push(`${src.attributes.length} attribute(s)`);
    if (src.variables?.length)  bits.push(`${src.variables.length} variable(s)`);
    out.push(`${indent(1)}source: ${bits.join(", ")}`);
    const payload = src.value?.content?.trim();
    if (payload) {
      out.push(`${indent(1)}source payload:`);
      out.push(clipScript(payload, 1));
    }
  }

  if (f.processors?.length) {
    out.push(`${indent(1)}processors:`);
    summarizeProcessors(f.processors, 2, out);
  } else {
    out.push(`${indent(1)}processors: (none)`);
  }

  if (f.errorHandlers?.length) {
    out.push(`${indent(1)}error handlers:`);
    summarizeProcessors(f.errorHandlers, 2, out);
  }
}

/**
 * A text rendering of the flow canvas, or undefined when there is nothing built
 * yet — an empty canvas is better left out of the prompt than described.
 */
export function summarizeFlowState(state: FlowCanvasState | null | undefined): string | undefined {
  const flows = state?.flows ?? [];
  if (flows.length === 0) return undefined;

  const out: string[] = [
    `${flows.length} flow${flows.length === 1 ? "" : "s"} on the canvas.`,
    "",
  ];
  flows.forEach((f, i) => {
    if (i > 0) out.push("");
    try {
      summarizeOneFlow(f, out);
    } catch {
      // A malformed flow shouldn't cost Max the rest of the canvas.
      out.push(`flow "${f?.name ?? "?"}" (could not be summarized)`);
    }
  });

  const text = out.join("\n");
  return text.length > MAX_SUMMARY_CHARS
    ? `${text.slice(0, MAX_SUMMARY_CHARS)}\n… (flow summary truncated)`
    : text;
}
