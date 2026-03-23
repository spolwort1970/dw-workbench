import { useEffect, useRef, useState } from "react";
import { THEMES, type ThemeOption } from "../monacoThemes";
import { maxTestConnection } from "../services/api";
import type { MaxProvider } from "../types/max";

export const FONT_SIZES = [
  { label: "Small",  value: 13 },
  { label: "Medium", value: 16 },
  { label: "Large",  value: 20 },
];

interface Props {
  theme: string;
  onThemeChange: (id: string) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  onOpenHints: () => void;
}

export default function SettingsDropdown({ theme, onThemeChange, fontSize, onFontSizeChange, onOpenHints }: Props) {
  const [open, setOpen] = useState(false);
  const [themeExpanded, setThemeExpanded] = useState(false);
  const [fontExpanded, setFontExpanded] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [apiKey, setApiKey]           = useState(() => localStorage.getItem("dw-max-api-key") ?? "");
  const [provider, setProvider]       = useState<MaxProvider>(() => (localStorage.getItem("dw-max-provider") as MaxProvider) ?? "anthropic");
  const [vertexRegion, setVertexRegion] = useState(() => localStorage.getItem("dw-max-vertex-region") ?? "us-east5");
  const [testStatus, setTestStatus]   = useState<"idle" | "testing" | "ok" | "err">("idle");
  const [testMsg, setTestMsg]         = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeThemeLabel = THEMES.find((t) => t.id === theme)?.label ?? theme;
  const activeFontLabel  = FONT_SIZES.find((f) => f.value === fontSize)?.label ?? "Small";

  return (
    <div className="settings-wrapper" ref={ref}>
      <button
        className="settings-btn"
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        aria-label="Settings"
      >
        <GearIcon />
      </button>

      {open && (
        <div className="settings-dropdown">
          {/* Theme row */}
          <button
            className="settings-row"
            onClick={() => setThemeExpanded((v) => !v)}
          >
            <span className="settings-row-label">Theme</span>
            <span className="settings-row-value">{activeThemeLabel}</span>
            <span className="settings-row-chevron">{themeExpanded ? "▾" : "▸"}</span>
          </button>

          {themeExpanded && (
            <div className="theme-list">
              {THEMES.map((t: ThemeOption) => (
                <button
                  key={t.id}
                  className={`theme-option ${theme === t.id ? "theme-option--active" : ""}`}
                  onClick={() => { onThemeChange(t.id); setThemeExpanded(false); setOpen(false); }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Text Size row */}
          <button
            className="settings-row"
            onClick={() => setFontExpanded((v) => !v)}
          >
            <span className="settings-row-label">Text Size</span>
            <span className="settings-row-value">{activeFontLabel}</span>
            <span className="settings-row-chevron">{fontExpanded ? "▾" : "▸"}</span>
          </button>

          {fontExpanded && (
            <div className="theme-list">
              {FONT_SIZES.map((f) => (
                <button
                  key={f.value}
                  className={`theme-option ${fontSize === f.value ? "theme-option--active" : ""}`}
                  onClick={() => { onFontSizeChange(f.value); setFontExpanded(false); setOpen(false); }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Error Hints */}
          <button
            className="settings-row"
            onClick={() => { setOpen(false); onOpenHints(); }}
          >
            <span className="settings-row-label">Error Hints…</span>
          </button>

          {/* AI (Max) row */}
          <button
            className="settings-row"
            onClick={() => setAiExpanded((v) => !v)}
          >
            <span className="settings-row-label">AI (Max)</span>
            <span className="settings-row-value">
              {provider === "vertex" ? "Vertex AI" : apiKey ? "Key set ✓" : "No key"}
            </span>
            <span className="settings-row-chevron">{aiExpanded ? "▾" : "▸"}</span>
          </button>

          {aiExpanded && (
            <div className="ai-key-section">
              {/* Provider toggle */}
              <div className="ai-provider-toggle">
                <button
                  className={`ai-provider-btn ${provider === "anthropic" ? "ai-provider-btn--active" : ""}`}
                  onClick={() => {
                    setProvider("anthropic");
                    localStorage.setItem("dw-max-provider", "anthropic");
                    setTestStatus("idle");
                    window.dispatchEvent(new CustomEvent("dw-api-key-changed"));
                  }}
                >Anthropic API</button>
                <button
                  className={`ai-provider-btn ${provider === "vertex" ? "ai-provider-btn--active" : ""}`}
                  onClick={() => {
                    setProvider("vertex");
                    localStorage.setItem("dw-max-provider", "vertex");
                    setTestStatus("idle");
                    window.dispatchEvent(new CustomEvent("dw-api-key-changed"));
                  }}
                >Google Vertex</button>
              </div>

              {provider === "anthropic" && (
                <>
                  <label className="ai-key-label">Anthropic API Key</label>
                  <input
                    type="password"
                    className="ai-key-input"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      localStorage.setItem("dw-max-api-key", e.target.value);
                      window.dispatchEvent(new CustomEvent("dw-api-key-changed"));
                    }}
                    placeholder="sk-ant-..."
                    autoComplete="off"
                    spellCheck={false}
                  />
                </>
              )}

              {provider === "vertex" && (
                <>
                  <label className="ai-key-label">Region <span className="ai-key-hint">(default: us-east5)</span></label>
                  <input
                    type="text"
                    className="ai-key-input"
                    value={vertexRegion}
                    onChange={(e) => {
                      setVertexRegion(e.target.value);
                      localStorage.setItem("dw-max-vertex-region", e.target.value);
                    }}
                    placeholder="us-east5"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="ai-vertex-note">
                    Project auto-detected from <code>gcloud</code>. Ensure ADC is configured.
                  </p>
                </>
              )}

              {/* Test connection */}
              <button
                className="ai-test-btn"
                disabled={testStatus === "testing" || (provider === "anthropic" && !apiKey)}
                onClick={async () => {
                  setTestStatus("testing");
                  setTestMsg("");
                  try {
                    const res = await maxTestConnection({
                      provider,
                      api_key: apiKey || undefined,
                      vertex_region: vertexRegion || undefined,
                    });
                    if (res.success) {
                      setTestStatus("ok");
                      setTestMsg(res.project_id ? `Connected (project: ${res.project_id})` : "Connected ✓");
                    } else {
                      setTestStatus("err");
                      setTestMsg(res.error ?? "Unknown error");
                    }
                  } catch (e) {
                    setTestStatus("err");
                    setTestMsg(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                {testStatus === "testing" ? "Testing…" : "Test Connection"}
              </button>
              {testStatus === "ok"  && <p className="ai-test-ok">{testMsg}</p>}
              {testStatus === "err" && <p className="ai-test-err">{testMsg}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
