import { useEffect, useRef, useState } from "react";
import { getRecentProjects, requestRecentAccess, removeRecentProject, type RecentProject } from "../services/recentProjectsService";
import { useDialog } from "./Dialog";

interface Props {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpenRecent: (handle: FileSystemDirectoryHandle) => void;
  onSelectProjectsFolder: () => void;
}

export default function FileMenu({ onNew, onOpen, onSave, onSaveAs, onOpenRecent, onSelectProjectsFolder }: Props) {
  const { alert } = useDialog();
  const [open, setOpen]       = useState(false);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    getRecentProjects().then(setRecents);
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const action = (fn: () => void) => { setOpen(false); fn(); };

  const handleRecent = async (recent: RecentProject) => {
    setOpen(false);
    const result = await requestRecentAccess(recent);
    if (!result.ok) {
      if (result.reason === "directory-not-found") {
        await alert(`"${recent.name}" could not be found. It may have been moved or deleted.`);
        setRecents((prev) => prev.filter((r) => r.id !== recent.id));
      } else if (result.reason === "permission-denied") {
        await alert("Permission to access this project folder was denied.");
      }
      return;
    }
    onOpenRecent(result.handle);
  };

  const handleRemoveRecent = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await removeRecentProject(id);
    setRecents((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="settings-wrapper" ref={ref}>
      <button className="icon-btn header-icon-btn" onClick={() => setOpen((v) => !v)}>
        <FolderIcon />
        <span>File</span>
      </button>

      {open && (
        <div className="settings-dropdown file-menu-dropdown">
          <button className="settings-row" onClick={() => action(onNew)}>
            <NewIcon /> <span className="settings-row-label">New Project</span>
          </button>
          <button className="settings-row" onClick={() => action(onOpen)}>
            <OpenIcon /> <span className="settings-row-label">Open Project…</span>
          </button>
          <div className="file-menu-divider" />
          <button className="settings-row" onClick={() => action(onSave)}>
            <SaveIcon /> <span className="settings-row-label">Save</span>
            <span className="settings-row-value">Ctrl+S</span>
          </button>
          <button className="settings-row" onClick={() => action(onSaveAs)}>
            <SaveIcon /> <span className="settings-row-label">Save As…</span>
          </button>
          <div className="file-menu-divider" />
          <button className="settings-row" onClick={() => action(onSelectProjectsFolder)}>
            <FolderSetIcon /> <span className="settings-row-label">Select Projects Folder…</span>
          </button>

          {recents.length > 0 && (
            <>
              <div className="file-menu-divider" />
              <div className="file-menu-section-label">Recent Projects</div>
              {recents.map((r) => (
                <button key={r.id} className="settings-row recent-row" onClick={() => handleRecent(r)}>
                  <RecentIcon />
                  <span className="settings-row-label recent-name">{r.name}</span>
                  <span className="settings-row-value recent-date">
                    {new Date(r.modified).toLocaleDateString()}
                  </span>
                  <span
                    className="recent-remove"
                    role="button"
                    title="Remove from list"
                    onClick={(e) => handleRemoveRecent(e, r.id)}
                  >×</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function NewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function RecentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function FolderSetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}
