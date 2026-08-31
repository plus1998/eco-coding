import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  plugins: [react()],
  root: path.join(desktopRoot, "readme-screenshots"),
  resolve: {
    dedupe: [
      "@lezer/highlight",
      "@lezer/common",
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5199,
    strictPort: true,
    fs: {
      allow: [desktopRoot, path.join(desktopRoot, "../..")],
    },
  },
  build: {
    outDir: path.join(desktopRoot, "dist/readme-screenshots"),
    emptyOutDir: true,
  },
});
