// Thin typed wrapper over the `files:*` IPC bridge exposed by electron/preload.js.
//
// This replaces the browser File System Access API, which Electron 31 exposes but
// does not usably implement: showDirectoryPicker() is a function, yet the promise it
// returns never settles — no picker, no rejection, nothing to catch. Projects are now
// identified by absolute paths and all I/O happens in the main process.

export interface NativeFs {
  /** Native folder picker. Absolute path, or null if the user cancelled. */
  pickDirectory(opts?: { title?: string; defaultPath?: string | null; buttonLabel?: string }): Promise<string | null>;
  /** Documents\DW Workbench, created if needed — the default home for projects. */
  defaultWorkspace(): Promise<string>;
  /** Join segments into an absolute path without touching the filesystem. */
  resolve(...segments: string[]): Promise<string>;
  exists(...segments: string[]): Promise<boolean>;
  /** File contents, or null if the file does not exist. */
  readText(...segments: string[]): Promise<string | null>;
  /** Writes the file (creating parent directories) and returns its absolute path. */
  writeText(segments: string[], content: string): Promise<string>;
  /** Creates the directory recursively and returns its absolute path. */
  mkdirp(...segments: string[]): Promise<string>;
  /** Entry names directly inside a directory; [] if it does not exist. */
  list(...segments: string[]): Promise<string[]>;
  remove(...segments: string[]): Promise<boolean>;
}

export const NO_NATIVE_FS =
  "File access is unavailable — this window is not running inside the DW Workbench desktop app.";

export function getNativeFs(): NativeFs | null {
  return ((window as any).electronAPI?.files as NativeFs | undefined) ?? null;
}

export function requireNativeFs(): NativeFs {
  const fs = getNativeFs();
  if (!fs) throw new Error(NO_NATIVE_FS);
  return fs;
}

/**
 * Electron wraps handler failures as
 * `Error invoking remote method 'files:read-text': Error: EPERM: ...`.
 * Strip the plumbing so dialogs show the actual filesystem error.
 */
export function describeFsError(e: any): string {
  const raw = e?.message ?? String(e);
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^Error:\s*/, "");
}

/** Last path component, handling both separators. */
export function basename(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
