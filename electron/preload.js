"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  send:               (channel, data) => ipcRenderer.send(channel, data),
  on:                 (channel, cb)   => ipcRenderer.on(channel, (_event, data) => cb(data)),
  removeAllListeners: (channel)       => ipcRenderer.removeAllListeners(channel),
});
