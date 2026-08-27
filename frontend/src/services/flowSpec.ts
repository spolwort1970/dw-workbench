import {
  dwValue,
  makeFlow,
  makeProcessor,
  type FlowDef,
  type ProcessorInstance,
  type ProcessorType,
} from "../types/flow";

// Turns a ```dwflow block written by Max into real canvas flows.
//
// Max cannot call tools: the Claude CLI provider runs with `--tools ""` and every
// provider is consumed as a plain text stream, so a tool-use loop would only ever
// work for two of the three. Instead Max writes a fenced `dwflow` block, this
// parses it, and the user presses a button to apply it — which also means nothing
// mutates the canvas without being seen first.
//
// The spec is deliberately a shorthand, not the internal shape: no ids, no
// coordinates, no nested `config` objects. Everything is built through
// makeProcessor()/makeFlow() so defaults and fresh ids are always correct.

const KNOWN_TYPES: ProcessorType[] = [
  "set-payload", "transform", "set-variable", "logger", "choice",
  "for-each", "try", "on-error-continue", "on-error-propagate",
  "raise-error", "flow-reference",
];

export interface FlowSpecResult {
  flows:  FlowDef[];
  errors: string[];
}

/**
 * Accepts a bare string, `{mode, content}`, or the `{expr}` / `{literal}`
 * shorthands.
 *
 * The shorthands matter for fields that default to literal text — a logger
 * message of `error.description` is almost always meant as an expression, and
 * without a way to say so it would be logged as that string verbatim.
 */
function toValue(raw: any, fallbackMode: "expression" | "literal" = "expression") {
  if (raw == null) return dwValue("", fallbackMode);
  if (typeof raw === "string") return dwValue(raw, fallbackMode);
  if (typeof raw === "object") {
    if (typeof raw.expr === "string")       return dwValue(raw.expr, "expression");
    if (typeof raw.expression === "string") return dwValue(raw.expression, "expression");
    if (typeof raw.literal === "string")    return dwValue(raw.literal, "literal");
    if (typeof raw.content === "string")    return dwValue(raw.content, raw.mode === "literal" ? "literal" : "expression");
  }
  return dwValue(String(raw), fallbackMode);
}

function buildProcessor(spec: any, errors: string[], path: string): ProcessorInstance | null {
  const type = spec?.type;
  if (!KNOWN_TYPES.includes(type)) {
    errors.push(`${path}: unknown processor type "${type ?? "(missing)"}"`);
    return null;
  }

  const p = makeProcessor(type);
  if (typeof spec.displayName === "string" && spec.displayName.trim()) {
    p.displayName = spec.displayName.trim();
  }

  const kids = (list: any, sub: string): ProcessorInstance[] =>
    Array.isArray(list)
      ? list.map((c, i) => buildProcessor(c, errors, `${path}.${sub}[${i}]`)).filter((x): x is ProcessorInstance => x !== null)
      : [];

  switch (type) {
    case "set-payload":
      p.config.value    = toValue(spec.value, "literal");
      p.config.mimeType = spec.mimeType ?? p.config.mimeType;
      break;

    case "transform": {
      // Shorthand: { type: "transform", script: "%dw 2.0 ..." }
      const outputs = Array.isArray(spec.outputs)
        ? spec.outputs
        : spec.script != null ? [{ target: "payload", script: spec.script }] : [];
      if (outputs.length === 0) {
        errors.push(`${path}: transform has no outputs`);
        break;
      }
      p.config.outputs = outputs.map((o: any) => {
        const target = o?.target === "variable" || o?.target === "attributes" ? o.target : "payload";
        const base   = { id: crypto.randomUUID(), target };
        if (target === "payload")    return { ...base, script: String(o?.script ?? "") };
        if (target === "variable")   return { ...base, script: "", variableName: o?.variableName ?? o?.name ?? "", value: toValue(o?.value) };
        return { ...base, script: "", attributeKey: o?.attributeKey ?? o?.key ?? "", value: toValue(o?.value) };
      });
      break;
    }

    case "set-variable":
      p.config.variableName = spec.variableName ?? spec.name ?? "";
      p.config.value        = toValue(spec.value);
      p.config.mimeType     = spec.mimeType ?? p.config.mimeType;
      if (!p.config.variableName) errors.push(`${path}: set-variable is missing a variable name`);
      break;

    case "logger":
      p.config.message  = toValue(spec.message, "literal");
      p.config.level    = ["DEBUG", "INFO", "WARN", "ERROR"].includes(spec.level) ? spec.level : "INFO";
      p.config.category = spec.category ?? "";
      break;

    case "flow-reference":
      p.config.flowName = toValue(spec.flowName ?? spec.name, "literal");
      if (!p.config.flowName.content) errors.push(`${path}: flow-reference is missing a target flow name`);
      break;

    case "raise-error":
      p.config.errorType   = spec.errorType ?? "";
      p.config.description = spec.description ?? "";
      break;

    case "choice": {
      const routes = Array.isArray(spec.routes) ? spec.routes : [];
      if (routes.length === 0) { errors.push(`${path}: choice has no routes`); break; }
      p.config.routes = routes.map((r: any, i: number) => {
        const isDefault = r?.default === true || r?.otherwise === true || r?.type === "default";
        return {
          id: crypto.randomUUID(),
          type: isDefault ? "default" : "when",
          expression: toValue(isDefault ? "" : (r?.when ?? r?.expression)),
          processors: kids(r?.processors, `routes[${i}]`),
        };
      });
      break;
    }

    case "for-each":
      p.config.collection           = toValue(spec.collection ?? "payload");
      p.config.counterVariableName  = spec.counterVariableName ?? p.config.counterVariableName;
      p.config.batchSize            = Number.isFinite(spec.batchSize) ? spec.batchSize : p.config.batchSize;
      p.config.processors           = kids(spec.processors, "processors");
      break;

    case "try":
      p.config.transactionalAction = spec.transactionalAction ?? p.config.transactionalAction;
      p.config.processors          = kids(spec.processors, "processors");
      p.config.errorHandlers       = kids(spec.errorHandlers, "errorHandlers");
      break;

    case "on-error-continue":
    case "on-error-propagate":
      p.config.errorType    = spec.errorType ?? "ANY";
      p.config.when         = spec.when ?? "";
      p.config.logException = spec.logException !== false;
      p.config.processors   = kids(spec.processors, "processors");
      break;
  }

  return p;
}

function buildFlow(spec: any, index: number, errors: string[]): FlowDef | null {
  const name = typeof spec?.name === "string" && spec.name.trim() ? spec.name.trim() : "";
  if (!name) { errors.push(`flows[${index}]: missing a name`); return null; }

  const type = spec.type === "subflow" ? "subflow" : "flow";
  // Positions are assigned by the canvas when it restacks, so 0,0 is fine here.
  const f = makeFlow(type, name, 0, 0);

  if (spec.source && typeof spec.source === "object") {
    if (spec.source.mimeType) f.source.mimeType = spec.source.mimeType;
    const payload = spec.source.payload ?? spec.source.value;
    if (payload != null) f.source.value = toValue(payload);
  }

  f.processors = Array.isArray(spec.processors)
    ? spec.processors
        .map((p: any, i: number) => buildProcessor(p, errors, `flows[${index}].processors[${i}]`))
        .filter((x: ProcessorInstance | null): x is ProcessorInstance => x !== null)
    : [];

  f.errorHandlers = Array.isArray(spec.errorHandlers)
    ? spec.errorHandlers
        .map((p: any, i: number) => buildProcessor(p, errors, `flows[${index}].errorHandlers[${i}]`))
        .filter((x: ProcessorInstance | null): x is ProcessorInstance => x !== null)
    : [];

  return f;
}

/** Build canvas flows from a parsed dwflow spec object. */
export function flowsFromSpec(spec: any): FlowSpecResult {
  const errors: string[] = [];
  const rawFlows = Array.isArray(spec) ? spec : spec?.flows;
  if (!Array.isArray(rawFlows)) {
    return { flows: [], errors: ['spec must be an object with a "flows" array'] };
  }
  const flows = rawFlows
    .map((f, i) => buildFlow(f, i, errors))
    .filter((f): f is FlowDef => f !== null);
  return { flows, errors };
}

export interface DwFlowBlock {
  /** Index of the fenced block within the message, used as a React key. */
  index:  number;
  /** Stable hash of the block body, so "already applied" survives a remount. */
  key:    string;
  flows:  FlowDef[];
  errors: string[];
  /** Parse failure — the block was not valid JSON. */
  parseError?: string;
}

/** djb2 over the block body. Only needs to be stable and collision-shy, not secure. */
function blockKey(body: string): string {
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const FENCE_RE = /```dwflow\s*\n([\s\S]*?)(?:```|$)/g;

/**
 * Extract every ```dwflow block from an assistant message.
 *
 * Tolerates an unterminated fence so a block that is still streaming in does not
 * register as a parse error mid-render.
 */
export function extractDwFlowBlocks(text: string): DwFlowBlock[] {
  if (!text || !text.includes("```dwflow")) return [];
  const blocks: DwFlowBlock[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    const body = m[1].trim();
    const index = i++;
    if (!body) continue;
    try {
      const parsed = JSON.parse(body);
      const { flows, errors } = flowsFromSpec(parsed);
      blocks.push({ index, key: blockKey(body), flows, errors });
    } catch (e: any) {
      // Still streaming: an incomplete block isn't an error worth showing yet.
      const closed = m[0].trimEnd().endsWith("```");
      if (closed) blocks.push({ index, key: blockKey(body), flows: [], errors: [], parseError: e?.message ?? "invalid JSON" });
    }
  }
  return blocks;
}

/** Hide dwflow blocks from the prose rendering — the apply card stands in for them. */
export function stripDwFlowBlocks(text: string): string {
  return text.replace(/```dwflow\s*\n[\s\S]*?(?:```|$)/g, "").trim();
}
