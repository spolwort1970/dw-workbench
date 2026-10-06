import json
import os
import platform
import re
import subprocess
from pathlib import Path

ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*m")

# Allowed values — mirror the MuleSoft Secure Properties Tool.
ALGORITHMS = {"AES", "Blowfish", "DES", "DESede", "RC2"}

# Key lengths the JAR accepts, for turning its bare "Wrong key size" into a hint.
KEY_SIZE_HINTS = {
    "AES": "16, 24, or 32 characters",
    "DES": "8 characters",
    "DESede": "24 characters",
}
MODES = {"CBC", "CFB", "ECB", "OFB"}

# Built-in environment so the tab works with no config at all. Its key ships in
# this (public) repo, so anything encrypted with it is readable by anyone — it is
# for trying the tool, never for real secrets.
SAMPLE_ENV = "Sample (test key)"
SAMPLE_KEY = "DWWorkbenchTest1"            # 16 chars: AES, Blowfish, RC2
SAMPLE_KEYS_BY_ALGORITHM = {
    "DES": "DWWBTest",                      # DES needs exactly 8
    "DESede": "DWWorkbenchSampleKey2026",   # DESede needs 24
}

# Checked when neither SECURE_PROPS_JAR nor the config's jar_path is set.
JAR_SEARCH_DIRS = [Path("C:/Tools"), Path("C:/Mule_Secure_Props")]


def _config_path() -> Path:
    """
    Location of the local keys/JAR config. Kept OUT of source control.
    Resolution order:
      1. SECURE_PROPS_CONFIG env var (set by Electron in the packaged app)
      2. backend/secure_props_config.json (dev default; gitignored)
    """
    env = os.environ.get("SECURE_PROPS_CONFIG")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "secure_props_config.json"


def load_config() -> dict:
    path = _config_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as e:
        return {"_error": f"Config file is not valid JSON: {e}"}


def _jar_path(cfg: dict) -> str | None:
    """The configured JAR, else the first secure-properties-tool*.jar in a known folder."""
    explicit = os.environ.get("SECURE_PROPS_JAR") or cfg.get("jar_path")
    if explicit:
        return explicit
    for folder in JAR_SEARCH_DIRS:
        try:
            found = sorted(folder.glob("secure-properties-tool*.jar"))
        except OSError:
            continue
        if found:
            return str(found[-1])
    return None


def _jar_problem(cfg: dict) -> str:
    """Why the JAR can't be used, or "" if it looks fine."""
    jar = _jar_path(cfg)
    if not jar:
        dirs = " or ".join(str(d) for d in JAR_SEARCH_DIRS)
        return (
            f"MuleSoft Secure Properties JAR not found. Put secure-properties-tool-j17.jar in {dirs}, "
            "or set jar_path in secure_props_config.json."
        )
    if not Path(jar).exists():
        return f"MuleSoft Secure Properties JAR not found at {jar}. Check jar_path in secure_props_config.json."
    return ""


def _keys(cfg: dict) -> dict:
    """Configured keys plus the built-in sample, ignoring `_`-prefixed entries (e.g. `_comment`)."""
    keys = {k: v for k, v in cfg.get("keys", {}).items() if not k.startswith("_")}
    keys.setdefault(SAMPLE_ENV, SAMPLE_KEY)
    return keys


def list_environments() -> list[str]:
    """Return just the environment names — never the key values."""
    return list(_keys(load_config()))


def environments_payload() -> dict:
    """Environment names, plus any problem with the config or the JAR."""
    cfg = load_config()
    if cfg.get("_error"):
        return {"environments": [SAMPLE_ENV], "sample_env": SAMPLE_ENV, "error": cfg["_error"]}
    return {"environments": list(_keys(cfg)), "sample_env": SAMPLE_ENV, "error": _jar_problem(cfg)}


def run_secure_props(
    operation: str,
    environment: str,
    algorithm: str,
    mode: str,
    use_random_iv: bool,
    value: str,
) -> dict:
    operation = (operation or "").strip().lower()
    if operation not in ("encrypt", "decrypt"):
        return {"success": False, "output": "", "error": "Operation must be 'encrypt' or 'decrypt'."}
    if algorithm not in ALGORITHMS:
        return {"success": False, "output": "", "error": f"Unsupported algorithm '{algorithm}'."}
    if mode not in MODES:
        return {"success": False, "output": "", "error": f"Unsupported mode '{mode}'."}

    cfg = load_config()
    if cfg.get("_error"):
        return {"success": False, "output": "", "error": cfg["_error"]}

    key = _keys(cfg).get(environment)
    if environment == SAMPLE_ENV and environment not in cfg.get("keys", {}):
        key = SAMPLE_KEYS_BY_ALGORITHM.get(algorithm, SAMPLE_KEY)
    if not key:
        return {"success": False, "output": "", "error": f"No key configured for environment '{environment}'."}

    value = (value or "").strip()
    if not value:
        return {"success": False, "output": "", "error": "No value provided."}

    # On decrypt, strip the ![ ... ] wrapper if the user pasted it.
    if operation == "decrypt" and value.startswith("![") and value.endswith("]"):
        value = value[2:-1]

    jar_problem = _jar_problem(cfg)
    if jar_problem:
        return {"success": False, "output": "", "error": jar_problem}
    jar = _jar_path(cfg)

    cmd = [
        "java", "-cp", jar,
        "com.mulesoft.tools.SecurePropertiesTool",
        "string", operation, algorithm, mode, key, value,
    ]
    if use_random_iv:
        cmd.append("--use-random-iv")

    # Prevent a console window flashing on Windows (same approach as dw_runner).
    extra = {}
    if platform.system() == "Windows":
        extra["creationflags"] = subprocess.CREATE_NO_WINDOW

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, **extra)
    except FileNotFoundError:
        return {
            "success": False,
            "output": "",
            "error": (
                f"Java or the JAR was not found. Ensure 'java' is on PATH and the JAR path is correct "
                f"(looked for: {jar})."
            ),
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "output": "", "error": "Secure properties tool timed out after 30 seconds."}

    def clean(s: str) -> str:
        return ANSI_ESCAPE.sub("", s or "").strip()

    stdout = clean(result.stdout)
    stderr = clean(result.stderr)

    if result.returncode != 0 or not stdout:
        error = stderr or stdout or f"Exit code {result.returncode}"
        lowered = error.lower()
        if ("wrong key size" in lowered or "key length" in lowered) and algorithm in KEY_SIZE_HINTS:
            error = f"Wrong key size: {algorithm} needs a key of {KEY_SIZE_HINTS[algorithm]}."
        return {"success": False, "output": "", "error": error}

    # On encrypt, wrap in the ![ ... ] marker, ready to drop into YAML/properties.
    output = f"![{stdout}]" if operation == "encrypt" else stdout
    return {"success": True, "output": output, "error": ""}
