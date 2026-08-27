import { MIME_TYPES } from "../components/MimeTypeDropdown";

// Parses a ```dwscript block written by Max into a Script Console edit.
//
// Companion to flowSpec.ts, which does the same for the Flow Analyzer. Between
// them Max can change either half of the workspace it can already read, rather
// than describing a change and leaving the user to retype it.

export interface ScriptEdit {
  script?:         string;
  payload?:        string;
  inputMimeType?:  string;
  outputMimeType?: string;
}

export interface DwScriptBlock {
  index:  number;
  /** Stable hash of the block body, so "already applied" survives a remount. */
  key:    string;
  edit:   ScriptEdit;
  /** Human-readable list of what this block changes, for the apply card. */
  changes: string[];
  errors: string[];
  parseError?: string;
}

function blockKey(body: string): string {
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Resolve a mime type loosely — Max may write "json" or "JSON" rather than the
 * full media type, and rejecting that would be pedantry rather than safety.
 */
function resolveMime(raw: any, errors: string[], field: string): string | undefined {
  if (raw == null) return undefined;
  const want = String(raw).trim().toLowerCase();
  const hit = MIME_TYPES.find(
    (m) => m.value.toLowerCase() === want
        || m.label.toLowerCase() === want
        || m.ext.replace(".", "") === want,
  );
  if (!hit) {
    errors.push(`${field}: unknown mime type "${raw}" — left unchanged`);
    return undefined;
  }
  return hit.value;
}

export function editFromSpec(spec: any): { edit: ScriptEdit; changes: string[]; errors: string[] } {
  const errors: string[] = [];
  const changes: string[] = [];
  const edit: ScriptEdit = {};

  if (spec == null || typeof spec !== "object") {
    return { edit, changes, errors: ["spec must be a JSON object"] };
  }

  if (typeof spec.script === "string") { edit.script = spec.script; changes.push("script"); }
  if (typeof spec.payload === "string") { edit.payload = spec.payload; changes.push("payload"); }

  const input = resolveMime(spec.inputMimeType ?? spec.input_mime_type, errors, "inputMimeType");
  if (input) { edit.inputMimeType = input; changes.push(`input ${input}`); }

  const output = resolveMime(spec.outputMimeType ?? spec.output_mime_type, errors, "outputMimeType");
  if (output) { edit.outputMimeType = output; changes.push(`output ${output}`); }

  if (changes.length === 0 && errors.length === 0) {
    errors.push("nothing to apply — expected script, payload, inputMimeType or outputMimeType");
  }
  return { edit, changes, errors };
}

const FENCE_RE = /```dwscript\s*\n([\s\S]*?)(?:```|$)/g;

/** Extract every ```dwscript block from an assistant message. */
export function extractDwScriptBlocks(text: string): DwScriptBlock[] {
  if (!text || !text.includes("```dwscript")) return [];
  const blocks: DwScriptBlock[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    const body = m[1].trim();
    const index = i++;
    if (!body) continue;
    try {
      const parsed = JSON.parse(body);
      const { edit, changes, errors } = editFromSpec(parsed);
      blocks.push({ index, key: blockKey(body), edit, changes, errors });
    } catch (e: any) {
      // An unterminated fence is still streaming in — not an error yet.
      if (m[0].trimEnd().endsWith("```")) {
        blocks.push({
          index, key: blockKey(body), edit: {}, changes: [], errors: [],
          parseError: e?.message ?? "invalid JSON",
        });
      }
    }
  }
  return blocks;
}

/** Hide dwscript blocks from the prose — the apply card stands in for them. */
export function stripDwScriptBlocks(text: string): string {
  return text.replace(/```dwscript\s*\n[\s\S]*?(?:```|$)/g, "").trim();
}
