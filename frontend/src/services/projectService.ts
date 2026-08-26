import type {
  ProjectMeta,
  ScriptEditorState,
  FlowState,
  ProjectSnapshot,
} from "../types/project";
import { MAX_ROLLING_SNAPSHOTS } from "../types/project";
import { addRecentProject, getWorkspaceFolder } from "./recentProjectsService";
import { requireNativeFs, getNativeFs, describeFsError, basename, NO_NATIVE_FS } from "./nativeFs";

const AUTOSAVE_KEY  = "dw-autosave";
const SNAPSHOT_FILE = "autosave.json";

/**
 * A project is an absolute path to its folder. Directory handles from the File
 * System Access API are gone — Electron 31 never implemented that API, so the
 * picker silently never opened. See services/nativeFs.ts.
 */
export type ProjectDir = string;

// ── Error reporting ───────────────────────────────────────────────────────────
// These operations used to swallow every failure and return null, which made a
// broken directory picker indistinguishable from the user pressing Cancel.

let lastFileError: string | null = null;

/** Message from the most recent failed file operation, or null if it was a cancel. */
export function getLastFileError(): string | null {
  return lastFileError;
}

function noteError(e: any): void {
  lastFileError = describeFsError(e);
  console.error("[dw-workbench] file operation failed:", e);
}

// ── Directory picking ─────────────────────────────────────────────────────────

/** Native folder picker. Returns null when the user cancels. */
export async function pickDirectory(title: string): Promise<ProjectDir | null> {
  return await requireNativeFs().pickDirectory({
    title,
    defaultPath: getWorkspaceFolder(),
  });
}

// ── Listing projects in the workspace ─────────────────────────────────────────

export interface ProjectEntry {
  name:     string;
  path:     ProjectDir;
  modified: string;   // ISO date, or "" when project.json has no usable date
}

/**
 * Every immediate subfolder of the workspace that holds a project.json.
 *
 * This is what makes "Open Project" a list of projects rather than a folder
 * browser: the workspace folder is configured once, and projects inside it are
 * addressed by name from then on.
 */
export async function listProjects(workspace: ProjectDir): Promise<ProjectEntry[]> {
  const fs = getNativeFs();
  if (!fs) return [];
  let names: string[];
  try {
    names = await fs.list(workspace);
  } catch {
    return [];
  }

  const entries = await Promise.all(names.map(async (name): Promise<ProjectEntry | null> => {
    try {
      const dir = await fs.resolve(workspace, name);
      const raw = await fs.readText(dir, "project.json");
      if (raw === null) return null;                 // not a project folder
      let meta: any = {};
      try { meta = JSON.parse(raw); } catch { /* keep folder name, no date */ }
      return { name: meta.name || name, path: dir, modified: meta.modified || "" };
    } catch {
      return null;                                   // unreadable entry — skip it
    }
  }));

  return entries.filter((e): e is ProjectEntry => e !== null)
    .sort((a, b) => b.modified.localeCompare(a.modified) || a.name.localeCompare(b.name));
}

// ── Directory file helpers ────────────────────────────────────────────────────

async function writeFile(dir: ProjectDir, name: string, content: string): Promise<void> {
  await requireNativeFs().writeText([dir, name], content);
}

async function readFile(dir: ProjectDir, name: string): Promise<string | null> {
  try {
    return await requireNativeFs().readText(dir, name);
  } catch {
    return null;
  }
}

async function getSubDir(dir: ProjectDir, name: string, create = false): Promise<ProjectDir | null> {
  const fs = getNativeFs();
  if (!fs) return null;
  try {
    if (create) return await fs.mkdirp(dir, name);
    const path = await fs.resolve(dir, name);
    return await fs.exists(path) ? path : null;
  } catch {
    return null;
  }
}

// ── Project file I/O ──────────────────────────────────────────────────────────

async function writeProjectFiles(
  dir: ProjectDir,
  meta: ProjectMeta,
  scriptEditor: ScriptEditorState,
  flow: FlowState,
  notes: string,
): Promise<void> {
  await writeFile(dir, "project.json",  JSON.stringify({ ...meta, modified: new Date().toISOString() }, null, 2));
  await writeFile(dir, "script.json",   JSON.stringify(scriptEditor, null, 2));
  await writeFile(dir, "flow.json",     JSON.stringify(flow, null, 2));
  await writeFile(dir, "notes.md",      notes);
}

/** FlowState is `{ flows: [] }`. Tolerate missing files and pre-v2 shapes. */
function normalizeFlow(raw: any): FlowState {
  if (raw && Array.isArray(raw.flows)) return raw as FlowState;
  return { flows: [] };
}

export interface LoadedProject {
  meta:         ProjectMeta;
  scriptEditor: ScriptEditorState;
  flow:         FlowState;
  notes:        string;
  autosaveNewer: boolean;  // true if autosave is newer than last explicit save
}

async function readProjectFiles(dir: ProjectDir): Promise<LoadedProject> {
  const [metaRaw, scriptRaw, flowRaw, notesRaw] = await Promise.all([
    readFile(dir, "project.json"),
    readFile(dir, "script.json"),
    readFile(dir, "flow.json"),
    readFile(dir, "notes.md"),
  ]);

  const meta:         ProjectMeta       = metaRaw  ? JSON.parse(metaRaw)  : { version: 2, name: basename(dir), created: new Date().toISOString(), modified: new Date().toISOString() };
  const scriptEditor: ScriptEditorState = scriptRaw ? JSON.parse(scriptRaw) : (await import("../types/project")).defaultScriptEditor();
  const flow:         FlowState         = normalizeFlow(flowRaw ? JSON.parse(flowRaw) : null);
  const notes:        string            = notesRaw ?? "";

  // Check if autosave is newer than last explicit save
  let autosaveNewer = false;
  const snapshotsDir = await getSubDir(dir, "snapshots");
  if (snapshotsDir) {
    const autosaveRaw = await readFile(snapshotsDir, SNAPSHOT_FILE);
    if (autosaveRaw) {
      const autosave = JSON.parse(autosaveRaw) as ProjectSnapshot;
      autosaveNewer = autosave.timestamp > meta.modified;
    }
  }

  return { meta, scriptEditor, flow, notes, autosaveNewer };
}

// ── Rolling snapshots ─────────────────────────────────────────────────────────

async function pruneSnapshots(snapshotsDir: ProjectDir): Promise<void> {
  const fs = requireNativeFs();
  const names = (await fs.list(snapshotsDir))
    .filter((n) => n !== SNAPSHOT_FILE && n.endsWith(".json"))
    .sort();
  const toDelete = names.slice(0, Math.max(0, names.length - MAX_ROLLING_SNAPSHOTS));
  for (const name of toDelete) {
    await fs.remove(snapshotsDir, name).catch(() => {});
  }
}

async function writeRollingSnapshot(
  dir: ProjectDir,
  scriptEditor: ScriptEditorState,
  flow: FlowState,
): Promise<void> {
  const snapshotsDir = await getSubDir(dir, "snapshots", true);
  if (!snapshotsDir) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshot: ProjectSnapshot = { timestamp: new Date().toISOString(), scriptEditor, flow };
  await writeFile(snapshotsDir, `${timestamp}.json`, JSON.stringify(snapshot, null, 2));
  await pruneSnapshots(snapshotsDir);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create `<workspace>/<name>/` and write a fresh project into it.
 *
 * The caller supplies the workspace — this never opens a picker. Choosing where
 * projects live is a one-time decision made through "Select Projects Folder…",
 * not something to re-answer on every save.
 */
export async function createProjectIn(
  workspace: ProjectDir,
  name: string,
  scriptEditor: ScriptEditorState,
  flow: FlowState,
  notes: string,
  snapshot = false,
): Promise<ProjectDir | null> {
  lastFileError = null;
  try {
    const projectDir = await requireNativeFs().mkdirp(workspace, name);
    const meta: ProjectMeta = { version: 2, name, created: new Date().toISOString(), modified: new Date().toISOString() };
    await writeProjectFiles(projectDir, meta, scriptEditor, flow, notes);
    if (snapshot) await writeRollingSnapshot(projectDir, scriptEditor, flow);
    addRecentProject({ name, modified: meta.modified, path: projectDir });
    return projectDir;
  } catch (e) {
    noteError(e);
    return null;
  }
}

/** Load the project stored in `dir`. */
export async function openProjectAt(dir: ProjectDir): Promise<{ loaded: LoadedProject; handle: ProjectDir } | null> {
  lastFileError = null;
  try {
    const loaded = await readProjectFiles(dir);
    addRecentProject({ name: loaded.meta.name, modified: loaded.meta.modified, path: dir });
    return { loaded, handle: dir };
  } catch (e) {
    noteError(e);
    return null;
  }
}

/** True if `dir` looks like a project folder (has a project.json). */
export async function isProjectDir(dir: ProjectDir): Promise<boolean> {
  const fs = getNativeFs();
  if (!fs) return false;
  try   { return await fs.exists(dir, "project.json"); }
  catch { return false; }
}

export async function saveProject(
  dir: ProjectDir,
  name: string,
  scriptEditor: ScriptEditorState,
  flow: FlowState,
  notes: string,
): Promise<boolean> {
  lastFileError = null;
  try {
    const meta: ProjectMeta = { version: 2, name, created: new Date().toISOString(), modified: new Date().toISOString() };
    await writeProjectFiles(dir, meta, scriptEditor, flow, notes);
    await writeRollingSnapshot(dir, scriptEditor, flow);
    addRecentProject({ name, modified: meta.modified, path: dir });
    return true;
  } catch (e) {
    noteError(e);
    return false;
  }
}

export async function openRecentLoadProject(dir: ProjectDir): Promise<LoadedProject | null> {
  lastFileError = null;
  try {
    return await readProjectFiles(dir);
  } catch (e) {
    noteError(e);
    return null;
  }
}

/** Pick a folder to use as the default location for new projects. */
export async function pickWorkspaceFolder(): Promise<ProjectDir | null> {
  lastFileError = null;
  const fs = getNativeFs();
  if (!fs) { lastFileError = NO_NATIVE_FS; return null; }
  try {
    return await fs.pickDirectory({
      title: "Select Projects Folder",
      defaultPath: getWorkspaceFolder(),
    });
  } catch (e) {
    noteError(e);
    return null;
  }
}

// ── Autosave to disk (saved projects) ────────────────────────────────────────

export async function autosaveToDisk(
  dir: ProjectDir,
  scriptEditor: ScriptEditorState,
  flow: FlowState,
): Promise<void> {
  try {
    const snapshotsDir = await getSubDir(dir, "snapshots", true);
    if (!snapshotsDir) return;
    const snapshot: ProjectSnapshot = { timestamp: new Date().toISOString(), scriptEditor, flow };
    await writeFile(snapshotsDir, SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  } catch { /* silently fail */ }
}

export async function loadAutosaveFromDisk(dir: ProjectDir): Promise<ProjectSnapshot | null> {
  try {
    const snapshotsDir = await getSubDir(dir, "snapshots");
    if (!snapshotsDir) return null;
    const raw = await readFile(snapshotsDir, SNAPSHOT_FILE);
    return raw ? (JSON.parse(raw) as ProjectSnapshot) : null;
  } catch {
    return null;
  }
}

// ── localStorage autosave (unsaved projects only) ────────────────────────────

export function autosaveToLocal(scriptEditor: ScriptEditorState, flow: FlowState, notes: string, name: string): void {
  try {
    const snapshot = { timestamp: new Date().toISOString(), scriptEditor, flow, notes, name };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
  } catch { /* storage full */ }
}

export function loadLocalAutosave(): { scriptEditor: ScriptEditorState; flow: FlowState; notes: string; name: string } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearLocalAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
}
