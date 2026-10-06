import { useState, useEffect, useCallback } from "react";
import { secureProperties, getSecurePropsEnvs, type SecurePropsResponse } from "../services/api";
import CopyButton from "./CopyButton";
import "./SecurePropertiesPanel.css";

const ALGORITHMS = ["AES", "Blowfish", "DES", "DESede", "RC2", "RCA"];
const MODES = ["CBC", "CFB", "ECB", "OFB"];

type Operation = "encrypt" | "decrypt";

export default function SecurePropertiesPanel() {
  const [operation, setOperation] = useState<Operation>("encrypt");
  const [envs, setEnvs] = useState<string[]>([]);
  const [environment, setEnvironment] = useState("");
  const [algorithm, setAlgorithm] = useState("AES");
  const [mode, setMode] = useState("CBC");
  const [useRandomIv, setUseRandomIv] = useState(true);
  const [value, setValue] = useState("");
  const [result, setResult] = useState<SecurePropsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getSecurePropsEnvs()
      .then(({ environments, error }) => {
        setEnvs(environments);
        if (error) setLoadError(error);
        else if (environments.length) setEnvironment(environments[0]);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  // ECB has no IV, so random-IV doesn't apply.
  const ecb = mode === "ECB";
  const effectiveRandomIv = ecb ? false : useRandomIv;

  const run = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await secureProperties({
        operation,
        environment,
        algorithm,
        mode,
        use_random_iv: effectiveRandomIv,
        value,
      });
      setResult(res);
    } catch (e) {
      setResult({ success: false, output: "", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [operation, environment, algorithm, mode, effectiveRandomIv, value]);

  const noEnvs = !loadError && envs.length === 0;
  const canRun = !busy && !!environment && value.trim().length > 0;

  return (
    <div className="secure-props">
      <div className="secure-props__inner">
        <p className="secure-props__intro">
          Encrypt or decrypt MuleSoft secure property values locally. Keys are read from a
          local config on this machine and never leave it — pick an environment and the matching
          key is used server-side.
        </p>

        <div className="secure-props__form">
          {loadError && (
            <div className="sp-banner">
              Couldn't reach the backend to load environments: {loadError}
            </div>
          )}
          {noEnvs && (
            <div className="sp-banner">
              No environments configured. Copy <code>secure_props_config.example.json</code> to{" "}
              <code>secure_props_config.json</code> in the backend folder and add your per-environment keys.
            </div>
          )}

          {/* Operation */}
          <div className="config-field" style={{ marginBottom: 0 }}>
            <span className="config-field__label">Operation</span>
            <div className="sp-seg-group">
              <button
                className={`sp-seg ${operation === "encrypt" ? "sp-seg--active" : ""}`}
                onClick={() => setOperation("encrypt")}
              >
                Encrypt
              </button>
              <button
                className={`sp-seg ${operation === "decrypt" ? "sp-seg--active" : ""}`}
                onClick={() => setOperation("decrypt")}
              >
                Decrypt
              </button>
            </div>
          </div>

          {/* Environment / Algorithm / Mode */}
          <div className="sp-row">
            <label className="config-field">
              <span className="config-field__label">Environment</span>
              <select
                className="config-field__select"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                disabled={envs.length === 0}
              >
                {envs.length === 0 && <option value="">— none —</option>}
                {envs.map((env) => (
                  <option key={env} value={env}>{env}</option>
                ))}
              </select>
            </label>

            <label className="config-field">
              <span className="config-field__label">Algorithm</span>
              <select
                className="config-field__select"
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value)}
              >
                {ALGORITHMS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>

            <label className="config-field">
              <span className="config-field__label">Mode</span>
              <select
                className="config-field__select"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Random IV */}
          <label className={`sp-check ${ecb ? "sp-check--disabled" : ""}`}>
            <input
              type="checkbox"
              checked={effectiveRandomIv}
              disabled={ecb}
              onChange={(e) => setUseRandomIv(e.target.checked)}
            />
            Use random IV{ecb ? " (not applicable to ECB)" : ""}
          </label>

          {/* Input */}
          <div className="config-field" style={{ marginBottom: 0 }}>
            <span className="config-field__label">
              {operation === "encrypt" ? "Cleartext value" : "Encrypted value ( ![...] )"}
            </span>
            <textarea
              className="sp-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                operation === "encrypt"
                  ? "Value to encrypt…"
                  : "![encrypted value] — brackets optional"
              }
            />
          </div>

          <button className="sp-run" onClick={run} disabled={!canRun}>
            {busy ? "Running…" : "Run"}
          </button>

          {/* Result */}
          {result && (
            <div className={`sp-result ${result.success ? "" : "sp-result--error"}`}>
              <div className="sp-result__head">
                <span>{result.success ? "Result" : "Error"}</span>
                {result.success && <CopyButton getText={() => result.output} />}
              </div>
              <div className="sp-result__body">
                {result.success ? result.output : result.error}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
