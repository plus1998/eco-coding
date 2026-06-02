import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      external: ["@anthropic-ai/claude-agent-sdk", "electron"],
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
