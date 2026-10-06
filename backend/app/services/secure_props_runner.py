import json
import os
import platform
import re
import subprocess
from pathlib import Path

ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*m")

# Allowed values — mirror the MuleSoft Secure Properties Tool.
ALGORITHMS = {"AES", "Blowfish", "DES", "DESede", "RC2", "RCA"}
MODES = {"CBC", "CFB", "ECB", "OFB"}


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


def _jar_path(cfg: dict) -> str:
    return (
        os.environ.get("SECURE_PROPS_JAR")
        or cfg.get("jar_path")
        or "secure-properties-tool.jar"
    )


def _env_names(cfg: dict) -> list[str]:
    """Environment names, ignoring any `_`-prefixed keys (e.g. `_comment`)."""
    return [k for k in cfg.get("keys", {}).keys() if not k.startswith("_")]


def list_environments() -> list[str]:
    """Return just the environment names — never the key values."""
    return _env_names(load_config())


def environments_payload() -> dict:
    """Environment names plus any config-loading error (e.g. bad JSON)."""
    cfg = load_config()
    if cfg.get("_error"):
        return {"environments": [], "error": cfg["_error"]}
    return {"environments": _env_names(cfg), "error": ""}


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

    keys = cfg.get("keys", {})
    if not keys:
        return {
            "success": False,
            "output": "",
            "error": (
                "No keys configured. Create a local secure_props_config.json "
                "(copy secure_props_config.example.json) with your per-environment keys."
            ),
        }

    key = keys.get(environment)
    if not key:
        return {"success": False, "output": "", "error": f"No key configured for environment '{environment}'."}

    value = (value or "").strip()
    if not value:
        return {"success": False, "output": "", "error": "No value provided."}

    # On decrypt, strip the ![ ... ] wrapper if the user pasted it.
    if operation == "decrypt" and value.startswith("![") and value.endswith("]"):
        value = value[2:-1]

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
        return {"success": False, "output": "", "error": stderr or f"Exit code {result.returncode}"}

    # On encrypt, wrap in the ![ ... ] marker, ready to drop into YAML/properties.
    output = f"![{stdout}]" if operation == "encrypt" else stdout
    return {"success": True, "output": output, "error": ""}
