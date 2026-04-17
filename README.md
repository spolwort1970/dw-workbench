# DW Workbench

A local DataWeave workbench with a Mule-style flow simulator. Designed for reasoning about DataWeave scripts and Mule flow logic offline, without needing Anypoint Studio or a running Mule runtime.

---

## What It Is

- **Script Console** — run DataWeave scripts locally against a payload using the DW CLI. Three-panel layout: payload | script | output.
- **Flow Analyzer** — visual left-to-right flow canvas modeled after Anypoint Studio. Drag, configure, and execute Mule-style processor flows. Inspect per-node input/output state. Step through flows in debug mode.
- **Notes** — markdown scratchpad per project.

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

### For Surescripts team members

The app builds automatically on every commit. To download the latest version:

1. Visit https://github.com/Surescripts/dw-workbench/actions
2. Click the most recent **green checkmark** workflow run
3. Scroll to the bottom "Artifacts" section
4. Download:
   - **Windows**: `DW-Workbench-Windows` — extract the zip, run `DW Workbench.exe`
   - **macOS**: `DW-Workbench-macOS` — open the DMG, drag to Applications

> **Note**: You must be logged into GitHub with Surescripts repository access to download artifacts.

### For external users

External distribution requires creating a GitHub Release:
- Tag a version (e.g., `v0.1.0`)
- Create a Release from that tag on the [Releases](../../releases) page
- Upload the Windows and macOS builds as release assets
- Share the release URL

On first launch the app automatically downloads the DataWeave CLI from GitHub and stores it locally. Subsequent launches reuse the cached CLI.

### Build from source (optional)

GitHub Actions builds both platforms automatically, but if you need to build manually:

**Requirements**: Node.js 18+, Python 3.11+

**Windows**:
```bat
build.bat
```

**macOS/Linux**:
```bash
# Frontend
cd frontend && npm install && npm run build

# Backend
cd ../backend && pip install -r requirements.txt pyinstaller
python -m PyInstaller --noconfirm server.spec

# Electron
cd ../electron && npm install
npx electron-packager . "DW Workbench" --platform darwin --arch x64 --out dist --overwrite --extra-resource ../backend/dist/server
```

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

---

## Getting Started

1. **Download and run** the app for your platform (see Distribution section above)
2. On first launch, the DataWeave CLI downloads automatically
3. **Optional: Configure Max AI Assistant**
   - Click the gear icon (⚙️) in the top-right
   - Expand "AI (Max)"
   - Choose a provider:
     - **Claude Code** (recommended at work) — uses your existing Claude Code authentication, no API key needed
     - **Anthropic API** (recommended at home) — enter your API key from https://console.anthropic.com/
   - Click "Test Connection" to verify

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
