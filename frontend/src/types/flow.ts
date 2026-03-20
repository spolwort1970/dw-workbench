// ── Primitives ────────────────────────────────────────────────────────────────

export interface DWValue {
  mode: "expression" | "literal";
  content: string;
}

export interface KVPair {
  id: string;
  key: string;
  value: DWValue;
}

export function dwValue(content = "", mode: "expression" | "literal" = "expression"): DWValue {
  return { mode, content };
}

export function kvPair(key = "", value = ""): KVPair {
  return { id: crypto.randomUUID(), key, value: dwValue(value, "literal") };
}

// ── Processor config types ────────────────────────────────────────────────────

export interface SourcePayloadConfig {
  value: DWValue;
  mimeType: string;
  attributeTemplate: "none" | "http" | "file" | "database";
  attributes: KVPair[];
  variables: KVPair[];
}

export interface SetPayloadConfig {
  value: DWValue;
  mimeType: string;
}

export interface TransformOutput {
  id: string;
  target: "payload" | "variable" | "attributes";
  variableName?: string;   // when target === "variable"
  attributeKey?: string;   // when target === "attributes"
  script: string;          // used when target === "payload"
  value?: DWValue;         // used when target === "variable" | "attributes"
}

export interface TransformMessageConfig {
  outputs: TransformOutput[];
}

export interface SetVariableConfig {
  variableName: string;
  value: DWValue;
  mimeType: string;
}

export interface LoggerConfig {
  message: DWValue;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  category: string;
}

export interface ChoiceRoute {
  id: string;
  type: "when" | "default";
  expression: DWValue;
  processors: ProcessorInstance[];
}

export interface ChoiceConfig {
  routes: ChoiceRoute[];
}

export interface ForEachConfig {
  collection: DWValue;
  counterVariableName: string;
  batchSize: number;
  rootMessageVariableName: string;
  processors: ProcessorInstance[];
}

export interface TryConfig {
  transactionalAction: string;
  transactionType: string;
  processors: ProcessorInstance[];
  errorHandlers: ProcessorInstance[];
}

export interface FlowReferenceConfig {
  flowName: DWValue;
}

// ── Processor types ───────────────────────────────────────────────────────────

export type ProcessorType =
  | "set-payload"
  | "transform"
  | "set-variable"
  | "logger"
  | "choice"
  | "for-each"
  | "try"
  | "on-error-continue"
  | "on-error-propagate"
  | "raise-error"
  | "flow-reference";

export const SCOPE_TYPES: ProcessorType[] = ["choice", "for-each", "try", "on-error-continue", "on-error-propagate"];

export interface ProcessorInstance {
  id: string;
  type: ProcessorType;
  displayName: string;
  config: Record<string, any>;
}

// ── Flow definition ───────────────────────────────────────────────────────────

export interface FlowDef {
  id: string;
  name: string;
  type: "flow" | "subflow";
  x: number;
  y: number;
  source: SourcePayloadConfig;
  processors: ProcessorInstance[];
  errorHandlers: ProcessorInstance[];
}

// ── Canvas state ──────────────────────────────────────────────────────────────

export interface FlowCanvasState {
  flows: FlowDef[];
}

// ── Palette ───────────────────────────────────────────────────────────────────

export interface PaletteItem {
  type: ProcessorType | "flow" | "subflow";
  label: string;
  category: "flow" | "core" | "scope" | "error";
}

export const PALETTE_ITEMS: PaletteItem[] = [
  { type: "flow",              label: "Flow",              category: "flow"  },
  { type: "subflow",           label: "Sub Flow",          category: "flow"  },
  { type: "flow-reference",    label: "Flow Reference",    category: "flow"  },
  { type: "set-payload",       label: "Set Payload",       category: "core"  },
  { type: "transform",         label: "Transform Message", category: "core"  },
  { type: "set-variable",      label: "Set Variable",      category: "core"  },
  { type: "logger",            label: "Logger",            category: "core"  },
  { type: "choice",            label: "Choice",            category: "scope" },
  { type: "for-each",          label: "For Each",          category: "scope" },
  { type: "try",               label: "Try",               category: "scope" },
  { type: "on-error-continue",  label: "On Error Continue",  category: "error" },
  { type: "on-error-propagate", label: "On Error Propagate", category: "error" },
  { type: "raise-error",        label: "Raise Error",        category: "error" },
];

// ── Processor colors ──────────────────────────────────────────────────────────


export const PROCESSOR_COLORS: Record<ProcessorType, string> = {
  "set-payload":        "#00a65a",
  "transform":          "#7c5cbf",
  "set-variable":       "#00a65a",
  "logger":             "#4b6cb7",
  "choice":             "#e8a118",
  "for-each":           "#1b9cd3",
  "try":                "#1b9cd3",
  "flow-reference":     "#5b6abf",
  "on-error-continue":  "#c0392b",
  "on-error-propagate": "#c0392b",
  "raise-error":        "#c0392b",
};

// ── Default factories ─────────────────────────────────────────────────────────

export function defaultSourcePayload(): SourcePayloadConfig {
  return {
    value: dwValue('{\n  "message": "Hello, world!"\n}'),
    mimeType: "application/json",
    attributeTemplate: "none",
    attributes: [],
    variables: [],
  };
}

export function defaultDisplayName(type: ProcessorType): string {
  const names: Record<ProcessorType, string> = {
    "set-payload":        "Set Payload",
    "transform":          "Transform Message",
    "set-variable":       "Set Variable",
    "logger":             "Logger",
    "choice":             "Choice",
    "for-each":           "For Each",
    "try":                "Try",
    "flow-reference":     "Flow Reference",
    "on-error-continue":  "On Error Continue",
    "on-error-propagate": "On Error Propagate",
    "raise-error":        "Raise Error",
  };
  return names[type];
}

export function defaultProcessorConfig(type: ProcessorType): Record<string, any> {
  switch (type) {
    case "set-payload":
      return { value: dwValue(), mimeType: "application/json" };
    case "transform":
      return { outputs: [{ id: crypto.randomUUID(), target: "payload", script: "%dw 2.0\noutput application/json\n---\npayload" }] };
    case "set-variable":
      return { variableName: "", value: dwValue(), mimeType: "application/json" };
    case "logger":
      return { message: dwValue("payload"), level: "INFO", category: "" };
    case "choice":
      return {
        routes: [
          { id: crypto.randomUUID(), type: "when",    expression: dwValue(""), processors: [] },
          { id: crypto.randomUUID(), type: "default", expression: dwValue(""), processors: [] },
        ],
      };
    case "for-each":
      return { collection: dwValue("payload"), counterVariableName: "counter", batchSize: 1, rootMessageVariableName: "rootMessage", processors: [] };
    case "try":
      return { transactionalAction: "INDIFFERENT", transactionType: "LOCAL", processors: [], errorHandlers: [] };
    case "on-error-continue":
      return { errorType: "ANY", when: "", logException: true, processors: [] };
    case "on-error-propagate":
      return { errorType: "ANY", when: "", logException: true, processors: [] };
    case "raise-error":
      return { errorType: "", description: "" };
    case "flow-reference":
      return { flowName: dwValue("") };
  }
}

export function makeProcessor(type: ProcessorType): ProcessorInstance {
  return {
    id: crypto.randomUUID(),
    type,
    displayName: defaultDisplayName(type),
    config: defaultProcessorConfig(type),
  };
}

export function makeFlow(type: "flow" | "subflow", name: string, x: number, y: number): FlowDef {
  return { id: crypto.randomUUID(), name, type, x, y, source: defaultSourcePayload(), processors: [], errorHandlers: [] };
}

// ── Tree helpers ──────────────────────────────────────────────────────────────

export function updateProcessorInList(
  processors: ProcessorInstance[],
  id: string,
  updater: (p: ProcessorInstance) => ProcessorInstance,
): ProcessorInstance[] {
  let anyChanged = false;
  const result = processors.map((p) => {
    if (p.id === id) { anyChanged = true; return updater(p); }
    if (p.type === "for-each") {
      const procList = p.config.processors ?? [];
      const inner = updateProcessorInList(procList, id, updater);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
    }
    if (p.type === "try") {
      const procList = p.config.processors ?? [];
      const inner = updateProcessorInList(procList, id, updater);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
      let ehChanged = false;
      const errorHandlers = (p.config.errorHandlers ?? []).map((h: ProcessorInstance) => {
        if (h.id === id) { ehChanged = true; return updater(h); }
        const hiList = h.config.processors ?? [];
        const hi = updateProcessorInList(hiList, id, updater);
        if (hi !== hiList) { ehChanged = true; return { ...h, config: { ...h.config, processors: hi } }; }
        return h;
      });
      if (ehChanged) { anyChanged = true; return { ...p, config: { ...p.config, errorHandlers } }; }
    }
    if (p.type === "on-error-continue" || p.type === "on-error-propagate") {
      const procList = p.config.processors ?? [];
      const inner = updateProcessorInList(procList, id, updater);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
    }
    if (p.type === "choice") {
      let routeChanged = false;
      const routes = (p.config.routes ?? []).map((r: ChoiceRoute) => {
        const inner = updateProcessorInList(r.processors, id, updater);
        if (inner !== r.processors) { routeChanged = true; return { ...r, processors: inner }; }
        return r;
      });
      if (routeChanged) { anyChanged = true; return { ...p, config: { ...p.config, routes } }; }
    }
    return p;
  });
  return anyChanged ? result : processors;
}

export function addToScope(
  processors: ProcessorInstance[],
  scopeId: string,
  newProc: ProcessorInstance,
  routeId?: string,
): ProcessorInstance[] {
  let anyChanged = false;
  const result = processors.map((p) => {
    // Found the target scope — add to it
    if (p.id === scopeId) {
      anyChanged = true;
      if (p.type === "for-each") {
        return { ...p, config: { ...p.config, processors: [...(p.config.processors ?? []), newProc] } };
      }
      if (p.type === "try") {
        if (routeId === "__error_handler__") {
          return { ...p, config: { ...p.config, errorHandlers: [...(p.config.errorHandlers ?? []), newProc] } };
        }
        return { ...p, config: { ...p.config, processors: [...(p.config.processors ?? []), newProc] } };
      }
      if (p.type === "on-error-continue" || p.type === "on-error-propagate") {
        return { ...p, config: { ...p.config, processors: [...(p.config.processors ?? []), newProc] } };
      }
      if (p.type === "choice" && routeId) {
        return {
          ...p,
          config: {
            ...p.config,
            routes: (p.config.routes ?? []).map((r: ChoiceRoute) =>
              r.id === routeId ? { ...r, processors: [...r.processors, newProc] } : r,
            ),
          },
        };
      }
      anyChanged = false; // unsupported scope type, nothing changed
      return p;
    }
    // Recurse into nested scopes
    if (p.type === "for-each") {
      const procList = p.config.processors ?? [];
      const inner = addToScope(procList, scopeId, newProc, routeId);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
    }
    if (p.type === "try") {
      const procList = p.config.processors ?? [];
      const inner = addToScope(procList, scopeId, newProc, routeId);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
      let ehChanged = false;
      const errorHandlers = (p.config.errorHandlers ?? []).map((h: ProcessorInstance) => {
        if (h.id === scopeId) {
          ehChanged = true;
          return { ...h, config: { ...h.config, processors: [...(h.config.processors ?? []), newProc] } };
        }
        const hiList = h.config.processors ?? [];
        const hi = addToScope(hiList, scopeId, newProc, routeId);
        if (hi !== hiList) { ehChanged = true; return { ...h, config: { ...h.config, processors: hi } }; }
        return h;
      });
      if (ehChanged) { anyChanged = true; return { ...p, config: { ...p.config, errorHandlers } }; }
    }
    if (p.type === "on-error-continue" || p.type === "on-error-propagate") {
      const procList = p.config.processors ?? [];
      const inner = addToScope(procList, scopeId, newProc, routeId);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
    }
    if (p.type === "choice") {
      let routeChanged = false;
      const routes = (p.config.routes ?? []).map((r: ChoiceRoute) => {
        const inner = addToScope(r.processors, scopeId, newProc, routeId);
        if (inner !== r.processors) { routeChanged = true; return { ...r, processors: inner }; }
        return r;
      });
      if (routeChanged) { anyChanged = true; return { ...p, config: { ...p.config, routes } }; }
    }
    return p;
  });
  return anyChanged ? result : processors;
}

/** Move a processor one position left (-1) or right (+1) within its containing list, at any nesting depth. */
export function reorderProcessor(
  processors: ProcessorInstance[],
  id: string,
  direction: -1 | 1,
): ProcessorInstance[] {
  // Try at this level first
  const idx = processors.findIndex((p) => p.id === id);
  if (idx !== -1) {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= processors.length) return processors; // already at boundary
    const result = [...processors];
    [result[idx], result[newIdx]] = [result[newIdx], result[idx]];
    return result;
  }
  // Recurse into nested scopes
  let anyChanged = false;
  const result = processors.map((p) => {
    if (p.type === "for-each") {
      const procList = p.config.processors ?? [];
      const inner = reorderProcessor(procList, id, direction);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
    }
    if (p.type === "try") {
      const procList = p.config.processors ?? [];
      const inner = reorderProcessor(procList, id, direction);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
      let ehChanged = false;
      const errorHandlers = (p.config.errorHandlers ?? []).map((h: ProcessorInstance) => {
        const hiList = h.config.processors ?? [];
        const hi = reorderProcessor(hiList, id, direction);
        if (hi !== hiList) { ehChanged = true; return { ...h, config: { ...h.config, processors: hi } }; }
        return h;
      });
      if (ehChanged) { anyChanged = true; return { ...p, config: { ...p.config, errorHandlers } }; }
    }
    if (p.type === "on-error-continue" || p.type === "on-error-propagate") {
      const procList = p.config.processors ?? [];
      const inner = reorderProcessor(procList, id, direction);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
    }
    if (p.type === "choice") {
      let routeChanged = false;
      const routes = (p.config.routes ?? []).map((r: ChoiceRoute) => {
        const inner = reorderProcessor(r.processors, id, direction);
        if (inner !== r.processors) { routeChanged = true; return { ...r, processors: inner }; }
        return r;
      });
      if (routeChanged) { anyChanged = true; return { ...p, config: { ...p.config, routes } }; }
    }
    return p;
  });
  return anyChanged ? result : processors;
}

/** Deep-clone a processor (and all nested processors) with fresh IDs throughout. */
export function deepCloneProcessor(p: ProcessorInstance): ProcessorInstance {
  const newId = crypto.randomUUID();
  if (p.type === "choice") {
    const routes = (p.config.routes ?? []).map((r: ChoiceRoute) => ({
      ...r,
      id: crypto.randomUUID(),
      processors: r.processors.map(deepCloneProcessor),
    }));
    return { ...p, id: newId, config: { ...p.config, routes } };
  }
  if (p.type === "for-each") {
    const processors = (p.config.processors ?? []).map(deepCloneProcessor);
    return { ...p, id: newId, config: { ...p.config, processors } };
  }
  if (p.type === "try") {
    const processors = (p.config.processors ?? []).map(deepCloneProcessor);
    const errorHandlers = (p.config.errorHandlers ?? []).map((h: ProcessorInstance) => ({
      ...h,
      id: crypto.randomUUID(),
      config: { ...h.config, processors: (h.config.processors ?? []).map(deepCloneProcessor) },
    }));
    return { ...p, id: newId, config: { ...p.config, processors, errorHandlers } };
  }
  if (p.type === "on-error-continue" || p.type === "on-error-propagate") {
    const processors = (p.config.processors ?? []).map(deepCloneProcessor);
    return { ...p, id: newId, config: { ...p.config, processors } };
  }
  if (p.type === "transform") {
    const outputs = (p.config.outputs ?? []).map((o: TransformOutput) => ({ ...o, id: crypto.randomUUID() }));
    return { ...p, id: newId, config: { ...p.config, outputs } };
  }
  return { ...p, id: newId };
}

export function removeFromList(processors: ProcessorInstance[], id: string): ProcessorInstance[] {
  const filtered = processors.filter((p) => p.id !== id);
  if (filtered.length !== processors.length) return filtered;
  let anyChanged = false;
  const result = processors.map((p) => {
    if (p.type === "for-each") {
      const procList = p.config.processors ?? [];
      const inner = removeFromList(procList, id);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
    }
    if (p.type === "try") {
      const procList = p.config.processors ?? [];
      const inner = removeFromList(procList, id);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
      const filteredHandlers = (p.config.errorHandlers ?? []).filter((h: ProcessorInstance) => h.id !== id);
      if (filteredHandlers.length !== (p.config.errorHandlers ?? []).length) {
        anyChanged = true;
        return { ...p, config: { ...p.config, errorHandlers: filteredHandlers } };
      }
      let ehChanged = false;
      const errorHandlers = (p.config.errorHandlers ?? []).map((h: ProcessorInstance) => {
        const hiList = h.config.processors ?? [];
        const hi = removeFromList(hiList, id);
        if (hi !== hiList) { ehChanged = true; return { ...h, config: { ...h.config, processors: hi } }; }
        return h;
      });
      if (ehChanged) { anyChanged = true; return { ...p, config: { ...p.config, errorHandlers } }; }
    }
    if (p.type === "on-error-continue" || p.type === "on-error-propagate") {
      const procList = p.config.processors ?? [];
      const inner = removeFromList(procList, id);
      if (inner !== procList) { anyChanged = true; return { ...p, config: { ...p.config, processors: inner } }; }
    }
    if (p.type === "choice") {
      let routeChanged = false;
      const routes = (p.config.routes ?? []).map((r: ChoiceRoute) => {
        const inner = removeFromList(r.processors, id);
        if (inner !== r.processors) { routeChanged = true; return { ...r, processors: inner }; }
        return r;
      });
      if (routeChanged) { anyChanged = true; return { ...p, config: { ...p.config, routes } }; }
    }
    return p;
  });
  return anyChanged ? result : processors;
}

// ── Saved-state migration ──────────────────────────────────────────────────────
// Normalises flow state loaded from localStorage/disk that may have been saved
// before the errorHandler-redesign (where TryErrorHandler fields lived directly
// on the handler object instead of nested inside `config`).

function _migrateProc(p: any): ProcessorInstance {
  if (p.type === "try") {
    const processors = (p.config?.processors ?? []).map(_migrateProc);
    const errorHandlers = (p.config?.errorHandlers ?? []).map((h: any): ProcessorInstance => {
      if (h.config === undefined) {
        // Old flat format → lift fields into config
        return {
          id:          h.id          ?? crypto.randomUUID(),
          type:        h.type        ?? "on-error-propagate",
          displayName: h.displayName ?? (h.type === "on-error-continue" ? "On Error Continue" : "On Error Propagate"),
          config: {
            errorType:    h.errorType    ?? "ANY",
            when:         h.when         ?? "",
            logException: h.logException ?? true,
            processors:   (h.processors  ?? []).map(_migrateProc),
          },
        };
      }
      return { ...h, config: { ...h.config, processors: (h.config.processors ?? []).map(_migrateProc) } };
    });
    return { ...p, config: { ...p.config, processors, errorHandlers } };
  }
  if (p.type === "for-each" || p.type === "on-error-continue" || p.type === "on-error-propagate") {
    return { ...p, config: { ...p.config, processors: (p.config?.processors ?? []).map(_migrateProc) } };
  }
  if (p.type === "choice") {
    const routes = (p.config?.routes ?? []).map((r: any) => ({
      ...r, processors: (r.processors ?? []).map(_migrateProc),
    }));
    return { ...p, config: { ...p.config, routes } };
  }
  return p as ProcessorInstance;
}

export function migrateFlows(flows: any[]): FlowDef[] {
  return (flows ?? []).map((f) => ({
    ...f,
    processors:    (f.processors    ?? []).map(_migrateProc),
    errorHandlers: (f.errorHandlers ?? []).map(_migrateProc),
  }));
}
