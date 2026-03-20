"use strict";

const { app, BrowserWindow, dialog, Menu } = require("electron");
const { spawn, execSync }             = require("child_process");
const path   = require("path");
const fs     = require("fs");
const http   = require("http");
const https  = require("https");
const os     = require("os");

// ── Constants ─────────────────────────────────────────────────────────────────

const PORT         = 8000;
const CONFIG_FILE  = path.join(app.getPath("userData"), "config.json");
const DW_CLI_DIR   = path.join(app.getPath("userData"), "dw-cli");

// GitHub releases API for the DW CLI
const DW_RELEASES_API =
  "https://api.github.com/repos/mulesoft-labs/data-weave-cli/releases/latest";

// ── Config persistence ────────────────────────────────────────────────────────

function loadConfig() {
  try   { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
  catch { return {}; }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ── DW CLI detection ──────────────────────────────────────────────────────────

/** Return the DW CLI path if it's already available, otherwise null. */
function findExistingDwCli() {
  // 1. Previously downloaded path saved in config
  const cfg = loadConfig();
  if (cfg.dwCliPath && fs.existsSync(cfg.dwCliPath)) return cfg.dwCliPath;

  // 2. Check system PATH
  try {
    const where = execSync("where dw", { stdio: "pipe" }).toString().trim().split("\n")[0].trim();
    if (where && fs.existsSync(where)) return where;
  } catch { /* not on PATH */ }

  return null;
}

/** Walk a directory tree and return the first file matching `name`. */
function findFileRecursive(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

/** Download a URL (following redirects) and save to `destFile`. */
function downloadFile(url, destFile, onProgress) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      const mod = u.startsWith("https") ? https : http;
      mod.get(u, { headers: { "User-Agent": "dw-workbench" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        const total   = parseInt(res.headers["content-length"] || "0", 10);
        let   received = 0;
        const out = fs.createWriteStream(destFile);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (onProgress && total > 0) onProgress(received, total);
        });
        res.pipe(out);
        out.on("finish", resolve);
        out.on("error",  reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

/** Fetch the latest DW CLI release asset URL for Windows from GitHub. */
function fetchWindowsAssetUrl() {
  return new Promise((resolve, reject) => {
    https.get(
      DW_RELEASES_API,
      { headers: { "User-Agent": "dw-workbench", "Accept": "application/vnd.github.v3+json" } },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            const release = JSON.parse(body);
            // Look for a Windows zip asset
            const asset = (release.assets || []).find(
              (a) =>
                /windows/i.test(a.name) &&
                a.name.endsWith(".zip")
            );
            if (!asset) reject(new Error("No Windows release asset found."));
            else resolve({ url: asset.browser_download_url, version: release.tag_name });
          } catch (e) {
            reject(e);
          }
        });
      }
    ).on("error", reject);
  });
}

/**
 * Download, extract, and register the DW CLI.
 * Shows a simple dialog to inform the user.
 */
async function downloadDwCli(loadingWin) {
  setLoadingMessage(loadingWin, "Downloading DW CLI (first run)…");

  let assetUrl, version;
  try {
    ({ url: assetUrl, version } = await fetchWindowsAssetUrl());
  } catch (e) {
    dialog.showErrorBox(
      "DW CLI Download Failed",
      `Could not fetch the DW CLI release info:\n${e.message}\n\n` +
      "Install the DW CLI manually and restart, or ensure internet access."
    );
    app.quit();
    return null;
  }

  const zipPath = path.join(os.tmpdir(), "dw-cli.zip");
  try {
    await downloadFile(assetUrl, zipPath, (recv, total) => {
      const pct = Math.round((recv / total) * 100);
      setLoadingMessage(loadingWin, `Downloading DW CLI ${version}… ${pct}%`);
    });
  } catch (e) {
    dialog.showErrorBox("DW CLI Download Failed", `Download error:\n${e.message}`);
    app.quit();
    return null;
  }

  setLoadingMessage(loadingWin, "Extracting DW CLI…");
  fs.mkdirSync(DW_CLI_DIR, { recursive: true });
  try {
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${DW_CLI_DIR}' -Force"`,
      { stdio: "ignore" }
    );
  } catch (e) {
    dialog.showErrorBox("DW CLI Extract Failed", `Extraction error:\n${e.message}`);
    app.quit();
    return null;
  }

  // Find dw.bat in the extracted tree
  const dwBat = findFileRecursive(DW_CLI_DIR, "dw.bat") || findFileRecursive(DW_CLI_DIR, "dw");
  if (!dwBat) {
    dialog.showErrorBox(
      "DW CLI Not Found",
      "Extracted the archive but could not locate dw.bat.\n" +
      `Check ${DW_CLI_DIR} and set DW_CLI manually.`
    );
    app.quit();
    return null;
  }

  const cfg = loadConfig();
  cfg.dwCliPath = dwBat;
  saveConfig(cfg);
  return dwBat;
}

// ── Loading window ────────────────────────────────────────────────────────────

function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 180,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: "#1e1e1e",
    webPreferences: { contextIsolation: true },
  });

  win.loadURL(
    `data:text/html,<!DOCTYPE html>
<html><head><style>
  body{margin:0;background:#1e1e1e;color:#ccc;font-family:sans-serif;
       display:flex;align-items:center;justify-content:center;height:100vh;}
  h2{font-size:14px;font-weight:400;margin:0;}
</style></head>
<body><h2 id="msg">Starting DW Workbench…</h2></body></html>`
  );

  win.once("ready-to-show", () => win.show());
  return win;
}

function setLoadingMessage(win, msg) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(
    `document.getElementById('msg').textContent = ${JSON.stringify(msg)};`
  ).catch(() => {});
}

// ── Backend process ───────────────────────────────────────────────────────────

let backendProcess = null;

function startBackend(dwCliPath) {
  if (!app.isPackaged) return; // dev: backend runs independently

  // @electron/packager copies --extra-resource as resources/<dirname>
  // The source dir is backend/dist/server → placed at resources/server/
  const exePath = path.join(
    process.resourcesPath, "server", "server.exe"
  );

  if (!fs.existsSync(exePath)) {
    dialog.showErrorBox(
      "Backend Not Found",
      `Could not locate:\n${exePath}\n\nRe-install DW Workbench.`
    );
    app.quit();
    return;
  }

  const env = {
    ...process.env,
    DW_PORT: String(PORT),
    ...(dwCliPath ? { DW_CLI: dwCliPath } : {}),
  };

  backendProcess = spawn(exePath, [], {
    env,
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });

  backendProcess.on("error", (err) =>
    dialog.showErrorBox("Backend Error", `Backend failed to start:\n${err.message}`)
  );
}

function waitForBackend(retries = 40) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://localhost:${PORT}/health`, (res) => {
        if (res.statusCode === 200) resolve();
        else retry();
        res.resume();
      });
      req.on("error", retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (++attempts >= retries) reject(new Error("Backend did not become ready."));
      else setTimeout(check, 500);
    };
    check();
  });
}

// ── Main window ───────────────────────────────────────────────────────────────

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "DW Workbench",
    show: false,
    backgroundColor: "#1e1e1e",
    webPreferences: { contextIsolation: true },
  });

  win.loadURL(`http://localhost:${PORT}`);
  win.once("ready-to-show", () => win.show());
  return win;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const loadingWin = createLoadingWindow();

  // 1. Resolve DW CLI
  let dwCliPath = findExistingDwCli();
  if (!dwCliPath) {
    dwCliPath = await downloadDwCli(loadingWin);
    if (!dwCliPath) return; // downloadDwCli called app.quit() on failure
  }

  // 2. Start backend
  setLoadingMessage(loadingWin, "Starting backend…");
  startBackend(dwCliPath);

  // 3. Wait for backend health
  try {
    await waitForBackend();
  } catch (e) {
    dialog.showErrorBox(
      "Backend Startup Timeout",
      "The backend server did not start in time.\n" +
      "Try restarting DW Workbench."
    );
    if (backendProcess) backendProcess.kill();
    app.quit();
    return;
  }

  // 4. Open main window, close loading screen
  createMainWindow();
  if (!loadingWin.isDestroyed()) loadingWin.close();

  // Suppress the default Electron menu bar
  Menu.setApplicationMenu(null);
});

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
});
