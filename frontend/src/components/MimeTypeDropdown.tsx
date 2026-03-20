import { useEffect, useRef, useState } from "react";

export interface MimeTypeOption {
  label: string;
  value: string;
  ext: string;
  language: string;
}

export const MIME_TYPES: MimeTypeOption[] = [
  { label: "JSON",        value: "application/json",                      ext: ".json",        language: "json"      },
  { label: "CSV",         value: "text/csv",                              ext: ".csv",         language: "plaintext" },
  { label: "XML",         value: "application/xml",                       ext: ".xml",         language: "xml"       },
  { label: "NDJSON",      value: "application/x-ndjson",                  ext: ".ndjson",      language: "json"      },
  { label: "DWL",         value: "application/dw",                        ext: ".dwl",         language: "plaintext" },
  { label: "XLSX",        value: "application/vnd.ms-excel",              ext: ".xlsx",        language: "plaintext" },
  { label: "TEXT",        value: "text/plain",                            ext: ".txt",         language: "plaintext" },
  { label: "MULTIPART",   value: "multipart/form-data",                   ext: ".multipart",   language: "plaintext" },
  { label: "YAML",        value: "application/yaml",                      ext: ".yaml",        language: "yaml"      },
  { label: "URLENCODED",  value: "application/x-www-form-urlencoded",     ext: ".urlencoded",  language: "plaintext" },
];

interface Props {
  value: string;
  onChange: (option: MimeTypeOption) => void;
}

export default function MimeTypeDropdown({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = MIME_TYPES.find((m) => m.value === value) ?? MIME_TYPES[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="mime-wrapper" ref={ref}>
      <button className="mime-btn" onClick={() => setOpen((v) => !v)}>
        {current.label} <span className="mime-chevron">▾</span>
      </button>
      {open && (
        <div className="mime-dropdown">
          {MIME_TYPES.map((m) => (
            <button
              key={m.value}
              className={`mime-option ${m.value === value ? "mime-option--active" : ""}`}
              onClick={() => { onChange(m); setOpen(false); }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
