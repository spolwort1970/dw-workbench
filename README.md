# DW Workbench

A local DataWeave workbench with a Mule-style flow simulator. Designed for reasoning about DataWeave scripts and Mule flow logic offline, without needing Anypoint Studio or a running Mule runtime.

---

## What It Is

- **Script Console** — run DataWeave scripts locally against a payload using the DW CLI. Three-panel layout: payload | script | output.
- **Flow Analyzer** — visual left-to-right flow canvas modeled after Anypoint Studio. Drag, configure, and execute Mule-style processor flows. Inspect per-node input/output state. Step through flows in debug mode.
- **Notes** — markdown scratchpad per project.
- **Secure Properties** — encrypt/decrypt MuleSoft secure config values locally (AES/Blowfish/DES/DESede/RC2; CBC/CFB/ECB/OFB; optional random IV). Per-environment keys live in a local, gitignored config — never committed.

## What It Is Not

- A deployable Mule application generator
- A full Anypoint connector library
- A Mule runtime emulator
- A cloud tool — everything runs locally

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Editor | Monaco Editor (with custom DW syntax + themes) |
| Backend | FastAPI (Python) + uvicorn |
| DW Execution | DW CLI (local subprocess, auto-downloaded on first run) |
| Desktop Shell | Electron 31 |
| Persistence | File-based local projects |

---

## Distribution

DW Workbench is a **Windows-only** app (Windows 10/11, x64).

The app builds automatically on every push to `main`. To download the latest version:

1. Visit https://github.com/spolwort1970/dw-workbench/actions
2. Click the most recent **green checkmark** workflow run
3. Scroll to the bottom "Artifacts" section
4. Download `DW-Workbench-Windows`, extract the zip, and run `DW Workbench.exe`

> **Note**: GitHub requires you to be signed in to download workflow artifacts.

To publish a stable download link instead, create a GitHub Release:
- Tag a version (e.g., `v0.1.0`)
- Create a Release from that tag on the [Releases](../../releases) page
- Upload the Windows zip as a release asset
- Share the release URL

On first launch the app automatically downloads the DataWeave CLI from GitHub and stores it locally. Subsequent launches reuse the cached CLI.

### Build from source (optional)

GitHub Actions builds the app automatically, but to build it manually on Windows:

**Requirements**: Node.js 18+, Python 3.11+

```bat
build.bat
```

Output: `electron\dist\DW Workbench-win32-x64\` and `electron\dist\DW-Workbench-win32-x64.zip`.

### Development mode

```bash
# Terminal 1 — Backend
cd backend
.venv\Scripts\uvicorn app.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev   # http://localhost:5173
```

### DW CLI (dev mode)
The DW CLI must be installed and available on `PATH` as `dw`. Download from [MuleSoft](https://docs.mulesoft.com/dataweave/latest/dataweave-cli). In the packaged app it is downloaded automatically.

### Secure Properties config (first-time setup)

The **Secure Properties** tab shells out to the MuleSoft Secure Properties Tool JAR. It needs **Java 17+** and the **JAR**; your own keys are optional.

**Try it right away.** A built-in **Sample (test key)** environment is always in the environment list, so once Java and the JAR are in place you can encrypt and decrypt with no config at all. The sample key ships with the app and is public — anyone can decrypt values made with it — so use it only to try the tool, **never for real secrets**.

1. **Install Java 17+** and make sure `java` is on your `PATH`. On Windows: `winget install EclipseAdoptium.Temurin.17.JDK`, then open a new terminal and check `java -version`. (Anypoint Studio ships its own JDK, but it usually isn't on `PATH`.)
2. **Download the Secure Properties Tool JAR** (Java 17 build, `secure-properties-tool-j17.jar`) from the MuleSoft *Secure Configuration Properties* docs page and save it to **`C:\Tools\`** (or `C:\Mule_Secure_Props\`). The app finds it there automatically; anywhere else, set `jar_path` in your config. If the JAR can't be found, the tab says so.
3. **Optional — add your own keys.** Copy `backend/secure_props_config.example.json` to `secure_props_config.json` in the location below and fill in your per-environment keys (remove any environments you don't use). `jar_path` is optional; use forward slashes or doubled backslashes, since it's JSON. Your environments are listed before the sample one.

| Running | Config location |
|---|---|
| Packaged app | `%APPDATA%\dw-workbench\secure_props_config.json` |
| Dev mode | `backend/secure_props_config.json` (gitignored) |

Restart the app after creating or editing the config.

**Key lengths:** AES needs a 16-, 24-, or 32-character key, DES exactly 8, and DESede 24. Blowfish and RC2 accept a range of lengths. (The sample environment uses a key of the right length for each algorithm.)

The frontend only ever receives environment *names* — key values stay server-side and never touch the repo or the build. In the packaged app, Electron points the backend at the app-data config via `SECURE_PROPS_CONFIG`.

---

## Getting Started

1. **Download and run** the app for your platform (see Distribution section above)
2. On first launch, the DataWeave CLI downloads automatically
3. **Optional: Configure Max AI Assistant**
   - Click the gear icon (⚙️) in the top-right
   - Expand "AI (Max)"
   - Choose a provider:
     - **Claude Code** (recommended at work) — uses your existing Claude Code authentication, no API key needed. Requires the Claude Code CLI (`npm install -g @anthropic-ai/claude-code`), signed in once with `claude auth login`.
     - **Anthropic API** (recommended at home) — enter your API key from https://console.anthropic.com/
   - Click "Test Connection" to verify. If it fails, the real error is shown (for example an expired sign-in).

**If your Claude Code sign-in expires:**

Claude Code sign-ins expire from time to time. When that happens, Max shows the error in the chat and a red bar appears above the input: *"Your Claude Code sign-in has expired."* You don't need to leave the app:

1. Click **Sign in to Claude** in the bar.
2. Your browser opens the Claude sign-in page — sign in there. The bar reads *"Finish signing in in your browser…"* while it waits (up to 5 minutes).
3. When the bar turns green (*"Signed in. Resend your message."*), send your message again.

If sign-in fails, the bar shows why and the button stays so you can retry. If the browser page asks you to paste a code instead of finishing on its own, open a terminal and run `claude auth login` there instead. You can check your status any time with `claude auth status`.

**Using Max:**
- Open the **Max** tab to chat with the AI assistant
- Max sees your current script, payload, output, and errors automatically
- Paste screenshots for OCR text extraction (code, errors, JSON)
- Click **Archive** to summarize and clear the conversation
- Max remembers context across sessions via summaries

---

## Features

### Script Console
- Monaco editor with DataWeave 2.0 syntax highlighting
- Execute DW scripts via local DW CLI
- Selectable input/output MIME types
- Multiple editor themes (VS Dark, Dracula, Nord, Solarized, etc.)
- Copy and save output buttons
- Collapsible panels
- Import/export workspace (stateless sharing)

### Flow Analyzer
**Canvas**
- Left-to-right flow canvas (no third-party graph lib — custom built)
- Multiple flows and subflows on the same canvas
- Drag-and-drop processors from the palette
- Drag to reorder flows; arrow keys to reorder processors within a flow
- Copy/paste processors (Ctrl+C / Ctrl+V)
- Delete processors (Delete key or ×)
- Undo/Redo (Ctrl+Z / Ctrl+Y)
- Flow and subflow naming

**Processors**
| Processor | Category |
|---|---|
| Set Payload | Core |
| Transform Message | Core |
| Set Variable | Core |
| Logger | Core |
| HTTP Request | Core |
| Flow Reference | Core |
| Choice | Scope |
| For Each | Scope |
| Try | Scope |
| On Error Continue | Error Handling |
| On Error Propagate | Error Handling |
| Raise Error | Error Handling |

**For Each — MuleSoft-faithful semantics**
- Configurable collection expression (DW)
- `batchSize` for batch partitioning
- `vars.counter` (1-based)
- `vars.rootMessage` holds original payload/attributes before loop
- Variables set inside the loop persist after each iteration
- Original payload is restored after the loop exits
- Error stops iteration immediately

**Try / Error Handlers**
- On Error Continue — catches error, continues flow
- On Error Propagate — catches error, re-propagates
- Configurable `errorType` matching (ANY or specific type e.g. `MULE:EXPRESSION`)
- Error handlers contain their own processor chains

**Execution**
- Run mode: full flow execution, per-node input/output trace
- Debug mode: step-by-step execution with a slide-out debug panel
  - Step / Continue / Stop controls
  - Live Mule Message view (payload, attributes, variables) at current position
  - DW expression evaluator at any breakpoint
  - Step history list
- Subflow execution via Flow Reference
- Processor badges: ✓ (success), ✓ (skipped, gray), ✗ (error, red)

**Console Panel**
- Slide-out panel between canvas and palette
- Auto-opens on Run or Debug
- Shows all Logger output in execution order, color-coded by level (INFO/WARN/ERROR)
- Pinnable (stays open) or auto-hides on canvas click
- Resizable

**Config / Trace panel (bottom)**
- Click any processor to configure it
- After execution: shows per-node input/output trace alongside config
- Transform Message: multi-output editor (payload, variables, attributes)

### Project Persistence
- File-based local projects (`.json` format)
- Autosave to disk on every change
- localStorage autosave for browser-refresh recovery
- File menu: New, Open, Save, Save As, Recent Projects
- Project holds both Script Console state and Flow Analyzer state

### Secure Properties
- Encrypt or decrypt individual MuleSoft secure config values (string mode)
- Algorithms: AES, Blowfish, DES, DESede, RC2
- Modes: CBC, CFB, ECB, OFB (random-IV toggle; auto-disabled for ECB)
- Environment picker — the matching key is resolved server-side; the UI never sees key values
- Encrypt output is wrapped in the `![...]` marker ready for YAML/properties; decrypt accepts values with or without the brackets
- Runs the MuleSoft Secure Properties Tool JAR locally (requires `java` on `PATH`); keys read from a local gitignored config (see setup above)
- Built-in **Sample (test key)** environment for trying the tool with no config (public key — never for real secrets)

---

## Project File Format

Projects are stored as directories containing:
```
<project-name>/
  project.json     # metadata (name, timestamps)
  flow.json        # Flow Analyzer canvas state
  script.json      # Script Console state
  notes.md         # Notes tab content
```

The `flow.json` structure uses a custom processor tree format — not React Flow nodes/edges. Each `FlowDef` contains an ordered `processors` array; scope processors (Choice, For Each, Try) contain nested processor arrays.

---

## Architecture Notes

- The flow canvas is **custom-built** (not React Flow). Flows are absolutely positioned divs stacked vertically with a ResizeObserver-based restack system.
- Backend execution walks the processor tree recursively via `_run_processor_list`, which handles all scope types (choice, for-each, try) uniformly.
- Debug sessions are managed server-side in `debug_runner.py` with a session ID. Each step call advances one processor and returns the trace + current event.
- DW expressions are evaluated by shelling out to the DW CLI with temp files. The output is raw stdout (no JSON parsing) to preserve DataWeave's duplicate-key behavior.

### Packaged app runtime flow

```
Electron main process
  ├── Resolves DW CLI (config.json → PATH → auto-download)
  ├── Spawns backend/dist/server/server.exe with DW_CLI + DW_PORT env vars
  ├── Polls http://localhost:8000/health (up to 20 s)
  └── Opens BrowserWindow → http://localhost:8000

server.exe (PyInstaller onedir)
  ├── Sets STATIC_DIR = _internal/static  (Vite build)
  └── Runs uvicorn on 127.0.0.1:DW_PORT
        ├── /execute, /flow/run, /debug/*  (API routes, registered first)
        └── /  (StaticFiles, html=True — catches all other routes)
```

The `About DW Workbench` dialog is available from the **Help** menu in the menu bar.

---

## License

DW Workbench is released under the [MIT License](LICENSE). Copyright (c) 2026 Shane Polwort.

The MIT License covers this repository's source code only. The DataWeave CLI that the app downloads and runs is MuleSoft's software and is governed by its own license, as are the MuleSoft Secure Properties Tool JAR and other third-party dependencies.
