import { useRef } from "react";
import { MIME_TYPES, type MimeTypeOption } from "./MimeTypeDropdown";

// Map file extensions to MIME type options
const EXT_MAP: Record<string, string> = {
  ".json":       "application/json",
  ".xml":        "application/xml",
  ".csv":        "text/csv",
  ".yaml":       "application/yaml",
  ".yml":        "application/yaml",
  ".txt":        "text/plain",
  ".ndjson":     "application/x-ndjson",
  ".dwl":        "application/dw",
  ".urlencoded": "application/x-www-form-urlencoded",
};

const ACCEPT = Object.keys(EXT_MAP).join(",");

interface Props {
  onLoad: (text: string, mimeType: MimeTypeOption) => void;
}

export default function LoadPayloadButton({ onLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = "." + file.name.split(".").pop()!.toLowerCase();
    const mimeValue = EXT_MAP[ext] ?? "text/plain";
    const mimeOption = MIME_TYPES.find((m) => m.value === mimeValue) ?? MIME_TYPES[0];

    const reader = new FileReader();
    reader.onload = () => {
      onLoad(reader.result as string, mimeOption);
      // Reset so the same file can be reloaded if needed
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: "none" }}
        onChange={handleChange}
      />
      <button
        className="icon-btn"
        title="Load payload from file"
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon />
        <span>Load file</span>
      </button>
    </>
  );
}

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
