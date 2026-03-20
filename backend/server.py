"""
Entry point for both development and the PyInstaller-bundled executable.

Run in dev:
    python server.py

Run via PyInstaller build:
    dist/server/server.exe
"""
import sys
import os

# ── Resolve static-files directory ───────────────────────────────────────────
# Must be set BEFORE app/main.py is imported so the mount is activated.
if getattr(sys, "frozen", False):
    # Running inside a PyInstaller bundle — static/ was copied next to the exe
    os.environ["STATIC_DIR"] = os.path.join(sys._MEIPASS, "static")
else:
    # Development — use the Vite build output if it exists
    dev_static = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
    )
    if os.path.isdir(dev_static):
        os.environ.setdefault("STATIC_DIR", dev_static)

import uvicorn
from app.main import app  # explicit import so PyInstaller detects all deps

if __name__ == "__main__":
    port = int(os.environ.get("DW_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
