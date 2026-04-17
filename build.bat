@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  DW Workbench — Full Build
echo ============================================================
echo.

:: ── Step 0: DW CLI ────────────────────────────────────────────────────────────
echo [0/4] Fetching DW CLI (if not already present)...
if not exist "electron\dw-cli\bin\dw.exe" (
    set DW_CLI_URL=https://github.com/mulesoft/data-weave-cli/releases/download/v1.0.36/dw-1.0.36-Windows
    set DW_CLI_ZIP=%TEMP%\dw-cli.zip
    echo       Downloading v1.0.36...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/mulesoft/data-weave-cli/releases/download/v1.0.36/dw-1.0.36-Windows' -OutFile '%TEMP%\dw-cli.zip'"
    if errorlevel 1 (
        echo ERROR: Failed to download DW CLI.
        exit /b 1
    )
    echo       Extracting...
    powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\dw-cli.zip' -DestinationPath 'electron\dw-cli' -Force"
    if errorlevel 1 (
        echo ERROR: Failed to extract DW CLI.
        exit /b 1
    )
    echo       Done: electron\dw-cli\bin\dw.exe
) else (
    echo       Already present, skipping download.
)
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
