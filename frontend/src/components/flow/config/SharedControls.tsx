import { type DWValue, type KVPair, kvPair } from "../../../types/flow";

// ── MIME options ──────────────────────────────────────────────────────────────

export const MIME_OPTIONS = [
  "application/json",
  "application/xml",
  "text/csv",
  "application/yaml",
  "text/plain",
  "application/x-ndjson",
  "application/dw",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

// ── DWValueInput ──────────────────────────────────────────────────────────────
// fx toggle (expression vs literal) + text input

interface DWValueInputProps {
  value: DWValue;
  onChange: (v: DWValue) => void;
  placeholder?: string;
  rows?: number; // if > 1, renders a textarea
  locked?: boolean; // always expression mode, no toggle
}

export function DWValueInput({ value, onChange, placeholder, rows = 1, locked = false }: DWValueInputProps) {
  const isExpr = locked || value.mode === "expression";

  const toggle = () => { if (!locked) onChange({ ...value, mode: isExpr ? "literal" : "expression" }); };
  const setContent = (content: string) => onChange({ ...value, mode: isExpr ? "expression" : value.mode, content });

  return (
    <div className={`dw-value-input${isExpr ? " dw-value-input--expr" : ""}`}>
      {!locked && (
        <button
          className={`dw-fx-btn ${isExpr ? "dw-fx-btn--active" : ""}`}
          onClick={toggle}
          title={isExpr ? "Switch to string literal" : "Switch to DW expression"}
          type="button"
        >
          fx
        </button>
      )}
      {locked && <span className="dw-fx-btn dw-fx-btn--active dw-fx-btn--locked">fx</span>}
      {isExpr && <span className="dw-value-input__bracket">#[</span>}
      {rows > 1 ? (
        <textarea
          className="dw-value-input__field"
          value={value.content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={isExpr ? "DataWeave expression" : placeholder}
          rows={rows}
          spellCheck={false}
        />
      ) : (
        <input
          className="dw-value-input__field"
          value={value.content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={isExpr ? "DataWeave expression" : placeholder}
          spellCheck={false}
        />
      )}
      {isExpr && <span className="dw-value-input__bracket">]</span>}
    </div>
  );
}

// ── MimeSelect ────────────────────────────────────────────────────────────────

interface MimeSelectProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}

export function MimeSelect({ value, onChange, label = "MIME Type" }: MimeSelectProps) {
  return (
    <div className="config-field">
      <label className="config-field__label">{label}</label>
      <select className="config-field__select" value={value} onChange={(e) => onChange(e.target.value)}>
        {MIME_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  );
}

// ── ConfigField ───────────────────────────────────────────────────────────────

interface ConfigFieldProps {
  label: string;
  children: React.ReactNode;
}

export function ConfigField({ label, children }: ConfigFieldProps) {
  return (
    <div className="config-field">
      <label className="config-field__label">{label}</label>
      {children}
    </div>
  );
}

// ── TextInput ─────────────────────────────────────────────────────────────────

interface TextInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}

export function TextInput({ value, onChange, placeholder, type = "text" }: TextInputProps) {
  return (
    <input
      className="config-field__input"
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
    />
  );
}

// ── SelectInput ───────────────────────────────────────────────────────────────

interface SelectInputProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

export function SelectInput({ value, onChange, options }: SelectInputProps) {
  return (
    <select className="config-field__select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── KVEditor ──────────────────────────────────────────────────────────────────

interface KVEditorProps {
  pairs: KVPair[];
  onChange: (pairs: KVPair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KVEditor({ pairs, onChange, keyPlaceholder = "key", valuePlaceholder = "value" }: KVEditorProps) {
  const updateKey = (id: string, key: string) =>
    onChange(pairs.map((p) => p.id === id ? { ...p, key } : p));
  const updateVal = (id: string, value: DWValue) =>
    onChange(pairs.map((p) => p.id === id ? { ...p, value } : p));
  const remove = (id: string) => onChange(pairs.filter((p) => p.id !== id));
  const add = () => onChange([...pairs, kvPair()]);

  return (
    <div className="kv-editor">
      {pairs.map((p) => (
        <div key={p.id} className="kv-row">
          <input className="kv-row__field kv-row__field--key" placeholder={keyPlaceholder} value={p.key} onChange={(e) => updateKey(p.id, e.target.value)} />
          <div className="kv-row__value">
            <DWValueInput value={p.value} onChange={(v) => updateVal(p.id, v)} placeholder={valuePlaceholder} />
          </div>
          <button className="kv-row__delete" onClick={() => remove(p.id)} type="button" title="Remove">×</button>
        </div>
      ))}
      <button className="kv-add-btn" onClick={add} type="button">+ Add</button>
    </div>
  );
}
