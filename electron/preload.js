"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Every `files.*` call takes path segments and the main process joins them, so the
// renderer never has to know the platform separator. Paths returned from
// pickDirectory / mkdirp / writeText are absolute and safe to store.
const files = {
  /** Native folder picker. Resolves to an absolute path, or null if cancelled. */
  pickDirectory: (opts)               => ipcRenderer.invoke("files:pick-directory", opts ?? {}),
  /** Documents\DW Workbench, created if needed — the default home for projects. */
  defaultWorkspace: ()                => ipcRenderer.invoke("files:default-workspace"),
  /** Join segments into an absolute path without touching the filesystem. */
  resolve:       (...segments)        => ipcRenderer.invoke("files:resolve", segments),
  exists:        (...segments)        => ipcRenderer.invoke("files:exists", segments),
  /** File contents, or null if the file does not exist. */
  readText:      (...segments)        => ipcRenderer.invoke("files:read-text", segments),
  /** Writes the file (creating parent directories) and returns its absolute path. */
  writeText:     (segments, content)  => ipcRenderer.invoke("files:write-text", segments, content),
  /** Creates the directory (recursively) and returns its absolute path. */
  mkdirp:        (...segments)        => ipcRenderer.invoke("files:mkdirp", segments),
  /** Entry names directly inside a directory; [] if it does not exist. */
  list:          (...segments)        => ipcRenderer.invoke("files:list", segments),
  remove:        (...segments)        => ipcRenderer.invoke("files:remove", segments),
};

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron:         true,
  send:               (channel, data) => ipcRenderer.send(channel, data),
  on:                 (channel, cb)   => ipcRenderer.on(channel, (_event, data) => cb(data)),
  removeAllListeners: (channel)       => ipcRenderer.removeAllListeners(channel),
  invoke:             (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  files,
});
