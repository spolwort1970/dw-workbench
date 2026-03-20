# DW Workbench / WeaveFlow — Build Spec for Claude Code

> **Implementation Status (as of 2026-03-19):** All phases below are complete. See the [README](../../README.md) for current feature documentation. This document is preserved as the original design spec. Deviations from the spec are noted inline.

---

## Implemented Processors (current)
`set-payload` · `transform` · `set-variable` · `logger` · `flow-reference` · `choice` · `for-each` · `try` · `on-error-continue` · `on-error-propagate` · `raise-error`

## Key Deviations from Original Spec
- **React Flow was not used.** The flow canvas is custom-built with absolutely positioned React divs and a ResizeObserver restack system. This gave more control over the Anypoint Studio visual style.
- **Palette is on the RIGHT**, not left (corrected from spec during early development to match Anypoint Studio).
- **Bottom panel is config + trace**, not a log/debug output panel. Logger output goes to a dedicated slide-out Console Panel.
- **Console Panel** — a resizable, pinnable slide-out panel between the canvas and palette that shows Logger output after each run/debug session.
- **Debug panel** — a separate slide-out on the right edge with step/continue/stop controls, live Mule Message inspector, and an inline DW expression evaluator.
- **Multiple flows and subflows** are supported on a single canvas.
- **For Each** is fully implemented with MuleSoft-faithful semantics (batchSize, rootMessage, payload restore, variable persistence across iterations).
- **Try/Error Handlers** are fully implemented with type-matching (ANY or specific error type).
- **Project persistence** uses localStorage autosave for browser-refresh recovery in addition to file-based disk autosave.

---

## Product Intent
Build a **local DataWeave workbench** with persistent projects and a **left-to-right Mule-style flow simulator** for reasoning about DataWeave and simplified Mule processor logic.

This is **not** a Mule runtime, **not** an API builder, and **not** a full Anypoint Studio clone.

It **is** a developer tool for:
- experimenting with DataWeave locally using the **DW CLI**
- saving work automatically so scripts are not lost on reboot/crash
- simulating Mule-style flow logic visually
- stepping through processor state like a lightweight debug experience
- reasoning about payload/vars changes before building a real flow in Studio

---

## Product Name
Working names:
- **DW Workbench**
- **WeaveFlow**

Use either internally; `dw-workbench` is fine as the repo/app name.

---

## Core Scope
### v1 goals
1. Execute DW scripts locally through the **DW CLI**
2. Persist projects locally with autosave + crash recovery
3. Provide a **left-to-right flow canvas**
4. Support a small set of simplified Mule-style processors
5. Allow clicking any processor to inspect **input state** and **output state**
6. Preserve Mule terminology and behavior as closely as practical

### explicit non-goals
- no deployable Mule app generation
- no full connector support
- no real HTTP listener/request execution
- no full Mule runtime emulation
- no full policy/error handling model
- no top-to-bottom Salesforce-style canvas

---

## Recommended Stack
### Frontend
- React
- TypeScript
- Vite
- Monaco Editor
- React Flow

### Backend
- FastAPI
- Python
- local shell execution of **DW CLI**

### Persistence
Use **file-based local projects** for v1, not a database.

---

## Recommended Repo Structure
```text
dw-workbench/
  frontend/
  backend/
  projects/
```

### Frontend suggested structure
```text
frontend/
  src/
    app/
    components/
      canvas/
      editors/
      inspector/
      panels/
    types/
    services/
    state/
```

### Backend suggested structure
```text
backend/
  app/
    main.py
    api/
    services/
    models/
    utils/
  projects/
```

---

## UI Layout
### Main layout
- **Left panel**: processor palette
- **Center panel**: left-to-right flow canvas
- **Right panel**: selected processor configuration
- **Bottom panel**: execution/debug output

### Left panel processor palette (v1)
- Input
- Transform Message
- Set Payload
- Set Variable
- Logger
- Choice
- For Each
- Output

### Center canvas
- left-to-right only
- drag/drop processors
- connect processors visually
- allow container processors for `Choice` and `For Each`
- visually echo Studio’s flow mindset, but do not attempt a pixel clone

### Right config panel
When a node is selected, show:
- processor label/name
- processor-specific configuration
- DataWeave editor where applicable
- condition editor for `Choice`
- collection expression for `For Each`

### Bottom debug/output panel
Show:
- final payload
- vars
- attributes
- logs
- errors
- selected-node **input event**
- selected-node **output event**

This should feel like a lightweight debug/step-through view.

---

## Event Model
Use a simplified Mule-event-like model.

```ts
type SimEvent = {
  payload: unknown
  attributes: Record<string, unknown>
  vars: Record<string, unknown>
}
```

Optional internal metadata can exist, but visible terminology should stay Mule-like:
- `payload`
- `attributes`
- `vars`

Do **not** invent alternate visible names for payload inside scopes.

---

## Processor Fidelity Rule
Visible terminology and behavior should match MuleSoft Studio as closely as practical.

Internal implementation can differ, but the user-facing mental model must feel like Mule.

---

## v1 Processor List + Behavior

### 1. Input
Purpose:
- define starting event state

Config:
- payload editor
- input MIME type
- optional attributes editor
- optional vars editor

Behavior:
- creates initial `SimEvent`

---

### 2. Transform Message
Purpose:
- run DW against the current event

Config:
- DataWeave script
- input type / output type if needed
- optional metadata

Behavior:
- execute DW using current event context
- by default, output becomes the new `payload`

For v1, treat this primarily as:
- input event -> DW execution -> output payload

---

### 3. Set Payload
Purpose:
- set `payload` using DW or literal content

Config:
- mode: literal or DataWeave
- value/script

Behavior:
- evaluate config
- assign result to `event.payload`

---

### 4. Set Variable
Purpose:
- set `vars.<name>`

Config:
- variable name
- mode: literal or DataWeave
- value/script

Behavior:
- evaluate config
- assign result to `event.vars[name]`

---

### 5. Logger
Purpose:
- inspect/log event state

Config:
- optional message template
- selectable fields to display (`payload`, `vars`, `attributes`)

Behavior:
- no meaningful mutation by default
- append entry to execution log

---

### 6. Choice
Purpose:
- route event by ordered conditions

Config:
- ordered list of when branches
- optional otherwise branch
- each condition is a DW boolean expression
- each branch contains child processors

Behavior:
- evaluate conditions in order
- execute first matching branch
- else execute otherwise if present
- no parallel behavior

Implementation note:
`Choice` is a **container processor**, not a flat linear node.

---

### 7. For Each
Purpose:
- simulate Mule Studio `for-each` scope behavior

Config:
- collection expression (DW)
- child processors

Behavior requirements:
- **no aggregator behavior**
- visible terminology must mirror Mule
- inside each iteration, the current item should be called **`payload`**
- `vars.counter` must be available
- when the scope exits, the outer/original payload must be restored
- scope should feel like Studio, not a generic map helper

#### Correct `For Each` semantics for this simulator
Outside scope:
- `payload` = outer/original payload

On entering scope:
- save outer/original payload
- save outer vars baseline as needed

For each item:
- set current iteration item as **`payload`**
- set `vars.counter`
- execute child processors
- variables may be set inside the iteration

On exiting scope:
- restore original outer payload
- preserve variable behavior as close to Studio as practical

#### Important notes
- Do **not** introduce custom visible names like `loop.currentItem`
- Do **not** introduce aggregation
- The tool should teach Studio-like instincts

#### Variable handling note
The simulator must respect that variables can be set inside a `for-each`, and developers may rely on Studio-like behavior.

At minimum:
- preserve `vars.counter`
- avoid inventing fake accumulator semantics
- preserve fidelity over convenience

If exact Mule variable behavior needs approximation, document it clearly and keep it conservative.

---

### 8. Output
Purpose:
- mark/display final event state

Behavior:
- no mutation required
- simply surfaces final event snapshot

---

## Container Processor Requirements
Both `Choice` and `For Each` must support nested child processors.

Example shape:
```text
Input -> Transform -> Choice
                      ├─ when A -> Set Variable -> Output
                      └─ otherwise -> For Each -> Transform -> Logger
```

This means the flow model must support:
- linear processors
- container processors with nested child chains

---

## Execution Model
### High-level
The backend should own flow execution for v1.

Execution steps:
1. Load project flow definition
2. Build initial `SimEvent`
3. Walk the flow from left to right
4. For each processor:
   - capture **input snapshot**
   - execute processor behavior
   - capture **output snapshot**
5. Return:
   - final event
   - logs
   - errors
   - per-node execution snapshots

### Important output
Per node, store:
- node id
- node type
- input event snapshot
- output event snapshot
- logs/errors

This enables click-to-inspect debug behavior in the UI.

---

## DataWeave Execution Model
Use the **DW CLI** as the local execution engine.

### Backend flow
1. Receive execute request
2. Write temp files as needed
3. Invoke DW CLI
4. Capture stdout / stderr / exit status
5. Parse and return result to frontend

### Suggested endpoint
`POST /execute-dw`

Request:
```json
{
  "script": "%dw 2.0\noutput application/json\n---\npayload",
  "payload": {"hello": "world"},
  "attributes": {},
  "vars": {}
}
```

Response:
```json
{
  "success": true,
  "output": {"hello": "world"},
  "stdout": "...",
  "stderr": ""
}
```

### Flow execution endpoint
`POST /simulate-flow`

Request:
- project id or full flow JSON
- initial event
- full node graph

Response:
- final event
- execution trace per node
- logs
- errors

---

## Project Persistence
Use file-based local projects.

### Suggested structure
```text
projects/
  my-transform-project/
    project.json
    flow.json
    input.json
    attributes.json
    vars.json
    notes.md
    snapshots/
```

### `project.json` suggested fields
```json
{
  "id": "my-transform-project",
  "name": "My Transform Project",
  "createdAt": "2026-03-17T00:00:00Z",
  "updatedAt": "2026-03-17T00:00:00Z",
  "lastOpenedAt": "2026-03-17T00:00:00Z"
}
```

### `flow.json`
Should contain:
- node list
- edge list
- node configs
- layout positions

---

## Autosave + Recovery
This is a first-class feature.

### Required behavior
- autosave on edit debounce
- autosave on major config changes
- restore last project state on reopen
- recover unsaved work after crash/reboot

### Suggested implementation
- periodic autosave every few seconds
- rolling snapshot copies in `snapshots/`
- on startup, detect recoverable dirty state and prompt restore

This directly solves the current DW playground pain point:
> losing work after reboot/crash if it was not exported

---

## Flow JSON Model (Suggested)
At minimum:
```json
{
  "nodes": [
    {
      "id": "node-1",
      "type": "input",
      "position": { "x": 0, "y": 0 },
      "config": {}
    }
  ],
  "edges": [
    {
      "source": "node-1",
      "target": "node-2"
    }
  ]
}
```

Container nodes like `choice` and `for-each` may need nested branch/subflow definitions.
Choose a practical structure, but it must support nested processor chains.

---

## UX Requirements
### Must-have UX traits
- left-to-right flow orientation
- processor naming that feels like Studio
- drag/drop interaction
- node click inspection
- editable DW in node config
- easy payload visibility at each step

### Debug/inspection behavior
Clicking a processor should show:
- input event state
- output event state
- processor config
- any logs/errors

This is one of the most important features because it mimics why developers use Studio debug mode:
to inspect state at a given point in the flow.

---

## Suggested Build Sequence
### Phase 1 — foundation
- repo scaffold
- FastAPI backend
- React frontend
- Monaco editors
- `POST /execute-dw`
- manual run of one DW script against one payload

### Phase 2 — persistence
- local project creation
- save/load project
- autosave
- crash recovery

### Phase 3 — flow canvas
- React Flow canvas
- drag/drop nodes
- left-to-right layout
- node config panel

### Phase 4 — processor engine
Implement processor execution for:
- Input
- Transform Message
- Set Payload
- Set Variable
- Logger
- Output

### Phase 5 — container processors
Implement:
- Choice
- For Each

### Phase 6 — debug trace
- per-node input/output snapshots
- node inspection panel
- logs/errors per node

---

## Architecture Guidance
### Keep this project separate from GUIDE_
Different repo.
Different purpose.

### Do not overbuild
This is a reasoning tool, not a full Mule simulator.

### Preserve Mule fidelity where it matters
Especially:
- naming
- payload behavior
- `vars.counter`
- no fake `for-each` aggregation
- left-to-right flow mental model

---

## Acceptance Criteria for v1
A user can:
1. Create a local project
2. Enter input payload
3. Add a simple flow:
   - Input -> Transform Message -> Logger -> Output
4. Run the flow locally using the DW CLI
5. Save and reopen the project
6. Recover work after an unexpected shutdown
7. Click each processor and inspect input/output event state

### Stretch criteria
- add `Choice`
- add `For Each` with Mule-like semantics
- inspect branch execution and iteration behavior

---

## Instruction to Claude Code
Please implement this as a **small, clean, staged build**, not an over-engineered platform.

Priorities:
1. correctness
2. Mule-like mental model
3. persistence
4. debuggability
5. UI polish second

Do not invent extra semantics that differ from Mule unless absolutely necessary.
If approximation is required, keep it minimal and document it clearly.
