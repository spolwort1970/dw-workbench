import React from "react";
import Editor from "@monaco-editor/react";
import { DW_LANGUAGE_ID } from "../../../dwLanguage";
import {
  type ProcessorInstance, type SourcePayloadConfig, type TransformOutput,
  type ChoiceRoute, dwValue,
} from "../../../types/flow";
import { DWValueInput, MimeSelect, KVEditor, ConfigField, TextInput, SelectInput, MIME_OPTIONS } from "./SharedControls";

// ── Source Payload config ─────────────────────────────────────────────────────

const ATTR_TEMPLATES: Record<string, { key: string; value: ReturnType<typeof dwValue> }[]> = {
  http: [
    { key: "method",        value: dwValue("GET", "literal") },
    { key: "requestPath",   value: dwValue("/api/resource", "literal") },
    { key: "queryString",   value: dwValue("", "literal") },
    { key: "headers",       value: dwValue("{}", "literal") },
    { key: "queryParams",   value: dwValue("{}", "literal") },
    { key: "uriParams",     value: dwValue("{}", "literal") },
    { key: "version",       value: dwValue("HTTP/1.1", "literal") },
    { key: "scheme",        value: dwValue("http", "literal") },
    { key: "localAddress",  value: dwValue("0.0.0.0", "literal") },
    { key: "remoteAddress", value: dwValue("127.0.0.1", "literal") },
  ],
  file: [
    { key: "fileName",     value: dwValue("data.csv", "literal") },
    { key: "filePath",     value: dwValue("/data/data.csv", "literal") },
    { key: "fileSize",     value: dwValue("0", "literal") },
    { key: "lastModified", value: dwValue(new Date().toISOString(), "literal") },
    { key: "isDirectory",  value: dwValue("false", "literal") },
  ],
  database: [
    { key: "affectedRows",  value: dwValue("0", "literal") },
    { key: "generatedKeys", value: dwValue("[]", "literal") },
  ],
  none: [],
};

interface SourceConfigProps {
  config: SourcePayloadConfig;
  onChange: (c: SourcePayloadConfig) => void;
  theme: string;
  tab: string;
}

export function SourceConfigForm({ config, onChange, theme, tab }: SourceConfigProps) {
  const up = (partial: Partial<SourcePayloadConfig>) => onChange({ ...config, ...partial });
  const monacoTheme = theme === "vs" || theme === "solarized-light" ? "vs" : "vs-dark";
  const lang = MIME_OPTIONS.includes(config.mimeType)
    ? (config.mimeType === "application/json" ? "json" : config.mimeType === "application/xml" ? "xml" : config.mimeType === "application/yaml" ? "yaml" : "plaintext")
    : "plaintext";

  if (tab === "attributes") {
    return (
      <div className="config-form">
        <ConfigField label="Template">
          <SelectInput
            value={config.attributeTemplate}
            onChange={(v) => {
              const template = ATTR_TEMPLATES[v] ?? [];
              up({ attributeTemplate: v as any, attributes: template.map((t) => ({ id: crypto.randomUUID(), ...t })) });
            }}
            options={[
              { value: "none",     label: "None (custom)" },
              { value: "http",     label: "HTTP Request Attributes" },
              { value: "file",     label: "File Attributes" },
              { value: "database", label: "Database Attributes" },
            ]}
          />
        </ConfigField>
        <ConfigField label="Attributes">
          <KVEditor pairs={config.attributes} onChange={(attributes) => up({ attributes })} keyPlaceholder="attribute key" valuePlaceholder="value" />
        </ConfigField>
      </div>
    );
  }

  if (tab === "variables") {
    return (
      <div className="config-form">
        <ConfigField label="Pre-seeded Variables">
          <KVEditor pairs={config.variables} onChange={(variables) => up({ variables })} keyPlaceholder="variable name" valuePlaceholder="value" />
        </ConfigField>
      </div>
    );
  }

  // Default: payload tab
  return (
    <div className="config-form">
      <MimeSelect value={config.mimeType} onChange={(mimeType) => up({ mimeType })} />
      <div className="config-field config-field--grow">
        <label className="config-field__label">Payload Value</label>
        <div className="config-monaco-wrapper">
          <Editor
            height="100%"
            language={lang}
            theme={monacoTheme}
            value={config.value.content}
            onChange={(v) => up({ value: { mode: "expression", content: v ?? "" } })}
            options={{ fontSize: 12, minimap: { enabled: false }, scrollBeyondLastLine: false, lineNumbers: "on" }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Set Payload ───────────────────────────────────────────────────────────────

interface SetPayloadFormProps {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  tab: string;
}

export function SetPayloadForm({ config, onChange, tab }: SetPayloadFormProps) {
  if (tab === "mime") return <MimeSelect value={config.mimeType ?? "application/json"} onChange={(v) => onChange({ ...config, mimeType: v })} />;
  return (
    <div className="config-form">
      <ConfigField label="Value">
        <DWValueInput value={config.value ?? dwValue()} onChange={(v) => onChange({ ...config, value: v })} placeholder="payload" rows={4} />
      </ConfigField>
    </div>
  );
}

// ── Transform Message ─────────────────────────────────────────────────────────

interface TransformFormProps {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  theme: string;
  tab: string;
}

export function TransformForm({ config, onChange, theme, tab }: TransformFormProps) {
  const outputs: TransformOutput[] = config.outputs ?? [];
  const monacoTheme = theme === "vs" || theme === "solarized-light" ? "vs" : "vs-dark";

  const updateOutput = (id: string, patch: Partial<TransformOutput>) =>
    onChange({ ...config, outputs: outputs.map((o) => o.id === id ? { ...o, ...patch } : o) });

  const addOutput = (target: TransformOutput["target"]) => {
    const newOut: TransformOutput = target === "payload"
      ? { id: crypto.randomUUID(), target, script: "%dw 2.0\noutput application/json\n---\npayload" }
      : { id: crypto.randomUUID(), target, script: "", value: dwValue("") };
    onChange({ ...config, outputs: [...outputs, newOut] });
  };

  const removeOutput = (id: string) =>
    onChange({ ...config, outputs: outputs.filter((o) => o.id !== id) });

  const payloadOutput   = outputs.find((o) => o.target === "payload");
  const variableOutputs = outputs.filter((o) => o.target === "variable");
  const attrOutputs     = outputs.filter((o) => o.target === "attributes");

  if (tab === "payload") {
    if (!payloadOutput) {
      return (
        <div className="config-form">
          <button type="button" className="kv-add-btn" onClick={() => addOutput("payload")}>+ Add Payload Transform</button>
        </div>
      );
    }
    return (
      <div className="config-form">
        <MimeSelect value={config.mimeType ?? "application/json"} onChange={(mimeType) => onChange({ ...config, mimeType })} />
        <div className="config-monaco-wrapper">
          <Editor
            height="100%"
            defaultLanguage={DW_LANGUAGE_ID}
            theme={monacoTheme}
            value={payloadOutput.script}
            onChange={(v) => updateOutput(payloadOutput.id, { script: v ?? "" })}
            options={{ fontSize: 12, minimap: { enabled: false }, scrollBeyondLastLine: false }}
          />
        </div>
      </div>
    );
  }

  if (tab === "variables") {
    return (
      <div className="config-form">
        <div className="kv-editor">
          {variableOutputs.map((o) => (
            <div key={o.id} className="kv-row">
              <input className="kv-row__field kv-row__field--key" placeholder="variable name"
                value={o.variableName ?? ""} onChange={(e) => updateOutput(o.id, { variableName: e.target.value })} />
              <div className="kv-row__value">
                <DWValueInput value={o.value ?? dwValue("")} onChange={(v) => updateOutput(o.id, { value: v })} placeholder="value" />
              </div>
              <button type="button" className="kv-row__delete" onClick={() => removeOutput(o.id)} title="Remove">×</button>
            </div>
          ))}
          <button type="button" className="kv-add-btn" onClick={() => addOutput("variable")}>+ Add</button>
        </div>
      </div>
    );
  }

  // tab === "attributes"
  return (
    <div className="config-form">
      <div className="kv-editor">
        {attrOutputs.map((o) => (
          <div key={o.id} className="kv-row">
            <input className="kv-row__field kv-row__field--key" placeholder="attribute key"
              value={o.attributeKey ?? ""} onChange={(e) => updateOutput(o.id, { attributeKey: e.target.value })} />
            <div className="kv-row__value">
              <DWValueInput value={o.value ?? dwValue("")} onChange={(v) => updateOutput(o.id, { value: v })} placeholder="value" />
            </div>
            <button type="button" className="kv-row__delete" onClick={() => removeOutput(o.id)} title="Remove">×</button>
          </div>
        ))}
        <button type="button" className="kv-add-btn" onClick={() => addOutput("attributes")}>+ Add</button>
      </div>
    </div>
  );
}

// ── Set Variable ──────────────────────────────────────────────────────────────

interface SetVariableFormProps {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  tab: string;
}

export function SetVariableForm({ config, onChange, tab }: SetVariableFormProps) {
  if (tab === "mime") return <MimeSelect value={config.mimeType ?? "application/json"} onChange={(v) => onChange({ ...config, mimeType: v })} />;
  return (
    <div className="config-form">
      <ConfigField label="Name">
        <TextInput value={config.variableName ?? ""} onChange={(v) => onChange({ ...config, variableName: v })} placeholder="variableName" />
      </ConfigField>
      <ConfigField label="Value">
        <DWValueInput value={config.value ?? dwValue()} onChange={(v) => onChange({ ...config, value: v })} placeholder="text" rows={4} />
      </ConfigField>
    </div>
  );
}

// ── Logger ────────────────────────────────────────────────────────────────────

export function LoggerForm({ config, onChange }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void }) {
  return (
    <div className="config-form">
      <ConfigField label="Level">
        <SelectInput
          value={config.level ?? "INFO"}
          onChange={(v) => onChange({ ...config, level: v })}
          options={[
            { value: "DEBUG", label: "DEBUG" },
            { value: "INFO",  label: "INFO (Default)" },
            { value: "WARN",  label: "WARN" },
            { value: "ERROR", label: "ERROR" },
          ]}
        />
      </ConfigField>
      <ConfigField label="Message">
        <DWValueInput value={config.message ?? dwValue("payload")} onChange={(v) => onChange({ ...config, message: v })} placeholder="text" rows={3} />
      </ConfigField>
      <ConfigField label="Category">
        <TextInput value={config.category ?? ""} onChange={(v) => onChange({ ...config, category: v })} placeholder="log category (optional)" />
      </ConfigField>
    </div>
  );
}

// ── Choice ────────────────────────────────────────────────────────────────────

export function ChoiceForm({ config, onChange }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void }) {
  const routes: ChoiceRoute[] = config.routes ?? [];
  const whens = routes.filter((r) => r.type === "when");
  const def = routes.find((r) => r.type === "default");

  const updateRoute = (id: string, patch: Partial<ChoiceRoute>) =>
    onChange({ ...config, routes: routes.map((r) => r.id === id ? { ...r, ...patch } : r) });

  const addWhen = () => {
    const newRoute: ChoiceRoute = { id: crypto.randomUUID(), type: "when", expression: dwValue(""), processors: [] };
    onChange({ ...config, routes: [newRoute, ...whens, ...(def ? [def] : [])] });
  };

  const removeWhen = (id: string) =>
    onChange({ ...config, routes: routes.filter((r) => r.id !== id || r.type === "default") });

  return (
    <div className="config-form">
      <div className="choice-routes">
        {whens.map((r, i) => (
          <div key={r.id} className="choice-route">
            <div className="choice-route__header">
              <span className="config-field__label">When {i + 1}</span>
              {whens.length > 1 && (
                <button className="choice-route__del" onClick={() => removeWhen(r.id)} type="button">×</button>
              )}
            </div>
            <DWValueInput value={r.expression} onChange={(v) => updateRoute(r.id, { expression: v })} placeholder="boolean DW expression" />
          </div>
        ))}
        <button className="kv-add-btn" onClick={addWhen} type="button">+ Add When</button>
      </div>
      {def && (
        <div className="choice-route choice-route--default">
          <span className="config-field__label">Default (otherwise)</span>
          <p className="config-note">Processors in the Default route are configured on the canvas.</p>
        </div>
      )}
    </div>
  );
}

// ── For Each ──────────────────────────────────────────────────────────────────

export function ForEachForm({ config, onChange }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void }) {
  return (
    <div className="config-form">
      <ConfigField label="Collection">
        <DWValueInput value={config.collection ?? dwValue("payload")} onChange={(v) => onChange({ ...config, collection: v })} placeholder="payload" />
      </ConfigField>
      <ConfigField label="Counter Variable Name">
        <TextInput value={config.counterVariableName ?? "counter"} onChange={(v) => onChange({ ...config, counterVariableName: v })} />
      </ConfigField>
      <ConfigField label="Batch Size">
        <TextInput type="number" value={String(config.batchSize ?? 1)} onChange={(v) => onChange({ ...config, batchSize: Number(v) })} />
      </ConfigField>
      <ConfigField label="Root Message Variable Name">
        <TextInput value={config.rootMessageVariableName ?? "rootMessage"} onChange={(v) => onChange({ ...config, rootMessageVariableName: v })} />
      </ConfigField>
    </div>
  );
}

// ── Try ───────────────────────────────────────────────────────────────────────

export function TryForm({ config, onChange }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void }) {
  return (
    <div className="config-form">
      <p className="config-note">Drop processors into the Try body on the canvas. Drag <strong>On Error Continue</strong> or <strong>On Error Propagate</strong> into the Error Handling zone.</p>
    </div>
  );
}

// ── On Error Continue / On Error Propagate ────────────────────────────────────

const ERROR_TYPES = ["ANY", "MULE:EXPRESSION", "MULE:TRANSFORMATION", "MULE:ROUTING", "MULE:UNKNOWN"];

export function OnErrorForm({ config, onChange }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void }) {
  return (
    <div className="config-form">
      <ConfigField label="Type">
        <SelectInput
          value={config.errorType ?? "ANY"}
          onChange={(v) => onChange({ ...config, errorType: v })}
          options={ERROR_TYPES.map((t) => ({ value: t, label: t }))}
        />
      </ConfigField>
      <ConfigField label="When (optional)">
        <TextInput
          value={config.when ?? ""}
          onChange={(v) => onChange({ ...config, when: v })}
          placeholder="DW boolean expression (leave blank to catch all)"
        />
      </ConfigField>
      <ConfigField label="Log Exception">
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={config.logException ?? true}
            onChange={(e) => onChange({ ...config, logException: e.target.checked })}
          />
          <span>Log exception to console</span>
        </label>
      </ConfigField>
    </div>
  );
}

// ── Raise Error ───────────────────────────────────────────────────────────────

export function RaiseErrorForm({ config, onChange }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void }) {
  return (
    <div className="config-form">
      <ConfigField label="Type *">
        <SelectInput
          value={config.errorType ?? ""}
          onChange={(v) => onChange({ ...config, errorType: v })}
          options={[
            { value: "", label: "— select error type —" },
            ...ERROR_TYPES.filter((t) => t !== "ANY").map((t) => ({ value: t, label: t })),
          ]}
        />
      </ConfigField>
      <ConfigField label="Description">
        <TextInput
          value={config.description ?? ""}
          onChange={(v) => onChange({ ...config, description: v })}
          placeholder="Optional error description"
        />
      </ConfigField>
    </div>
  );
}

// ── Flow Reference ────────────────────────────────────────────────────────────

export function FlowReferenceForm({ config, onChange, flowNames }: { config: Record<string, any>; onChange: (c: Record<string, any>) => void; flowNames: string[] }) {
  return (
    <div className="config-form">
      <ConfigField label="Flow Name">
        {flowNames.length > 0 ? (
          <select className="config-field__select" value={config.flowName?.content ?? ""}
            onChange={(e) => onChange({ ...config, flowName: dwValue(e.target.value) })}>
            <option value="">— select a flow —</option>
            {flowNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          <TextInput value={config.flowName?.content ?? ""} onChange={(v) => onChange({ ...config, flowName: dwValue(v) })} placeholder="flow name" />
        )}
      </ConfigField>
    </div>
  );
}

// ── Processor config dispatcher ───────────────────────────────────────────────

interface ProcessorConfigProps {
  processor: ProcessorInstance;
  onChange: (config: Record<string, any>) => void;
  theme: string;
  tab: string;
  flowNames: string[];
}

export function ProcessorConfigForm({ processor, onChange, theme, tab, flowNames }: ProcessorConfigProps) {
  const { type, config } = processor;
  switch (type) {
    case "set-payload":    return <SetPayloadForm    config={config} onChange={onChange} tab={tab} />;
    case "transform":      return <TransformForm     config={config} onChange={onChange} theme={theme} tab={tab} />;
    case "set-variable":   return <SetVariableForm   config={config} onChange={onChange} tab={tab} />;
    case "logger":         return <LoggerForm        config={config} onChange={onChange} />;
    case "choice":         return <ChoiceForm        config={config} onChange={onChange} />;
    case "for-each":       return <ForEachForm       config={config} onChange={onChange} />;
    case "try":            return <TryForm           config={config} onChange={onChange} />;
    case "on-error-continue":
    case "on-error-propagate": return <OnErrorForm   config={config} onChange={onChange} />;
    case "raise-error":        return <RaiseErrorForm config={config} onChange={onChange} />;
    case "flow-reference": return <FlowReferenceForm config={config} onChange={onChange} flowNames={flowNames} />;
  }
}
