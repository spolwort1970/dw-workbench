import { getNativeFs } from "./nativeFs";

// Recent projects and the workspace folder are plain absolute paths kept in
// localStorage. They used to be FileSystemDirectoryHandles in IndexedDB, which meant
// re-granting permission on every restart — and which stopped working entirely once
// the File System Access API turned out to be unimplemented in Electron 31.

const RECENTS_KEY   = "dw-recent-projects";
const WORKSPACE_KEY = "dw-workspace-folder";
const LEGACY_DB     = "dw-workbench";
const MAX_RECENT    = 10;

export interface RecentProject {
  id: string;
  name: string;
  modified: string;
  path: string;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

/** Windows paths are case-insensitive, and pickers vary on trailing separators. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
  return norm(a) === norm(b);
}

function readRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r: any) => r && typeof r.path === "string" && typeof r.name === "string");
  } catch {
    return [];
  }
}

function writeRecents(items: RecentProject[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
  } catch { /* non-critical */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getRecentProjects(): RecentProject[] {
  return readRecents().sort((a, b) => b.modified.localeCompare(a.modified));
}

export function addRecentProject(project: Omit<RecentProject, "id">): void {
  if (!project.path) return;
  const deduped = readRecents().filter((r) => !samePath(r.path, project.path));
  const entry: RecentProject = { ...project, id: crypto.randomUUID() };
  writeRecents([entry, ...deduped]);
}

export function removeRecentProject(id: string): void {
  writeRecents(readRecents().filter((r) => r.id !== id));
}

export type OpenRecentResult =
  | { ok: true;  path: string }
  | { ok: false; reason: "directory-not-found" | "unavailable" };

/** Confirm a recent project's folder is still on disk before opening it. */
export async function checkRecentProject(recent: RecentProject): Promise<OpenRecentResult> {
  const fs = getNativeFs();
  if (!fs) return { ok: false, reason: "unavailable" };
  try {
    if (!await fs.exists(recent.path)) {
      removeRecentProject(recent.id);
      return { ok: false, reason: "directory-not-found" };
    }
    return { ok: true, path: recent.path };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

// ── Workspace folder ──────────────────────────────────────────────────────────

export function getWorkspaceFolder(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * The workspace folder, falling back to Documents\DW Workbench and remembering it.
 *
 * Nothing is asked of the user here. A first save should just work; picking a
 * folder is only interesting to someone who wants a different one, and that lives
 * behind "Select Projects Folder…".
 */
export async function resolveWorkspaceFolder(): Promise<string | null> {
  const stored = getWorkspaceFolder();
  if (stored) return stored;
  const fs = getNativeFs();
  if (!fs) return null;
  try {
    const dir = await fs.defaultWorkspace();
    if (!dir) return null;
    setWorkspaceFolder(dir);
    return dir;
  } catch {
    return null;
  }
}

export function setWorkspaceFolder(dirPath: string): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, dirPath);
  } catch { /* non-critical */ }
}

/**
 * Drop the old IndexedDB of directory handles. Nothing can read those handles any
 * more, and leaving the database around keeps Chromium prompting for access to
 * folders the app no longer uses.
 */
export function clearLegacyHandleStore(): void {
  try { indexedDB.deleteDatabase(LEGACY_DB); } catch { /* non-critical */ }
}
