import type {
  ProjectMeta,
  ScriptEditorState,
  FlowState,
  ProjectSnapshot,
} from "../types/project";
import { MAX_ROLLING_SNAPSHOTS } from "../types/project";
import { addRecentProject, getWorkspaceFolder } from "./recentProjectsService";

const AUTOSAVE_KEY  = "dw-autosave";
const SNAPSHOT_FILE = "autosave.json";

// ── Directory file helpers ────────────────────────────────────────────────────

async function writeFile(dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
  const fh       = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const fh   = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function getSubDir(
  dir: FileSystemDirectoryHandle,
  name: string,
  create = false,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await dir.getDirectoryHandle(name, { create });
  } catch {
    return null;
  }
}

// ── Project file I/O ──────────────────────────────────────────────────────────

async function writeProjectFiles(
  dir: FileSystemDirectoryHandle,
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

export interface LoadedProject {
  meta:         ProjectMeta;
  scriptEditor: ScriptEditorState;
  flow:         FlowState;
  notes:        string;
  autosaveNewer: boolean;  // true if autosave is newer than last explicit save
}

async function readProjectFiles(dir: FileSystemDirectoryHandle): Promise<LoadedProject> {
  const [metaRaw, scriptRaw, flowRaw, notesRaw] = await Promise.all([
    readFile(dir, "project.json"),
    readFile(dir, "script.json"),
    readFile(dir, "flow.json"),
    readFile(dir, "notes.md"),
  ]);

  const meta:         ProjectMeta       = metaRaw  ? JSON.parse(metaRaw)  : { version: 2, name: dir.name, created: new Date().toISOString(), modified: new Date().toISOString() };
  const scriptEditor: ScriptEditorState = scriptRaw ? JSON.parse(scriptRaw) : (await import("../types/project")).defaultScriptEditor();
  const flow:         FlowState         = flowRaw  ? JSON.parse(flowRaw)  : { nodes: [], edges: [] };
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

async function pruneSnapshots(snapshotsDir: FileSystemDirectoryHandle): Promise<void> {
  const names: string[] = [];
  for await (const [name] of (snapshotsDir as any).entries()) {
    if (name !== SNAPSHOT_FILE && name.endsWith(".json")) names.push(name);
  }
  names.sort();
  const toDelete = names.slice(0, Math.max(0, names.length - MAX_ROLLING_SNAPSHOTS));
  for (const name of toDelete) {
    await (snapshotsDir as any).removeEntry(name).catch(() => {});
  }
}

async function writeRollingSnapshot(
  dir: FileSystemDirectoryHandle,
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

export async function createProject(
  name: string,
  scriptEditor: ScriptEditorState,
  flow: FlowState,
  notes: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const workspace = await getWorkspaceFolder();
    const parentDir = workspace
      ? workspace
      : await (window as any).showDirectoryPicker({ mode: "readwrite" });
    const projectDir = await parentDir.getDirectoryHandle(name, { create: true });
    const meta: ProjectMeta = { version: 2, name, created: new Date().toISOString(), modified: new Date().toISOString() };
    await writeProjectFiles(projectDir, meta, scriptEditor, flow, notes);
    await addRecentProject({ name, modified: meta.modified, handle: projectDir });
    return projectDir;
  } catch {
    return null;
  }
}

export async function openProject(): Promise<{ loaded: LoadedProject; handle: FileSystemDirectoryHandle } | null> {
  try {
    const workspace = await getWorkspaceFolder();
    const opts: any = { mode: "readwrite" };
    if (workspace) opts.startIn = workspace;
    const dir = await (window as any).showDirectoryPicker(opts);
    const loaded = await readProjectFiles(dir);
    await addRecentProject({ name: loaded.meta.name, modified: loaded.meta.modified, handle: dir });
    return { loaded, handle: dir };
  } catch {
    return null;
  }
}

export async function saveProject(
  dir: FileSystemDirectoryHandle,
  name: string,
  scriptEditor: ScriptEditorState,
  flow: FlowState,
  notes: string,
): Promise<boolean> {
  try {
    const meta: ProjectMeta = { version: 2, name, created: new Date().toISOString(), modified: new Date().toISOString() };
    await writeProjectFiles(dir, meta, scriptEditor, flow, notes);
    await writeRollingSnapshot(dir, scriptEditor, flow);
    await addRecentProject({ name, modified: meta.modified, handle: dir });
    return true;
  } catch {
    return false;
  }
}

export async function saveProjectAs(
  name: string,
  scriptEditor: ScriptEditorState,
  flow: FlowState,
  notes: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const workspace = await getWorkspaceFolder();
    const parentDir = workspace
      ? workspace
      : await (window as any).showDirectoryPicker({ mode: "readwrite" });
    const projectDir = await parentDir.getDirectoryHandle(name, { create: true });
    const meta: ProjectMeta = { version: 2, name, created: new Date().toISOString(), modified: new Date().toISOString() };
    await writeProjectFiles(projectDir, meta, scriptEditor, flow, notes);
    await writeRollingSnapshot(projectDir, scriptEditor, flow);
    await addRecentProject({ name, modified: meta.modified, handle: projectDir });
    return projectDir;
  } catch {
    return null;
  }
}

export async function openRecentLoadProject(
  dir: FileSystemDirectoryHandle,
): Promise<LoadedProject | null> {
  try {
    return await readProjectFiles(dir);
  } catch {
    return null;
  }
}

// ── Autosave to disk (saved projects) ────────────────────────────────────────

export async function autosaveToDisk(
  dir: FileSystemDirectoryHandle,
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

export async function loadAutosaveFromDisk(
  dir: FileSystemDirectoryHandle,
): Promise<ProjectSnapshot | null> {
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
