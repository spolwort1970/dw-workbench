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
import MaxPanel, { MAX_APPLY_CHANNEL, type ApplyFlowsMessage } from "./components/MaxPanel";
import SecurePropertiesPanel from "./components/SecurePropertiesPanel";
import ErrorHintsModal from "./components/ErrorHintsModal";
import MimeTypeDropdown, { MIME_TYPES, type MimeTypeOption } from "./components/MimeTypeDropdown";
import { registerThemes, isLightTheme, getThemeBg } from "./monacoThemes";
import { DW_LANGUAGE_ID } from "./dwLanguage";
import { getErrorHint } from "./errorHints";
import { DialogProvider, useDialog } from "./components/Dialog";
import {
  createProjectIn, openProjectAt, saveProject, listProjects, isProjectDir,
  openRecentLoadProject, autosaveToDisk, autosaveToLocal,
  loadLocalAutosave, getLastFileError, pickWorkspaceFolder,
} from "./services/projectService";
import { addRecentProject, setWorkspaceFolder, resolveWorkspaceFolder, clearLegacyHandleStore } from "./services/recentProjectsService";
import { basename } from "./services/nativeFs";
import { summarizeFlowState } from "./services/flowSummary";
import type { ScriptEdit } from "./services/scriptSpec";
import { DEFAULT_PROJECT_NAME, defaultScriptEditor, defaultFlowState, type ScriptEditorState, type FlowState } from "./types/project";
import type { FlowCanvasState, FlowDef } from "./types/flow";
import "./App.css";

const MIN_COL_WIDTH = 300;
const DEFAULT_COL_FRAC = 0.25;

/** A side column's saved share of the window width, or the default. */
function readColFrac(key: string): number {
  try {
    const v = parseFloat(localStorage.getItem(key) ?? "");
    if (v > 0.05 && v < 0.45) return v;
  } catch { /* non-critical */ }
  return DEFAULT_COL_FRAC;
}
const PAYLOAD_COLLAPSED_WIDTH = 52;

type Tab = "script" | "flow" | "max" | "notes" | "secure";

function StandaloneMax() {
  const [theme, setTheme] = useState(() => localStorage.getItem("dw-theme") ?? "vs-dark");

  // Sync theme when user changes it in the main window (StorageEvent fires cross-window)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "dw-theme" && e.newValue) setTheme(e.newValue);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return (
    <div
      className="app"
      data-theme={isLightTheme(theme) ? "light" : "dark"}
      data-editor-theme={theme}
      style={{ height: "100vh", overflow: "hidden" }}
    >
      <MaxPanel mode="standalone" />
    </div>
  );
}

export default function App() {
  const [theme] = useState(() => localStorage.getItem("dw-theme") ?? "vs-dark");

  // Standalone Max window
  if (window.location.hash === "#max-window") {
    return <StandaloneMax />;
  }

  return (
    <DialogProvider theme={theme}>
      <AppInner />
    </DialogProvider>
  );
}

function AppInner() {
  const { confirm, alert, prompt, select, setDialogTheme } = useDialog();
  const [activeTab, setActiveTab] = useState<Tab>("script");
  const [notesPreview, setNotesPreview] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [maxDetached, setMaxDetached] = useState(false);
  const maxPopupRef = useRef<Window | null>(null);

  // ── Project state ──────────────────────────────────────────────
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [isDirty, setIsDirty] = useState(false);
  const [notes, setNotes] = useState("");
  // Absolute path of the project folder on disk, or null while unsaved.
  const dirPathRef    = useRef<string | null>(null);
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
  // Side columns are sized as a share of the window, not fixed pixels. The first
  // render happens before Electron maximizes the window, so a pixel width taken then
  // would leave the columns sized for the smaller pre-maximize window.
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [payloadFrac, setPayloadFrac] = useState(() => readColFrac("dw-payload-frac"));
  const [payloadCollapsed, setPayloadCollapsed] = useState(false);
  const [outputFrac, setOutputFrac] = useState(() => readColFrac("dw-output-frac"));
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const payloadWidth = Math.max(MIN_COL_WIDTH, Math.floor(windowWidth * payloadFrac));
  const outputWidth = Math.max(MIN_COL_WIDTH, Math.floor(windowWidth * outputFrac));

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

  // ── Workspace folder ───────────────────────────────────────────
  // Projects live inside one folder, defaulting to Documents\DW Workbench. Saves go
  // there and opens list what is already there, so the filesystem never has to be
  // navigated for a project the user already named. "Select Projects Folder…"
  // changes it for anyone who wants it somewhere else.

  /** The workspace path, defaulting to Documents. Null only outside the desktop app. */
  const ensureWorkspace = useCallback(async (): Promise<string | null> => {
    const dir = await resolveWorkspaceFolder();
    if (!dir) {
      await alert(
        "Could not determine where to keep projects.\n\n" +
        "Use File > Select Projects Folder… to choose one.",
        "Projects Folder",
      );
    }
    return dir;
  }, [alert]);

  // ── File menu actions ──────────────────────────────────────────
  const handleNew = useCallback(async () => {
    if (isDirty && !await confirm("Discard unsaved changes and create a new project?", "New Project", "Discard & Continue")) return;
    const workspace = await ensureWorkspace();
    if (!workspace) return;
    const name = await prompt("Project name:", DEFAULT_PROJECT_NAME, "New Project");
    if (!name) return;
    const se = defaultScriptEditor();
    const fl = defaultFlowState();
    const dir = await createProjectIn(workspace, name, se, fl, "");
    if (!dir) {
      const err = getLastFileError();
      if (err) await alert(`Could not create the project folder.\n\n${err}`, "New Project");
      return;
    }
    restoreEditorState(se, fl, "", name);
    dirPathRef.current = dir;
  }, [isDirty, restoreEditorState, ensureWorkspace]);

  const handleOpen = useCallback(async () => {
    if (isDirty && !await confirm("Discard unsaved changes and open a project?", "Open Project", "Discard & Continue")) return;

    const workspace = await ensureWorkspace();
    if (!workspace) return;

    const BROWSE = " browse";
    const projects = await listProjects(workspace);

    let chosen: string | null;
    if (projects.length === 0) {
      const browse = await confirm(
        `No projects found in:\n${workspace}\n\nPick a different folder to look in?`,
        "Open Project", "Browse…",
      );
      chosen = browse ? BROWSE : null;
    } else {
      chosen = await select(
        projects.map((p) => ({
          value:    p.path,
          label:    p.name,
          sublabel: p.modified ? new Date(p.modified).toLocaleString() : "",
        })),
        { title: "Open Project", message: workspace, altLabel: "Browse…", altValue: BROWSE },
      );
    }
    if (!chosen) return;

    let dir = chosen;
    if (chosen === BROWSE) {
      const picked = await (await import("./services/projectService")).pickDirectory("Select Project Folder");
      if (!picked) return;
      if (!await isProjectDir(picked)) {
        await alert("That folder does not contain a DW project (no project.json).", "Open Project");
        return;
      }
      dir = picked;
    }

    const result = await openProjectAt(dir);
    if (!result) {
      const err = getLastFileError();
      await alert(`Could not open the project.\n\n${err ?? "Unknown error."}`, "Open Project");
      return;
    }
    const { loaded, handle } = result;
    if (loaded.autosaveNewer && await confirm("An autosave newer than your last save was found. Restore it?", "Autosave Found", "Restore")) {
      const s = await (await import("./services/projectService")).loadAutosaveFromDisk(handle);
      if (s) {
        restoreEditorState(s.scriptEditor, s.flow, loaded.notes, loaded.meta.name, true);
        dirPathRef.current = handle;
        return;
      }
    }
    restoreEditorState(loaded.scriptEditor, loaded.flow, loaded.notes, loaded.meta.name);
    dirPathRef.current = handle;
  }, [isDirty, restoreEditorState, ensureWorkspace, select]);

  /** Create `<workspace>/<name>/` and adopt it as the current project. */
  const saveIntoWorkspace = useCallback(async (name: string, title: string): Promise<boolean> => {
    const workspace = await ensureWorkspace();
    if (!workspace) return false;
    const dir = await createProjectIn(workspace, name, getScriptEditorState(), getFlowState(), notes, true);
    if (!dir) {
      const err = getLastFileError();
      await alert(`Could not save the project.\n\n${err ?? "Unknown error."}`, title);
      return false;
    }
    dirPathRef.current = dir;
    setProjectName(name);
    setIsDirty(false);
    return true;
  }, [ensureWorkspace, getScriptEditorState, getFlowState, notes, alert]);

  const handleSave = useCallback(async () => {
    if (!dirPathRef.current) {
      // Never saved — ask for a name, then write it straight into the workspace.
      const name = projectName === DEFAULT_PROJECT_NAME
        ? await prompt("Project name:", DEFAULT_PROJECT_NAME, "Save Project")
        : projectName;
      if (!name) return;
      await saveIntoWorkspace(name, "Save Project");
      return;
    }
    const ok = await saveProject(dirPathRef.current, projectName, getScriptEditorState(), getFlowState(), notes);
    if (ok) {
      setIsDirty(false);
    } else {
      const err = getLastFileError();
      await alert(`Could not save the project.\n\n${err ?? "Unknown error."}`, "Save Project");
    }
  }, [projectName, notes, getScriptEditorState, getFlowState, saveIntoWorkspace, alert]);

  const handleSaveAs = useCallback(async () => {
    const name = await prompt("Project name:", projectName, "Save As");
    if (!name) return;
    await saveIntoWorkspace(name, "Save As");
  }, [projectName, saveIntoWorkspace]);

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
    const dir = await pickWorkspaceFolder();
    if (!dir) {
      const err = getLastFileError();
      if (err) await alert(`Could not open the folder picker.\n\n${err}`, "Projects Folder");
      return;  // otherwise the user simply cancelled
    }
    setWorkspaceFolder(dir);
    const found = await listProjects(dir);
    await alert(
      `Projects folder set to "${basename(dir)}".\n\n${dir}\n\n` +
      (found.length
        ? `${found.length} project${found.length === 1 ? "" : "s"} found here.`
        : "No projects here yet — new ones will be saved into this folder."),
      "Projects Folder",
    );
  }, [alert]);

  const handleOpenRecent = useCallback(async (handle: string) => {
    if (isDirty && !await confirm("Discard unsaved changes and open this project?", "Open Project", "Discard & Continue")) return;
    const loaded = await openRecentLoadProject(handle);
    if (!loaded) { await alert("Could not read the project files."); return; }
    if (loaded.autosaveNewer && await confirm("An autosave newer than your last save was found. Restore it?", "Autosave Found", "Restore")) {
      const snap = await (await import("./services/projectService")).loadAutosaveFromDisk(handle);
      if (snap) {
        restoreEditorState(snap.scriptEditor, snap.flow, loaded.notes, loaded.meta.name, true);
        dirPathRef.current = handle;
        addRecentProject({ name: loaded.meta.name, modified: loaded.meta.modified, path: handle });
        return;
      }
    }
    restoreEditorState(loaded.scriptEditor, loaded.flow, loaded.notes, loaded.meta.name);
    dirPathRef.current = handle;
    addRecentProject({ name: loaded.meta.name, modified: loaded.meta.modified, path: handle });
  }, [isDirty, restoreEditorState]);

  /**
   * Everything Max is told about the workspace.
   *
   * The flow canvas has to be summarized here rather than passed raw — the backend
   * inlines `flow_summary` straight into the prompt. Leaving it out was why Max
   * could only ever discuss the Script Console.
   */
  const buildMaxContext = useCallback(() => ({
    script,
    payload: payloadText,
    output: result?.success ? String(result.output ?? "") : undefined,
    error: result?.error || fetchError || undefined,
    flow_summary: summarizeFlowState(flowStateRef.current as unknown as FlowCanvasState),
    project_name: projectName,
  }), [script, payloadText, result, fetchError, projectName, flowVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Broadcast context to Max standalone window
  useEffect(() => {
    const ctx = buildMaxContext();
    const ch = new BroadcastChannel("dw-max-context");
    ch.postMessage(ctx);
    localStorage.setItem("dw-max-context", JSON.stringify(ctx));
    ch.close();
  }, [buildMaxContext]);

  /**
   * Put flows Max designed onto the canvas and show them.
   *
   * FlowCanvas is kept mounted behind display:none, so the ref is live even when
   * the Flow tab isn't showing — the switch is for the user's benefit, not the
   * canvas's.
   */
  const handleApplyFlows = useCallback((flows: FlowDef[], applyMode: "add" | "replace") => {
    const canvas = flowCanvasRef.current;
    if (!canvas || !flows.length) return;
    if (applyMode === "replace") canvas.replaceFlows(flows);
    else canvas.addFlows(flows);
  }, []);

  /**
   * Apply a Script Console edit Max wrote. Mirrors handleApplyFlows: same review
   * step, same tab switch. Every field is optional, so Max can change just the
   * payload without having to restate the script.
   */
  const handleApplyScript = useCallback((edit: ScriptEdit) => {
    if (edit.script !== undefined) setScript(edit.script);
    if (edit.payload !== undefined) setPayloadText(edit.payload);
    if (edit.inputMimeType) {
      const m = MIME_TYPES.find((x) => x.value === edit.inputMimeType);
      if (m) setPayloadMimeType(m);
    }
    if (edit.outputMimeType) {
      const m = MIME_TYPES.find((x) => x.value === edit.outputMimeType);
      if (m) setOutputMimeType(m);
    }
  }, []);

  // The popped-out Max window has no canvas or editor, so it posts edits back here.
  useEffect(() => {
    const ch = new BroadcastChannel(MAX_APPLY_CHANNEL);
    ch.onmessage = (e) => {
      const msg = e.data as (ApplyFlowsMessage & { scriptEdit?: ScriptEdit }) | undefined;
      if (msg?.flows?.length) handleApplyFlows(msg.flows, msg.mode === "replace" ? "replace" : "add");
      else if (msg?.scriptEdit) handleApplyScript(msg.scriptEdit);
    };
    return () => ch.close();
  }, [handleApplyFlows, handleApplyScript]);

  // Pop-out Max window
  const handleMaxPopOut = useCallback(() => {
    const popup = window.open(
      `${window.location.origin}/#max-window`,
      "dw-max-window",
      "width=640,height=820,menubar=no,toolbar=no"
    );
    if (popup) {
      maxPopupRef.current = popup;
      setMaxDetached(true);
      setActiveTab("script");
    }
  }, []);

  // Poll for popup close
  useEffect(() => {
    if (!maxDetached) return;
    const interval = setInterval(() => {
      if (maxPopupRef.current?.closed) {
        setMaxDetached(false);
        maxPopupRef.current = null;
      }
    }, 500);
    return () => clearInterval(interval);
  }, [maxDetached]);

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
    const timer = setTimeout(() => autosaveToLocal(se, fl, notes, projectName), 600);
    return () => clearTimeout(timer);
  }, [script, payloadText, payloadMimeType, outputMimeType, notes, projectName, flowVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush the pending autosave when the window closes or is hidden. Without this the
  // debounce timer is simply destroyed with the renderer, so anything changed in the
  // last moments before quitting — a flow dropped and then closed — was never written.
  const flushAutosave = useCallback(() => {
    try {
      autosaveToLocal(getScriptEditorState(), getFlowState(), notes, projectName);
    } catch { /* nothing useful to do while unloading */ }
  }, [getScriptEditorState, getFlowState, notes, projectName]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") flushAutosave(); };
    window.addEventListener("beforeunload", flushAutosave);
    window.addEventListener("pagehide", flushAutosave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flushAutosave);
      window.removeEventListener("pagehide", flushAutosave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushAutosave]);

  // Disk autosave for saved projects (5-minute debounce)
  useEffect(() => {
    if (!dirPathRef.current) return;
    const se = getScriptEditorState();
    const fl = getFlowState();
    const timer = setTimeout(() => autosaveToDisk(dirPathRef.current!, se, fl), 300_000);
    return () => clearTimeout(timer);
  }, [script, payloadText, payloadMimeType, outputMimeType, notes, flowVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recent projects and the workspace folder are plain paths in localStorage now;
  // drop the old IndexedDB of directory handles so it stops prompting on restart.
  useEffect(() => { clearLegacyHandleStore(); }, []);

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
    let frac = payloadFrac;
    const onMove = (me: MouseEvent) => {
      const delta = me.clientX - startX;
      frac = Math.max(MIN_COL_WIDTH, startWidth + delta) / window.innerWidth;
      setPayloadFrac(frac);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try { localStorage.setItem("dw-payload-frac", String(frac)); } catch { /* non-critical */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [payloadWidth, payloadFrac]);

  // Drag: script <-> output divider
  const onOutputDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = outputWidth;
    let frac = outputFrac;
    const onMove = (me: MouseEvent) => {
      const delta = startX - me.clientX;
      frac = Math.max(MIN_COL_WIDTH, startWidth + delta) / window.innerWidth;
      setOutputFrac(frac);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try { localStorage.setItem("dw-output-frac", String(frac)); } catch { /* non-critical */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [outputWidth, outputFrac]);

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
          <SettingsDropdown theme={editorTheme} onThemeChange={handleThemeChange} fontSize={editorFontSize} onFontSizeChange={handleFontSizeChange} onOpenHints={() => setHintsOpen(true)} />
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
          className={`tab ${activeTab === "max" ? "tab--active" : ""} ${maxDetached ? "tab--detached" : ""}`}
          onClick={() => maxDetached ? maxPopupRef.current?.focus() : setActiveTab("max")}
          title={maxDetached ? "Max is open in its own window — click to focus it" : "AI assistant for DataWeave and MuleSoft"}
        >
          Max{maxDetached ? " ↗" : ""}
        </button>
        <button
          className={`tab ${activeTab === "notes" ? "tab--active" : ""}`}
          onClick={() => setActiveTab("notes")}
          title="Supports Markdown preview. Great for documenting transformation intent and providing context to AI assistants."
        >
          Notes
        </button>
        <button
          className={`tab ${activeTab === "secure" ? "tab--active" : ""}`}
          onClick={() => setActiveTab("secure")}
          title="Encrypt and decrypt MuleSoft secure property values locally, using per-environment keys held on this machine."
        >
          Secure Properties
        </button>
        <button
          className="tab tab--about"
          onClick={() => alert(
            "DW Workbench v0.1.0\n\nA visual DataWeave script builder and flow analysis tool with debugging for MuleSoft API development. No IDE is required for use.\n\nIncludes a Secure Properties utility tab for encrypting and decrypting MuleSoft secure configuration values locally, using the MuleSoft Secure Properties JAR (requires Java 17+).\n\nBuilt with Electron, React, FastAPI, and Monaco Editor.\n\nMax AI assistant powered by Claude (Anthropic). Screenshot OCR via tesseract.js.\n\nAvailable for Windows.\n\nDesigned and built by Shane Polwort with help from Claude Code (Anthropic)\n\nDataWeave CLI © MuleSoft, a Salesforce company.\n\n© 2026 Shane Polwort. Released under the MIT License.",
            "About DW Workbench"
          )}
          title="About DW Workbench"
        >
          About
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

      {/* Kept mounted across tab switches. Unmounting threw away the live canvas
          state and remounted from `initialFlow`, which is only refreshed when a
          project loads — so leaving the tab and coming back showed an empty
          canvas and then overwrote the saved flows with it. */}
      <div
        className="flow-tab-host"
        style={{ flex: 1, minHeight: 0, display: activeTab === "flow" ? "flex" : "none" }}
      >
        <FlowCanvas
          key={flowKey}
          ref={flowCanvasRef}
          initialState={initialFlow as unknown as FlowCanvasState}
          theme={editorTheme}
          onChange={handleFlowChange}
          onHistoryChange={handleHistoryChange}
        />
      </div>

      {activeTab === "max" && !maxDetached && (
        <MaxPanel
          mode="tab"
          context={buildMaxContext()}
          onPopOut={handleMaxPopOut}
          onApplyFlows={handleApplyFlows}
          onApplyScript={handleApplyScript}
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

      {activeTab === "secure" && <SecurePropertiesPanel />}

      {hintsOpen && <ErrorHintsModal onClose={() => setHintsOpen(false)} />}
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
