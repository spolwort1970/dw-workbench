import { useRef, useCallback } from "react";
import type { MimeTypeOption } from "./MimeTypeDropdown";
import { MIME_TYPES } from "./MimeTypeDropdown";

export interface WorkspaceState {
  version: 1;
  script: string;
  payload: string;
  inputMimeType: string;
  outputMimeType: string;
}

interface Props {
  getState: () => WorkspaceState;
  onImport: (state: WorkspaceState, inputMime: MimeTypeOption, outputMime: MimeTypeOption) => void;
}

export default function ImportExport({ getState, onImport }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    const state = getState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workspace.dwb.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [getState]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const state = JSON.parse(ev.target?.result as string) as WorkspaceState;
        if (state.version !== 1 || !state.script) return;
        const inputMime  = MIME_TYPES.find((m) => m.value === state.inputMimeType)  ?? MIME_TYPES[0];
        const outputMime = MIME_TYPES.find((m) => m.value === state.outputMimeType) ?? MIME_TYPES[0];
        onImport(state, inputMime, outputMime);
      } catch {
        // invalid file — ignore
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [onImport]);

  return (
    <>
      <button className="icon-btn header-icon-btn" onClick={handleExport} title="Export workspace">
        <ExportIcon />
        <span>Export</span>
      </button>
      <button className="icon-btn header-icon-btn" onClick={() => fileInputRef.current?.click()} title="Import workspace">
        <ImportIcon />
        <span>Import</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={handleImport}
      />
    </>
  );
}

function ExportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
