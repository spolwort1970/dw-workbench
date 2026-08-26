import { createContext, useCallback, useContext, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type DialogType = "alert" | "confirm" | "prompt" | "select";

export interface SelectItem {
  value:     string;
  label:     string;
  sublabel?: string;
}

export interface SelectOptions {
  title?:    string;
  message?:  string;
  /** Secondary button, e.g. "Browse…" — resolves to `altValue`. */
  altLabel?: string;
  altValue?: string;
}

interface DialogState {
  type: DialogType;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  defaultValue: string;
  items: SelectItem[];
  altLabel: string;
  altValue: string;
  resolve: (value: any) => void;
}

interface DialogContextValue {
  alert:          (message: string, title?: string) => Promise<void>;
  confirm:        (message: string, title?: string, confirmLabel?: string) => Promise<boolean>;
  prompt:         (message: string, defaultValue?: string, title?: string) => Promise<string | null>;
  /** Pick one item from a list. Resolves to its value, `altValue`, or null if cancelled. */
  select:         (items: SelectItem[], opts?: SelectOptions) => Promise<string | null>;
  setDialogTheme: (theme: string) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used inside DialogProvider");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function DialogProvider({ children, theme = "vs-dark" }: { children: React.ReactNode; theme?: string }) {
  const [dialog, setDialog]       = useState<DialogState | null>(null);
  const [activeTheme, setActiveTheme] = useState(theme);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(<T,>(state: Omit<DialogState, "resolve">): Promise<T> =>
    new Promise((resolve) => setDialog({ ...state, resolve })),
  []);

  const close = useCallback((value: any) => {
    dialog?.resolve(value);
    setDialog(null);
  }, [dialog]);

  const base = { items: [] as SelectItem[], altLabel: "", altValue: "" };

  const ctx: DialogContextValue = {
    alert: (message, title = "Notice") =>
      open({ ...base, type: "alert", title, message, confirmLabel: "OK", cancelLabel: "", defaultValue: "" }),
    confirm: (message, title = "Confirm", confirmLabel = "OK") =>
      open({ ...base, type: "confirm", title, message, confirmLabel, cancelLabel: "Cancel", defaultValue: "" }),
    prompt: (message, defaultValue = "", title = "Input") =>
      open({ ...base, type: "prompt", title, message, confirmLabel: "OK", cancelLabel: "Cancel", defaultValue }),
    select: (items, opts = {}) =>
      open({
        ...base,
        type: "select",
        title:   opts.title   ?? "Select",
        message: opts.message ?? "",
        confirmLabel: "",
        cancelLabel:  "Cancel",
        defaultValue: "",
        items,
        altLabel: opts.altLabel ?? "",
        altValue: opts.altValue ?? "",
      }),
    setDialogTheme: setActiveTheme,
  };

  const handleConfirm = () => {
    if (dialog?.type === "prompt") {
      close(inputRef.current?.value ?? "");
    } else if (dialog?.type === "confirm") {
      close(true);
    } else {
      close(undefined);
    }
  };

  const handleCancel = () => {
    if (dialog?.type === "prompt" || dialog?.type === "select") close(null);
    else close(false);
  };

  // Close on backdrop click — but not for prompts (user must act explicitly)
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && dialog?.type !== "prompt") handleCancel();
  };

  // Submit prompt on Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") handleCancel();
  };

  return (
    <DialogContext.Provider value={ctx}>
      {children}
      {dialog && (
        <div className="dialog-backdrop" data-theme={activeTheme} onClick={handleBackdrop} onKeyDown={handleKeyDown}>
          <div className="dialog-box" role="dialog" aria-modal>
            <div className="dialog-title">{dialog.title}</div>
            <div className="dialog-message">{dialog.message}</div>

            {dialog.type === "prompt" && (
              <input
                ref={inputRef}
                className="dialog-input"
                defaultValue={dialog.defaultValue}
                autoFocus
                onKeyDown={handleKeyDown}
              />
            )}

            {dialog.type === "select" && (
              <div className="dialog-list">
                {dialog.items.map((item) => (
                  <button
                    key={item.value}
                    className="dialog-list-item"
                    title={item.value}
                    onClick={() => close(item.value)}
                  >
                    <span className="dialog-list-label">{item.label}</span>
                    {item.sublabel && <span className="dialog-list-sublabel">{item.sublabel}</span>}
                  </button>
                ))}
              </div>
            )}

            <div className="dialog-actions">
              {dialog.cancelLabel && (
                <button className="dialog-btn dialog-btn--cancel" onClick={handleCancel}>
                  {dialog.cancelLabel}
                </button>
              )}
              {dialog.altLabel && (
                <button className="dialog-btn dialog-btn--cancel" onClick={() => close(dialog.altValue)}>
                  {dialog.altLabel}
                </button>
              )}
              {dialog.confirmLabel && (
                <button className="dialog-btn dialog-btn--confirm" onClick={handleConfirm} autoFocus={dialog.type !== "prompt"}>
                  {dialog.confirmLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
