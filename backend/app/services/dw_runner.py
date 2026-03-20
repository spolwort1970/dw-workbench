import json
import re
import subprocess
import tempfile
import os
from pathlib import Path

ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*m")


DW_CLI = os.environ.get("DW_CLI", "dw")

MIME_EXTENSIONS: dict[str, str] = {
    "application/json":                     ".json",
    "text/csv":                             ".csv",
    "application/xml":                      ".xml",
    "application/x-ndjson":                 ".ndjson",
    "application/dw":                       ".dwl",
    "application/vnd.ms-excel":             ".xlsx",
    "text/plain":                           ".txt",
    "multipart/form-data":                  ".multipart",
    "application/yaml":                     ".yaml",
    "application/x-www-form-urlencoded":    ".urlencoded",
}


def run_dw(
    script: str,
    payload: object,
    input_mime_type: str,
    attributes: dict,
    vars_: dict,
) -> dict:
    ext = MIME_EXTENSIONS.get(input_mime_type, ".json")
    is_json = ext == ".json"

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        # Write script file
        script_file = tmp_path / "script.dwl"
        script_file.write_text(script, encoding="utf-8")

        # Write payload — JSON types get serialized, others written as-is
        payload_file = tmp_path / f"payload{ext}"
        if is_json:
            payload_file.write_text(
                json.dumps(payload, indent=2) if payload is not None else "null",
                encoding="utf-8",
            )
        else:
            payload_file.write_text(
                str(payload) if payload is not None else "",
                encoding="utf-8",
            )

        # Build command
        cmd = [DW_CLI, "run", "-s"]
        cmd += [f"-i=payload={payload_file}"]

        if attributes:
            attr_file = tmp_path / "attributes.json"
            attr_file.write_text(json.dumps(attributes, indent=2), encoding="utf-8")
            cmd += [f"-i=attributes={attr_file}"]

        if vars_:
            vars_file = tmp_path / "vars.json"
            vars_file.write_text(json.dumps(vars_, indent=2), encoding="utf-8")
            cmd += [f"-i=vars={vars_file}"]

        cmd += [f"-f={script_file}"]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except FileNotFoundError:
            return {
                "success": False,
                "output": None,
                "stdout": "",
                "stderr": "",
                "error": (
                    f"DW CLI not found. Ensure '{DW_CLI}' is on PATH "
                    "or set the DW_CLI environment variable."
                ),
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "output": None,
                "stdout": "",
                "stderr": "",
                "error": "DW CLI timed out after 30 seconds.",
            }

        def clean(s: str) -> str:
            lines = ANSI_ESCAPE.sub("", s).splitlines()
            lines = [l for l in lines if not l.startswith("WARNING:")]
            return "\n".join(lines).strip()

        stdout = clean(result.stdout)
        stderr = clean(result.stderr)
        success = result.returncode == 0

        return {
            "success": success,
            "output": stdout if success else None,
            "stdout": stdout,
            "stderr": stderr,
            "error": "" if success else (stderr or f"Exit code {result.returncode}"),
        }
