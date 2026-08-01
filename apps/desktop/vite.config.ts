import { cpSync, createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const materialIconsSrc = path.resolve(rootDir, "node_modules/material-icon-theme/icons");

function materialIconsPlugin(): Plugin {
  return {
    name: "eco-material-icons",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/material-icons/")) {
          next();
          return;
        }
        const iconFile = decodeURIComponent(url.slice("/material-icons/".length));
        if (!iconFile || iconFile.includes("..") || iconFile.includes("/") || iconFile.includes("\\")) {
          res.statusCode = 400;
          res.end("Bad request");
          return;
        }
        const filePath = path.join(materialIconsSrc, iconFile);
        if (!existsSync(filePath)) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      if (!existsSync(materialIconsSrc)) {
        throw new Error(`material-icon-theme icons missing at ${materialIconsSrc}`);
      }
      const dest = path.resolve(rootDir, "dist/renderer/material-icons");
      cpSync(materialIconsSrc, dest, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), materialIconsPlugin()],
  root: ".",
  // Relative paths so loadFile(file://...) resolves assets next to index.html in packaged app.
  base: "./",
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
