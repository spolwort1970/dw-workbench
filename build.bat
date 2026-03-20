@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  DW Workbench — Full Build
echo ============================================================
echo.

:: ── Step 1: Frontend ─────────────────────────────────────────────────────────
echo [1/4] Building frontend (Vite)...
cd frontend
call npm run build
if errorlevel 1 (
    echo.
    echo ERROR: Frontend build failed.
    exit /b 1
)
cd ..
echo       Done: frontend\dist\
echo.

:: ── Step 2: Backend (PyInstaller) ────────────────────────────────────────────
echo [2/4] Building backend (PyInstaller)...
cd backend

:: Install dev deps if pyinstaller isn't present
call .venv\Scripts\python -m pyinstaller --version >nul 2>&1
if errorlevel 1 (
    echo       Installing pyinstaller into .venv...
    call .venv\Scripts\pip install pyinstaller
)

call .venv\Scripts\python -m PyInstaller server.spec --clean --noconfirm
if errorlevel 1 (
    echo.
    echo ERROR: PyInstaller build failed.
    exit /b 1
)
cd ..
echo       Done: backend\dist\server\
echo.

:: ── Step 3: Electron packager ─────────────────────────────────────────────────
echo [3/4] Packaging with @electron/packager...
cd electron

call npm install --prefer-offline
if errorlevel 1 (
    echo.
    echo ERROR: npm install failed.
    exit /b 1
)

call npm run pack
if errorlevel 1 (
    echo.
    echo ERROR: electron-packager failed.
    exit /b 1
)

:: ── Step 4: Zip the output ────────────────────────────────────────────────────
echo.
echo [4/4] Creating distributable ZIP...
cd ..
powershell -NoProfile -Command "Compress-Archive -Path 'electron\dist\DW Workbench-win32-x64' -DestinationPath 'electron\dist\DW-Workbench-win32-x64.zip' -Force"
if errorlevel 1 (
    echo       Warning: ZIP creation failed. Folder output still usable.
)

echo.
echo ============================================================
echo  Build complete!
echo  App folder : electron\dist\DW Workbench-win32-x64\
echo  ZIP        : electron\dist\DW-Workbench-win32-x64.zip
echo ============================================================
