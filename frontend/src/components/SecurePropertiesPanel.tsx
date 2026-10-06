import { useState, useEffect, useCallback, useRef } from "react";
import { secureProperties, getSecurePropsEnvs, type SecurePropsResponse } from "../services/api";
import CopyButton from "./CopyButton";
import "./SecurePropertiesPanel.css";

const ALGORITHMS = ["AES", "Blowfish", "DES", "DESede", "RC2"];
const MODES = ["CBC", "CFB", "ECB", "OFB"];

type Operation = "encrypt" | "decrypt";

const CRED_LENGTHS = [16, 24, 32] as const;
type CredLength = (typeof CRED_LENGTHS)[number];

// Letters and digits only, so the values drop into YAML/properties without quoting.
const CRED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A random string from CRED_CHARS, using the browser's cryptographic RNG. */
function randomCredential(length: number): string {
  // Bytes at or above this limit are discarded so every character is equally likely.
  const limit = 256 - (256 % CRED_CHARS.length);
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += CRED_CHARS[b % CRED_CHARS.length];
    }
  }
  return out;
}

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
  const [setupProblem, setSetupProblem] = useState("");
  const [sampleEnv, setSampleEnv] = useState("");
  const formTopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSecurePropsEnvs()
      .then(({ environments, sample_env, error }) => {
        setEnvs(environments);
        setSampleEnv(sample_env);
        setSetupProblem(error);
        if (environments.length) setEnvironment(environments[0]);
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

  const usingSample = !!sampleEnv && environment === sampleEnv;

  const encryptValue = useCallback((v: string) => {
    setOperation("encrypt");
    setValue(v);
    setResult(null);
    formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const canRun = !busy && !!environment && value.trim().length > 0;

  return (
    <div className="secure-props">
      <div className="secure-props__inner">
        <p className="secure-props__intro">
          Encrypt or decrypt MuleSoft secure property values locally. Keys are read from a
          local config on this machine and never leave it — pick an environment and the matching
          key is used server-side.
        </p>

        <div className="secure-props__form" ref={formTopRef}>
          {loadError && (
            <div className="sp-banner">
              Couldn't reach the backend to load environments: {loadError}
            </div>
          )}
          {setupProblem && <div className="sp-banner">{setupProblem}</div>}
          {usingSample && (
            <div className="sp-banner sp-banner--info">
              <strong>Sample key — for trying the tool only.</strong> This key ships with DW Workbench and is
              public, so anyone can decrypt values made with it. Never use it for real secrets. Add your own
              per-environment keys in <code>%APPDATA%\dw-workbench\secure_props_config.json</code>.
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

        <CredentialGenerator onEncrypt={encryptValue} />
      </div>
    </div>
  );
}

function CredentialGenerator({ onEncrypt }: { onEncrypt: (value: string) => void }) {
  const [length, setLength] = useState<CredLength>(32);
  const [creds, setCreds] = useState<{ id: string; secret: string } | null>(null);

  const generate = () => setCreds({ id: randomCredential(length), secret: randomCredential(length) });

  return (
    <div className="secure-props__form sp-gen">
      <div className="sp-gen__title">Client Credentials Generator</div>
      <p className="sp-gen__hint">
        Generate a random client ID and client secret (letters and digits). Nothing is stored or sent anywhere.
      </p>

      <div className="sp-row">
        <div className="config-field">
          <span className="config-field__label">Length</span>
          <div className="sp-seg-group">
            {CRED_LENGTHS.map((n) => (
              <button
                key={n}
                className={`sp-seg ${length === n ? "sp-seg--active" : ""}`}
                onClick={() => setLength(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button className="sp-run" onClick={generate}>
        {creds ? "Regenerate" : "Generate"}
      </button>

      {creds && (
        <>
          <div className="sp-result">
            <div className="sp-result__head">
              <span>Client ID</span>
              <CopyButton getText={() => creds.id} />
            </div>
            <div className="sp-result__body">{creds.id}</div>
          </div>
          <div className="sp-result">
            <div className="sp-result__head">
              <span>Client Secret</span>
              <div className="sp-result__actions">
                <button className="icon-btn" onClick={() => onEncrypt(creds.secret)} title="Load the secret into the encrypt form above">
                  <span>Encrypt secret</span>
                </button>
                <CopyButton getText={() => creds.secret} />
              </div>
            </div>
            <div className="sp-result__body">{creds.secret}</div>
          </div>
        </>
      )}
    </div>
  );
}
