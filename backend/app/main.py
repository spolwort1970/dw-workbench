import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.execute_dw import router as execute_dw_router
from app.api.execute_flow import router as execute_flow_router
from app.api.debug_flow import router as debug_router
from app.api.max_chat import router as max_router

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
app.include_router(max_router)


@app.get("/health")
def health() -> dict:
    # The nonce identifies the process the desktop app itself launched. A previous
    # run's server left listening on this port answers /health perfectly well, and
    # the app would attach to it and serve that build's frontend — so an upgraded
    # app kept showing old code. main.js compares this value with what it passed.
    return {"status": "ok", "nonce": os.environ.get("DW_NONCE", "")}


# ── Serve frontend static files (production) ──────────────────────────────────
# Mounted last so API routes always take priority.
# server.py sets STATIC_DIR before this module is imported.


class _NoCacheHtmlStatic(StaticFiles):
    """
    StaticFiles that forbids caching of index.html.

    The app upgrades in place: a new build ships new content-hashed asset files but
    reuses the same URL, http://localhost:8000/. Chromium happily served index.html
    from its disk cache across upgrades, so an updated app kept booting the previous
    build's bundle — new code shipped, old code ran, and fixes appeared to do
    nothing. Hashed assets under /assets/ are immutable by construction and stay
    cacheable; only the entry document must always be revalidated.
    """

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        media_type = response.headers.get("content-type", "")
        if media_type.startswith("text/html"):
            response.headers["Cache-Control"] = "no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


_static_dir = os.environ.get("STATIC_DIR")
if _static_dir and os.path.isdir(_static_dir):
    app.mount("/", _NoCacheHtmlStatic(directory=_static_dir, html=True), name="static")
