export interface ProjectMeta {
  version: 2;
  name: string;
  created: string;
  modified: string;
}

export interface ScriptEditorState {
  script: string;
  payload: string;
  inputMimeType: string;
  outputMimeType: string;
}

export interface FlowState {
  flows: object[];
}

export interface ProjectSnapshot {
  timestamp: string;
  scriptEditor: ScriptEditorState;
  flow: FlowState;
}

export const DEFAULT_PROJECT_NAME = "Untitled";
export const MAX_ROLLING_SNAPSHOTS = 10;

export function defaultScriptEditor(): ScriptEditorState {
  return {
    script: "%dw 2.0\noutput application/json\n---\npayload",
    payload: '{\n  "message": "Hello, world!"\n}',
    inputMimeType: "application/json",
    outputMimeType: "application/json",
  };
}

export function defaultFlowState(): FlowState {
  return { flows: [] };
}
