import { loader } from "@monaco-editor/react";
import { registerDWLanguage } from "./dwLanguage";

export interface ThemeOption {
  id: string;
  label: string;
  builtin?: boolean;
  light?: boolean;
  file?: string;
}

export const THEMES: ThemeOption[] = [
  { id: "vs-dark",         label: "Dark (default)",  builtin: true },
  { id: "vs",              label: "Visual Studio Light", builtin: true, light: true },
  { id: "hc-black",        label: "High Contrast",   builtin: true },
  { id: "dracula",         label: "Dracula",         file: "Dracula.json" },
  { id: "monokai",         label: "Monokai",         file: "Monokai.json" },
  { id: "nord",            label: "Nord",            file: "Nord.json" },
  { id: "cobalt2",         label: "Cobalt2",         file: "Cobalt2.json" },
  { id: "tomorrow-night",  label: "Tomorrow Night",  file: "Tomorrow-Night.json" },
  { id: "solarized-dark",  label: "Solarized Dark",  file: "Solarized-dark.json" },
  { id: "solarized-light", label: "Solarized Light", file: "Solarized-light.json", light: true },
];

const THEME_BG: Record<string, string> = {
  "vs-dark":        "#1e1e1e",
  "vs":             "#ffffff",
  "hc-black":       "#000000",
  "dracula":        "#282a36",
  "monokai":        "#272822",
  "nord":           "#2e3440",
  "cobalt2":        "#193549",
  "tomorrow-night": "#1d1f21",
  "solarized-dark": "#002b36",
  "solarized-light":"#fdf6e3",
};

export function getThemeBg(id: string): string {
  return THEME_BG[id] ?? THEME_BG["vs-dark"];
}

export function isLightTheme(id: string): boolean {
  return THEMES.find((t) => t.id === id)?.light ?? false;
}

// Extra DW token rules injected into every theme
const DW_RULES_DARK = [
  { token: "keyword.separator",       foreground: "6272a4", fontStyle: "bold" },   // --- muted blue-gray
  { token: "keyword.declaration",     foreground: "646cff" },                       // var/fun: purple
  { token: "support.function",        foreground: "e5c07b" },                       // builtins: gold
  { token: "variable.input",          foreground: "e5c07b", fontStyle: "bold" },   // payload/attributes/vars: bold gold
  { token: "variable.declaration",    foreground: "61afef", fontStyle: "bold" },   // var name: bold blue
  { token: "variable.user",           foreground: "61afef" },                       // identifier references: blue
  { token: "string.date",             foreground: "56b6c2" },                       // |date|: cyan
  { token: "string.interp.delimiter", foreground: "e06c75", fontStyle: "bold" },   // $( ): red
  { token: "variable",                foreground: "c678dd" },                       // interp body: purple
];

const DW_RULES_LIGHT = [
  { token: "keyword.separator",       foreground: "0000FF", fontStyle: "bold" },   // ---        : keyword blue
  { token: "keyword.declaration",     foreground: "0000FF" },                       // var/fun    : keyword blue
  { token: "support.function",        foreground: "795E26" },                       // builtins   : function brown
  { token: "variable.input",          foreground: "001080" },                       // payload/attributes/vars: variable navy
  { token: "variable.declaration",    foreground: "001080" },                       // var name   : variable navy
  { token: "variable.user",           foreground: "001080" },                       // identifiers: variable navy
  { token: "string.date",             foreground: "A31515" },                       // |date|     : string red
  { token: "string.interp.delimiter", foreground: "0000FF", fontStyle: "bold" },   // $(  )      : keyword blue
  { token: "variable",                foreground: "001080" },                       // interp body: variable navy
];

function injectRules(data: { rules?: object[] }, light: boolean) {
  const extra = light ? DW_RULES_LIGHT : DW_RULES_DARK;
  data.rules = [...(data.rules ?? []), ...extra];
}

export async function registerThemes(activeTheme: string): Promise<void> {
  const monaco = await loader.init();
  registerDWLanguage(monaco);

  // Redefine built-in themes with extra DW rules
  const builtins: Array<{ id: string; base: "vs-dark" | "vs" | "hc-black"; light?: boolean }> = [
    { id: "vs-dark",  base: "vs-dark" },
    { id: "vs",       base: "vs",      light: true },
    { id: "hc-black", base: "hc-black" },
  ];
  for (const t of builtins) {
    const data = { base: t.base, inherit: true, rules: [] as { token: string; foreground?: string; fontStyle?: string }[], colors: {} };
    injectRules(data, !!t.light);
    monaco.editor.defineTheme(t.id, data);
  }

  // Load and define custom themes with extra DW rules
  const customs = THEMES.filter((t) => t.file);
  await Promise.all(
    customs.map(async (t) => {
      try {
        const res  = await fetch(`/themes/${t.file}`);
        const data = await res.json();
        injectRules(data, !!t.light);
        monaco.editor.defineTheme(t.id, data);
      } catch {
        console.warn(`Failed to load theme: ${t.file}`);
      }
    })
  );

  // Force all editors to re-apply the active theme after rules are injected
  monaco.editor.setTheme(activeTheme);
}
