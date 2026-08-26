"use strict";

// ── Native file system IPC ────────────────────────────────────────────────────
//
// Electron 31 does not usably implement the browser File System Access API. The
// binding exists — window.showDirectoryPicker is a function — but the picker UI it
// depends on lives in Chromium's //chrome layer, which Electron does not ship.
// Verified against the packaged app: the returned promise never settles. No dialog,
// no rejection, nothing for the caller to catch, however the call is wrapped. That
// is why File > Open Project appeared to do nothing and Save silently left the
// title at "Untitled".
//
// Projects are addressed by plain absolute paths instead, with every filesystem
// operation performed here in the main process. Renderer counterpart:
// frontend/src/services/nativeFs.ts, exposed by preload.js as electronAPI.files.

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs   = require("fs");

/** Join renderer-supplied segments into one absolute path. */
function resolveSegments(segments) {
  const parts = Array.isArray(segments)
    ? segments.filter((s) => typeof s === "string" && s.length > 0)
    : [];
  if (parts.length === 0) throw new Error("No path given.");
  const full = path.join(...parts);
  if (!path.isAbsolute(full)) throw new Error(`Not an absolute path: ${full}`);
  return full;
}

/**
 * @param {() => (Electron.BrowserWindow|null)} [getFallbackWindow]
 *   Window to parent the picker to when the sender has none.
 */
function registerFileIpc(getFallbackWindow) {
  ipcMain.handle("files:pick-directory", async (event, opts = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender)
      || (getFallbackWindow ? getFallbackWindow() : null);
    const options = {
      title:       opts.title || "Select Folder",
      buttonLabel: opts.buttonLabel || undefined,
      properties:  ["openDirectory", "createDirectory"],
    };
    // A defaultPath that no longer exists makes the Windows dialog fall back to a
    // useless location, so only pass one we can still see.
    if (opts.defaultPath && fs.existsSync(opts.defaultPath)) options.defaultPath = opts.defaultPath;

    const res = win && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  /**
   * Where projects live when the user has never chosen a folder: Documents\DW
   * Workbench, created on demand. Asking someone to pick a directory before they
   * can save their first project is friction for a question that has an obvious
   * default — "Select Projects Folder…" is there for anyone who wants to move it.
   */
  ipcMain.handle("files:default-workspace", () => {
    const dir = path.join(app.getPath("documents"), "DW Workbench");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  });

  ipcMain.handle("files:resolve", (_e, segments) => resolveSegments(segments));

  ipcMain.handle("files:exists", (_e, segments) => {
    try   { return fs.existsSync(resolveSegments(segments)); }
    catch { return false; }
  });

  ipcMain.handle("files:read-text", (_e, segments) => {
    const p = resolveSegments(segments);
    try {
      return fs.readFileSync(p, "utf8");
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "EISDIR") return null;   // caller treats as "absent"
      throw e;
    }
  });

  ipcMain.handle("files:write-text", (_e, segments, content) => {
    const p = resolveSegments(segments);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === "string" ? content : String(content ?? ""), "utf8");
    return p;
  });

  ipcMain.handle("files:mkdirp", (_e, segments) => {
    const p = resolveSegments(segments);
    fs.mkdirSync(p, { recursive: true });
    return p;
  });

  /** Names of the entries directly inside a directory; [] if it doesn't exist. */
  ipcMain.handle("files:list", (_e, segments) => {
    const p = resolveSegments(segments);
    try {
      return fs.readdirSync(p);
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "ENOTDIR") return [];
      throw e;
    }
  });

  ipcMain.handle("files:remove", (_e, segments) => {
    const p = resolveSegments(segments);
    fs.rmSync(p, { recursive: true, force: true });
    return true;
  });
}

module.exports = { registerFileIpc, resolveSegments };
