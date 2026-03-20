import { useState, useEffect } from "react";
import { BUILTIN_HINTS, loadCustomHints, saveCustomHints, getErrorHint, type CustomHint } from "../errorHints";

interface Props {
  onClose: () => void;
}

export default function ErrorHintsModal({ onClose }: Props) {
  const [custom, setCustom] = useState<CustomHint[]>(() => loadCustomHints());
  const [pattern, setPattern] = useState("");
  const [tip, setTip] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [patternError, setPatternError] = useState("");

  // Persist on change
  useEffect(() => {
    saveCustomHints(custom);
  }, [custom]);

  // Live test
  useEffect(() => {
    if (!testInput.trim()) { setTestResult(null); return; }
    setTestResult(getErrorHint(testInput));
  }, [testInput, custom]);

  const validatePattern = (p: string) => {
    try { new RegExp(p, "i"); setPatternError(""); return true; }
    catch (e) { setPatternError(`Invalid regex: ${(e as Error).message}`); return false; }
  };

  const handleAdd = () => {
    const p = pattern.trim();
    const t = tip.trim();
    if (!p || !t) return;
    if (!validatePattern(p)) return;
    setCustom((prev) => [...prev, { pattern: p, tip: t }]);
    setPattern("");
    setTip("");
  };

  const handleDelete = (i: number) => {
    setCustom((prev) => prev.filter((_, idx) => idx !== i));
  };

  return (
    <div className="hints-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hints-modal">
        <div className="hints-modal-header">
          <span className="hints-modal-title">Error Hints</span>
          <button className="hints-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Built-ins */}
        <div className="hints-section-label">Built-in (read-only)</div>
        <div className="hints-list">
          {BUILTIN_HINTS.map((h, i) => (
            <div key={i} className="hints-row hints-row--builtin">
              <code className="hints-pattern">{h.pattern}</code>
              <span className="hints-tip">{h.tip}</span>
            </div>
          ))}
        </div>

        {/* Custom */}
        <div className="hints-section-label">
          Custom
          {custom.length === 0 && <span className="hints-empty-note"> — none yet</span>}
        </div>
        {custom.length > 0 && (
          <div className="hints-list">
            {custom.map((h, i) => (
              <div key={i} className="hints-row">
                <code className="hints-pattern">{h.pattern}</code>
                <span className="hints-tip">{h.tip}</span>
                <button className="hints-delete-btn" onClick={() => handleDelete(i)} title="Delete hint">✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Add new */}
        <div className="hints-section-label hints-section-label--add">Add a hint</div>
        <div className="hints-add-form">
          <div className="hints-add-row">
            <label className="hints-field-label">Pattern (regex or text)</label>
            <input
              className={`hints-input ${patternError ? "hints-input--error" : ""}`}
              value={pattern}
              onChange={(e) => { setPattern(e.target.value); if (e.target.value) validatePattern(e.target.value); else setPatternError(""); }}
              placeholder='e.g. "Cannot coerce" or "timeout|TIMEOUT"'
              spellCheck={false}
            />
            {patternError && <span className="hints-error-msg">{patternError}</span>}
          </div>
          <div className="hints-add-row">
            <label className="hints-field-label">Tip to show</label>
            <textarea
              className="hints-textarea"
              value={tip}
              onChange={(e) => setTip(e.target.value)}
              placeholder="What the user should try..."
              rows={2}
            />
          </div>
          <button
            className="hints-add-btn"
            onClick={handleAdd}
            disabled={!pattern.trim() || !tip.trim() || !!patternError}
          >
            Add Hint
          </button>
        </div>

        {/* Test */}
        <div className="hints-section-label">Test</div>
        <div className="hints-test-area">
          <input
            className="hints-input"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            placeholder="Paste an error message to see which hint fires…"
          />
          {testInput.trim() && (
            <div className={`hints-test-result ${testResult ? "hints-test-result--match" : "hints-test-result--none"}`}>
              {testResult ? `✓ ${testResult}` : "No hint matches this error."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
