const DB_NAME        = "dw-workbench";
const STORE_NAME     = "recent-projects";
const WORKSPACE_STORE = "workspace";
const MAX_RECENT     = 10;

export interface RecentProject {
  id: string;
  name: string;
  modified: string;
  handle: FileSystemDirectoryHandle;
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
        db.createObjectStore(WORKSPACE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function txAll(db: IDBDatabase): Promise<RecentProject[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

function txWrite(db: IDBDatabase, items: RecentProject[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const t     = db.transaction(STORE_NAME, "readwrite");
    const store = t.objectStore(STORE_NAME);
    store.clear();
    for (const r of items) store.put(r);
    t.oncomplete = () => resolve();
    t.onerror    = () => reject(t.error);
  });
}

function txDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getRecentProjects(): Promise<RecentProject[]> {
  try {
    const db  = await openDB();
    const all = await txAll(db);
    return all.sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    return [];
  }
}

export async function addRecentProject(project: Omit<RecentProject, "id">): Promise<void> {
  try {
    const db  = await openDB();
    const all = await txAll(db);

    const deduped: RecentProject[] = [];
    for (const r of all) {
      const same = await r.handle.isSameEntry(project.handle).catch(() => false);
      if (!same) deduped.push(r);
    }

    const entry: RecentProject = { ...project, id: crypto.randomUUID() };
    await txWrite(db, [entry, ...deduped].slice(0, MAX_RECENT));
  } catch { /* non-critical */ }
}

export async function removeRecentProject(id: string): Promise<void> {
  try {
    const db = await openDB();
    await txDelete(db, id);
  } catch { /* non-critical */ }
}

export type OpenRecentResult =
  | { ok: true;  handle: FileSystemDirectoryHandle }
  | { ok: false; reason: "permission-denied" | "directory-not-found" | "unavailable" };

// ── Workspace folder ──────────────────────────────────────────────────────────

export async function getWorkspaceFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(WORKSPACE_STORE, "readonly").objectStore(WORKSPACE_STORE).get("workspace");
      req.onsuccess = () => resolve(req.result?.handle ?? null);
      req.onerror   = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setWorkspaceFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(WORKSPACE_STORE, "readwrite").objectStore(WORKSPACE_STORE).put({ id: "workspace", handle });
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch { /* non-critical */ }
}

export async function requestRecentAccess(recent: RecentProject): Promise<OpenRecentResult> {
  try {
    const permission = await (recent.handle as any).requestPermission({ mode: "readwrite" });
    if (permission !== "granted") return { ok: false, reason: "permission-denied" };
    // Verify the directory is still accessible
    try {
      for await (const _ of (recent.handle as any).entries()) { break; }
    } catch {
      await removeRecentProject(recent.id).catch(() => {});
      return { ok: false, reason: "directory-not-found" };
    }
    return { ok: true, handle: recent.handle };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
