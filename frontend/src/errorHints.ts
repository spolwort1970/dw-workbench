const LS_KEY = "dw-error-hints";

export interface CustomHint {
  pattern: string; // stored as plain string; matched case-insensitively as substring
  tip: string;
}

// Built-in hints (shipped with the app, read-only)
export const BUILTIN_HINTS: CustomHint[] = [
  {
    pattern: "unable to write|Cannot coerce",
    tip: 'Try using write(payload, "application/json") to serialize the value first.',
  },
];

export function loadCustomHints(): CustomHint[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveCustomHints(hints: CustomHint[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(hints));
}

export function getErrorHint(error: string): string | null {
  const allHints = [...BUILTIN_HINTS, ...loadCustomHints()];
  for (const h of allHints) {
    try {
      if (new RegExp(h.pattern, "i").test(error)) return h.tip;
    } catch {
      // invalid regex from user input — fall back to substring match
      if (error.toLowerCase().includes(h.pattern.toLowerCase())) return h.tip;
    }
  }
  return null;
}
