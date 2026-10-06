import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Version shown in the About dialog: the release workflow passes DW_VERSION;
// local and dev builds fall back to the Electron package version.
const electronPkg = JSON.parse(readFileSync(new URL("../electron/package.json", import.meta.url), "utf-8"));
const appVersion = process.env.DW_VERSION || electronPkg.version;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 5173,
  },
});
