import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.execute_dw import router as execute_dw_router
from app.api.execute_flow import router as execute_flow_router
from app.api.debug_flow import router as debug_router

app = FastAPI(title="DW Workbench API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # 5173 = Vite dev server, 8000 = production (same origin, but be explicit)
    allow_origins=["http://localhost:5173", "http://localhost:8000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(execute_dw_router)
app.include_router(execute_flow_router)
app.include_router(debug_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# ── Serve frontend static files (production) ──────────────────────────────────
# Mounted last so API routes always take priority.
# server.py sets STATIC_DIR before this module is imported.
_static_dir = os.environ.get("STATIC_DIR")
if _static_dir and os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
