# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for DW Workbench backend
# Run from the backend/ directory:
#   pyinstaller server.spec --clean

block_cipher = None

a = Analysis(
    ["server.py"],
    pathex=["."],
    binaries=[],
    datas=[
        # Bundle the built frontend into static/ inside the executable directory
        ("../frontend/dist", "static"),
    ],
    hiddenimports=[
        # uvicorn internals (not auto-detected via string-based run)
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "uvicorn.main",
        # anyio / sniffio (uvicorn async backend)
        "anyio",
        "anyio._backends._asyncio",
        "sniffio",
        # fastapi / starlette internals
        "fastapi",
        "starlette",
        "starlette.staticfiles",
        "starlette.routing",
        "starlette.middleware.cors",
        # form parsing (python-multipart installs as multipart)
        "multipart",
        "multipart.multipart",
        # email (starlette dependency)
        "email",
        "email.mime",
        "email.mime.multipart",
        # h11 (HTTP parser)
        "h11",
        # app modules
        "app",
        "app.main",
        "app.api.execute_dw",
        "app.api.execute_flow",
        "app.api.debug_flow",
        "app.models.schemas",
        "app.services.dw_runner",
        "app.services.flow_runner",
        "app.services.debug_runner",
        "app.api.max_chat",
        "app.services.max_runner",
        # anthropic SDK
        "anthropic",
        "anthropic._legacy_response",
        "anthropic._models",
        "anthropic._streaming",
        "anthropic.resources",
        "anthropic.resources.messages",
        "httpx",
        "httpcore",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,          # no console window flashing on startup
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="server",
)
