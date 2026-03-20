import { useState, useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import Editor from "@monaco-editor/react";
import { executeDW, type ExecuteDWResponse } from "./services/api";
import SettingsDropdown from "./components/SettingsDropdown";
import CopyButton from "./components/CopyButton";
import SaveButton from "./components/SaveButton";
import LoadPayloadButton from "./components/LoadPayloadButton";
import ImportExport, { type WorkspaceState } from "./components/ImportExport";
import FileMenu from "./components/FileMenu";
import FlowCanvas, { type FlowCanvasHandle } from "./components/flow/FlowCanvas";
import MimeTypeDropdown, { MIME_TYPES, type MimeTypeOption } from "./components/MimeTypeDropdown";
import { registerThemes, isLightTheme, getThemeBg } from "./monacoThemes";
import { DW_LANGUAGE_ID } from "./dwLanguage";
import { getErrorHint } from "./errorHints";
import { DialogProvider, useDialog } from "./components/Dialog";
import {
  createProject, openProject, saveProject, saveProjectAs,
  openRecentLoadProject, autosaveToDisk, autosaveToLocal,
  loadLocalAutosave,
} from "./services/projectService";
import { addRecentProject, setWorkspaceFolder } from "./services/recentProjectsService";
import { DEFAULT_PROJECT_NAME, defaultScriptEditor, defaultFlowState, type ScriptEditorState, type FlowState } from "./types/project";
import type { FlowCanvasState } from "./types/flow";
import "./App.css";

const MIN_COL_WIDTH = 150;
const PAYLOAD_COLLAPSED_WIDTH = 52;

type Tab = "script" | "flow" | "notes";

export default function App() {
  const [theme] = useState(() => localStorage.getItem("dw-theme") ?? "vs-dark");
  return (
    <DialogProvider theme={theme}>
      <AppInner />
    </DialogProvider>
  );
}

function AppInner() {
  const { confirm, alert, prompt, setDialogTheme } = useDialog();
  const [activeTab, setActiveTab] = useState<Tab>("script");
  const [notesPreview, setNotesPreview] = useState(false);

  // ── Project state ──────────────────────────────────────────────
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [isDirty, setIsDirty] = useState(false);
  const [notes, setNotes] = useState("");
  const dirHandleRef  = useRef<FileSystemDirectoryHandle | null>(null);
  const skipDirtyRef  = useRef(false); // prevents restore from triggering dirty

  // Flow canvas state — stored in a ref to avoid re-renders on every node drag
  const flowStateRef  = useRef<FlowState>(defaultFlowState());
  const [initialFlow, setInitialFlow] = useState<FlowState>(defaultFlowState());
  const [flowKey, setFlowKey]         = useState(0);
  const flowCanvasRef = useRef<FlowCanvasHandle>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const defaults = defaultScriptEditor();
  const [script, setScript] = useState(defaults.script);
  const [payloadText, setPayloadText] = useState(defaults.payload);
  const [result, setResult] = useState<ExecuteDWResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [showRunning, setShowRunning] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [payloadMimeType, setPayloadMimeType] = useState<MimeTypeOption>(MIME_TYPES[0]);

  const handlePayloadMimeChange = useCallback(async (option: MimeTypeOption) => {
    setPayloadMimeType(option);
    try {
      const payload = payloadMimeType.language === "json"
        ? JSON.parse(payloadText)
        : payloadText;
      const res = await executeDW({
        script: `%dw 2.0\noutput ${option.value}\n---\npayload`,
        payload,
        input_mime_type: payloadMimeType.value,
        attributes: {},
        vars: {},
      });
      if (res.success && res.output) setPayloadText(String(res.output));
    } catch {
      // keep existing content if conversion fails
    }
  }, [payloadMimeType, payloadText]);
  const [outputMimeType, setOutputMimeType] = useState<MimeTypeOption>(MIME_TYPES[0]);

  const handleOutputMimeChange = useCallback((option: MimeTypeOption) => {
    setOutputMimeType(option);
    setScript((prev) =>
      prev.replace(/^output\s+\S+/m, `output ${option.value}`)
    );
  }, []);
  const [payloadWidth, setPayloadWidth] = useState(() => Math.floor(window.innerWidth * 0.25));
  const [payloadCollapsed, setPayloadCollapsed] = useState(false);
  const [outputWidth, setOutputWidth] = useState(() => Math.floor(window.innerWidth * 0.25));
  const [outputCollapsed, setOutputCollapsed] = useState(false);

  const [editorTheme, setEditorTheme] = useState(
    () => localStorage.getItem("dw-theme") ?? "vs-dark"
  );
  const [themeBg, setThemeBg] = useState(
    () => getThemeBg(localStorage.getItem("dw-theme") ?? "vs-dark")
  );
  const [editorFontSize, setEditorFontSize] = useState(
    () => Number(localStorage.getItem("dw-font-size") ?? 13)
  );

  const handleThemeChange = useCallback((id: string) => {
    localStorage.setItem("dw-theme", id);
    setEditorTheme(id);
    setThemeBg(getThemeBg(id));
    setDialogTheme(id);
  }, [setDialogTheme]);

  const handleFontSizeChange = useCallback((size: number) => {
    localStorage.setItem("dw-font-size", String(size));
    setEditorFontSize(size);
  }, []);

  const getWorkspaceState = useCallback((): WorkspaceState => ({
    version: 1,
    script,
    payload: payloadText,
    inputMimeType: payloadMimeType.value,
    outputMimeType: outputMimeType.value,
  }), [script, payloadText, payloadMimeType, outputMimeType]);

  const handleImportWorkspace = useCallback((state: WorkspaceState, inputMime: MimeTypeOption, outputMime: MimeTypeOption) => {
    setScript(state.script);
    setPayloadText(state.payload);
    setPayloadMimeType(inputMime);
    setOutputMimeType(outputMime);
  }, []);

  const handleLoadPayload = useCallback((text: string, mimeOption: MimeTypeOption) => {
    setPayloadText(text);
    setPayloadMimeType(mimeOption);
  }, []);

  // ── Project helpers ────────────────────────────────────────────
  const getScriptEditorState = useCallback((): ScriptEditorState => ({
    script,
    payload: payloadText,
    inputMimeType: payloadMimeType.value,
    outputMimeType: outputMimeType.value,
  }), [script, payloadText, payloadMimeType, outputMimeType]);

  const getFlowState = useCallback((): FlowState => flowStateRef.current, []);

  const restoreEditorState = useCallback((se: ScriptEditorState, fl: FlowState, n: string, name: string, dirty = false) => {
    skipDirtyRef.current = true;
    setScript(se.script);
    setPayloadText(se.payload);
    setPayloadMimeType(MIME_TYPES.find((m) => m.value === se.inputMimeType) ?? MIME_TYPES[0]);
    setOutputMimeType(MIME_TYPES.find((m) => m.value === se.outputMimeType) ?? MIME_TYPES[0]);
    setNotes(n);
    setProjectName(name);
    setIsDirty(dirty);
    setActiveTab("script");
    // Reinitialize flow canvas with new project data
    const flow = fl ?? defaultFlowState();
    setInitialFlow(flow);
    setFlowKey((k) => k + 1);
    flowStateRef.current = flow;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  // ── File menu actions ──────────────────────────────────────────
  const handleNew = useCallback(async () => {
    if (isDirty && !await confirm("Discard unsaved changes and create a new project?", "New Project", "Discard & Continue")) return;
    const name = await prompt("Project name:", DEFAULT_PROJECT_NAME, "New Project");
    if (!name) return;
    const se = defaultScriptEditor();
    const fl = defaultFlowState();
    const dir = await createProject(name, se, fl, "");
    if (!dir) return;
    restoreEditorState(se, fl, "", name);
    dirHandleRef.current = dir;
  }, [isDirty, restoreEditorState]);

  const handleOpen = useCallback(async () => {
    if (isDirty && !await confirm("Discard unsaved changes and open a project?", "Open Project", "Discard & Continue")) return;
    const result = await openProject();
    if (!result) return;
    const { loaded, handle } = result;
    if (loaded.autosaveNewer && await confirm("An autosave newer than your last save was found. Restore it?", "Autosave Found", "Restore")) {
      const s = await (await import("./services/projectService")).loadAutosaveFromDisk(handle);
      if (s) {
        restoreEditorState(s.scriptEditor, s.flow, loaded.notes, loaded.meta.name, true);
        dirHandleRef.current = handle;
        return;
      }
    }
    restoreEditorState(loaded.scriptEditor, loaded.flow, loaded.notes, loaded.meta.name);
    dirHandleRef.current = handle;
  }, [isDirty, restoreEditorState]);

  const handleSave = useCallback(async () => {
    if (!dirHandleRef.current) {
      // Not yet saved — prompt for location
      const name = projectName === DEFAULT_PROJECT_NAME
        ? (await prompt("Project name:", DEFAULT_PROJECT_NAME, "Save Project") ?? DEFAULT_PROJECT_NAME)
        : projectName;
      const dir = await createProject(name, getScriptEditorState(), getFlowState(), notes);
      if (!dir) return;
      dirHandleRef.current = dir;
      setProjectName(name);
      setIsDirty(false);
      return;
    }
    const ok = await saveProject(dirHandleRef.current, projectName, getScriptEditorState(), getFlowState(), notes);
    if (ok) { setIsDirty(false); }
  }, [projectName, notes, getScriptEditorState, getFlowState]);

  const handleSaveAs = useCallback(async () => {
    const name = await prompt("Project name:", projectName, "Save As") ?? projectName;
    const dir = await saveProjectAs(name, getScriptEditorState(), getFlowState(), notes);
    if (dir) {
      dirHandleRef.current = dir;
      setProjectName(name);
      setIsDirty(false);
    }
  }, [projectName, notes, getScriptEditorState, getFlowState]);

  const [flowVersion, setFlowVersion] = useState(0);

  const handleFlowChange = useCallback((canvasState: FlowCanvasState) => {
    flowStateRef.current = canvasState as unknown as FlowState;
    setFlowVersion((v) => v + 1);
  }, []);

  const handleHistoryChange = useCallback((u: boolean, r: boolean) => {
    setCanUndo(u);
    setCanRedo(r);
  }, []);

  const handleSelectProjectsFolder = useCallback(async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      await setWorkspaceFolder(handle);
      await alert(`Projects folder set to "${handle.name}".`, "Projects Folder");
    } catch {
      // user cancelled — do nothing
    }
  }, []);

  const handleOpenRecent = useCallback(async (handle: FileSystemDirectoryHandle) => {
    if (isDirty && !await confirm("Discard unsaved changes and open this project?", "Open Project", "Discard & Continue")) return;
    const loaded = await openRecentLoadProject(handle);
    if (!loaded) { await alert("Could not read the project files."); return; }
    if (loaded.autosaveNewer && await confirm("An autosave newer than your last save was found. Restore it?", "Autosave Found", "Restore")) {
      const snap = await (await import("./services/projectService")).loadAutosaveFromDisk(handle);
      if (snap) {
        restoreEditorState(snap.scriptEditor, snap.flow, loaded.notes, loaded.meta.name, true);
        dirHandleRef.current = handle;
        await addRecentProject({ name: loaded.meta.name, modified: loaded.meta.modified, handle });
        return;
      }
    }
    restoreEditorState(loaded.scriptEditor, loaded.flow, loaded.notes, loaded.meta.name);
    dirHandleRef.current = handle;
    await addRecentProject({ name: loaded.meta.name, modified: loaded.meta.modified, handle });
  }, [isDirty, restoreEditorState]);

  // Ctrl+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  // Mark dirty on any content change (skip after programmatic restore)
  useEffect(() => {
    if (skipDirtyRef.current) { skipDirtyRef.current = false; return; }
    setIsDirty(true);
  }, [script, payloadText, payloadMimeType, outputMimeType, notes]);

  // Always autosave to localStorage (short debounce) so reloads restore state seamlessly
  useEffect(() => {
    const se = getScriptEditorState();
    const fl = getFlowState();
    const timer = setTimeout(() => autosaveToLocal(se, fl, notes, projectName), 2_000);
    return () => clearTimeout(timer);
  }, [script, payloadText, payloadMimeType, outputMimeType, notes, projectName, flowVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Disk autosave for saved projects (5-minute debounce)
  useEffect(() => {
    if (!dirHandleRef.current) return;
    const se = getScriptEditorState();
    const fl = getFlowState();
    const timer = setTimeout(() => autosaveToDisk(dirHandleRef.current!, se, fl), 300_000);
    return () => clearTimeout(timer);
  }, [script, payloadText, payloadMimeType, outputMimeType, notes, flowVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Silently restore last session on startup
  useEffect(() => {
    const saved = loadLocalAutosave();
    if (!saved) return;
    restoreEditorState(saved.scriptEditor, saved.flow, saved.notes ?? "", saved.name ?? DEFAULT_PROJECT_NAME);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const themesRegistered = useRef(false);
  useEffect(() => {
    if (!themesRegistered.current) {
      themesRegistered.current = true;
      registerThemes(editorTheme);
    }
  }, []);

  // Drag: payload <-> script divider
  const onPayloadDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = payloadWidth;
    const onMove = (me: MouseEvent) => {
      const delta = me.clientX - startX;
      setPayloadWidth(Math.max(MIN_COL_WIDTH, startWidth + delta));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [payloadWidth]);

  // Drag: script <-> output divider
  const onOutputDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = outputWidth;
    const onMove = (me: MouseEvent) => {
      const delta = startX - me.clientX;
      setOutputWidth(Math.max(MIN_COL_WIDTH, startWidth + delta));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [outputWidth]);

  const handleRun = useCallback(async () => {
    setFetchError(null);
    setRunning(true);
    setShowRunning(true);
    if (lingerTimer.current) clearTimeout(lingerTimer.current);
    try {
      let payload: unknown = null;
      if (payloadMimeType.language === "json") {
        try {
          payload = JSON.parse(payloadText);
        } catch {
          setFetchError("Payload is not valid JSON.");
          setRunning(false);
          return;
        }
      } else {
        payload = payloadText;
      }
      const res = await executeDW({ script, payload, input_mime_type: payloadMimeType.value, attributes: {}, vars: {} });
      setResult(res);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      setIsPending(false);
      lingerTimer.current = setTimeout(() => setShowRunning(false), 1500);
    }
  }, [script, payloadText, payloadMimeType]);

  useEffect(() => {
    setIsPending(true);
    const timer = setTimeout(() => handleRun(), 800);
    return () => clearTimeout(timer);
  }, [script, payloadText, payloadMimeType]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="app"
      data-theme={isLightTheme(editorTheme) ? "light" : "dark"}
      data-editor-theme={editorTheme}
      style={{ "--theme-editor-bg": themeBg } as React.CSSProperties}
    >
      <header className="app-header">
        <span className="app-title">DW Workbench</span>
        <span className="project-name">
          Project: {projectName}{isDirty ? " •" : ""}
        </span>
        <div className="header-actions">
          <FileMenu onNew={handleNew} onOpen={handleOpen} onSave={handleSave} onSaveAs={handleSaveAs} onOpenRecent={handleOpenRecent} onSelectProjectsFolder={handleSelectProjectsFolder} />
          <div className="header-history-btns">
            <button className="header-history-btn" title="Undo (Ctrl+Z)" disabled={activeTab !== "flow" || !canUndo} onClick={() => flowCanvasRef.current?.undo()}>↩ Undo</button>
            <button className="header-history-btn" title="Redo (Ctrl+Y)" disabled={activeTab !== "flow" || !canRedo} onClick={() => flowCanvasRef.current?.redo()}>↪ Redo</button>
          </div>
          <ImportExport getState={getWorkspaceState} onImport={handleImportWorkspace} />
          <SettingsDropdown theme={editorTheme} onThemeChange={handleThemeChange} fontSize={editorFontSize} onFontSizeChange={handleFontSizeChange} />
        </div>
      </header>

      <div className="tab-bar">
        <button
          className={`tab ${activeTab === "script" ? "tab--active" : ""}`}
          onClick={() => setActiveTab("script")}
          title="Write and execute DataWeave scripts. Provide a payload on the left, run the script, and inspect the output on the right."
        >
          Script Console
        </button>
        <button
          className={`tab ${activeTab === "flow" ? "tab--active" : ""}`}
          onClick={() => setActiveTab("flow")}
          title="Build and simulate Mule flows visually. Chain processors, inspect trace data, and step through execution with the debugger."
        >
          Flow Analyzer
        </button>
        <button
          className={`tab ${activeTab === "notes" ? "tab--active" : ""}`}
          onClick={() => setActiveTab("notes")}
          title="Supports Markdown preview. Great for documenting transformation intent and providing context to AI assistants."
        >
          Notes
        </button>
      </div>

      {activeTab === "script" && (
        <div className="app-body">

          {/* Payload column */}
          <div
            className={`payload-col ${payloadCollapsed ? "payload-col--collapsed" : ""}`}
            style={{ width: payloadCollapsed ? PAYLOAD_COLLAPSED_WIDTH : payloadWidth, flexShrink: 0 }}
          >
            {payloadCollapsed ? (
              <div className="collapsed-strip">
                <button className="collapse-btn" onClick={() => setPayloadCollapsed(false)} title="Expand payload"><span className="collapse-btn__arrow">›</span> Show</button>
                <span className="collapsed-label">Payload</span>
              </div>
            ) : (
              <>
                <div className="pane-label pane-label--with-action">
                  <span className="pane-label-slot">
                    <button className="collapse-btn" onClick={() => setPayloadCollapsed(true)} title="Collapse payload"><span className="collapse-btn__arrow">‹</span> Hide</button>
                  </span>
                  <span className="pane-label-center">
                    Payload <MimeTypeDropdown value={payloadMimeType.value} onChange={handlePayloadMimeChange} />
                  </span>
                  <span className="pane-label-slot pane-label-slot--right">
                    <LoadPayloadButton onLoad={handleLoadPayload} />
                    <CopyButton getText={() => payloadText} />
                  </span>
                </div>
                <Editor
                  key={payloadMimeType.value}
                  height="100%"
                  language={payloadMimeType.language}
                  theme={editorTheme}
                  value={payloadText}
                  onChange={(v) => setPayloadText(v ?? "")}
                  options={{ fontSize: editorFontSize, minimap: { enabled: false }, scrollBeyondLastLine: false }}
                />
              </>
            )}
          </div>

          {/* Payload / Script divider */}
          {!payloadCollapsed && (
            <div className="divider divider-vertical" onMouseDown={onPayloadDividerMouseDown} />
          )}

          {/* Script column */}
          <div className="script-col">
            <div className="pane-label pane-label--with-action">
              <span className="pane-label-slot" />
              <span className="pane-label-center">Script</span>
              <span className="pane-label-slot pane-label-slot--right">
                <CopyButton getText={() => script} />
              </span>
            </div>
            <Editor
              height="100%"
              defaultLanguage={DW_LANGUAGE_ID}
              theme={editorTheme}
              value={script}
              onChange={(v) => setScript(v ?? "")}
              options={{ fontSize: editorFontSize, minimap: { enabled: false }, scrollBeyondLastLine: false }}
            />
          </div>

          {/* Script / Output divider */}
          {!outputCollapsed && (
            <div className="divider divider-vertical" onMouseDown={onOutputDividerMouseDown} />
          )}

          {/* Output column */}
          <div
            className={`output-col ${outputCollapsed ? "output-col--collapsed" : ""}`}
            style={{ width: outputCollapsed ? 52 : outputWidth, flexShrink: 0 }}
          >
            {outputCollapsed ? (
              <div className="collapsed-strip">
                <button className="collapse-btn" onClick={() => setOutputCollapsed(false)} title="Expand output"><span className="collapse-btn__arrow">‹</span> Show</button>
                <span className="collapsed-label">Output</span>
              </div>
            ) : (
            <div className="pane-label pane-label--with-action">
              <span className="pane-label-slot">
                <button className="collapse-btn" onClick={() => setOutputCollapsed(true)} title="Collapse output"><span className="collapse-btn__arrow">›</span> Hide</button>
              </span>
              <span className="pane-label-center">
                Output <MimeTypeDropdown value={outputMimeType.value} onChange={handleOutputMimeChange} />
              </span>
              <span className="pane-label-slot pane-label-slot--right">
                {showRunning && <span className="running-indicator">{running ? "running…" : "done"}</span>}
                {result?.success && <CopyButton getText={() => String(result.output ?? "")} />}
                {result?.success && <SaveButton getText={() => String(result.output ?? "")} ext={outputMimeType.ext} />}
              </span>
            </div>
            )}

            {!outputCollapsed && <div className="output-body">
              {!isPending && fetchError && (
                <div className="output-section error-section">
                  <div className="section-label">Error</div>
                  <pre className="output-pre">{fetchError}</pre>
                </div>
              )}
              {!isPending && result?.error && (
                <div className="output-section error-section">
                  <div className="section-label">Error</div>
                  <pre className="output-pre">{result.error}</pre>
                  {getErrorHint(result.error) && (
                    <pre className="output-pre output-tip">
                      Tip: {getErrorHint(result.error)}
                    </pre>
                  )}
                </div>
              )}

              {!isPending && result && (
                <div className={`output-section output-section--fill ${result.success ? "success-section" : ""}`}>
                  <Editor
                    height="100%"
                    language={outputMimeType.language}
                    theme={editorTheme}
                    value={result.success ? String(result.output ?? "") : result.stdout || "(no output)"}
                    options={{
                      readOnly: true,
                      fontSize: editorFontSize,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      lineNumbers: "off",
                      folding: false,
                      wordWrap: "on",
                      contextmenu: false,
                      renderLineHighlight: "none",
                    }}
                  />
                </div>
              )}

              {!isPending && !result && !fetchError && (
                <div className="placeholder">Run a script to see output here.</div>
              )}
            </div>}
          </div>

        </div>
      )}

      {activeTab === "flow" && (
        <FlowCanvas
          key={flowKey}
          ref={flowCanvasRef}
          initialState={initialFlow as unknown as FlowCanvasState}
          theme={editorTheme}
          onChange={handleFlowChange}
          onHistoryChange={handleHistoryChange}
        />
      )}

      {activeTab === "notes" && (
        <div className="app-body notes-body">
          <div className="notes-header">
            <span className="pane-label">Notes</span>
            <button
              className={`icon-btn notes-toggle ${notesPreview ? "notes-toggle--active" : ""}`}
              onClick={() => setNotesPreview((p) => !p)}
              title={notesPreview ? "Switch to editor" : "Preview markdown"}
            >
              {notesPreview ? <EditIcon /> : <PreviewIcon />}
              <span>{notesPreview ? "Edit" : "Preview"}</span>
            </button>
          </div>
          {notesPreview ? (
            <div className="notes-preview">
              <ReactMarkdown>{notes || "*No notes yet.*"}</ReactMarkdown>
            </div>
          ) : (
            <Editor
              height="100%"
              language="markdown"
              theme={editorTheme}
              value={notes}
              onChange={(v) => setNotes(v ?? "")}
              options={{ fontSize: editorFontSize, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on" }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PreviewIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
