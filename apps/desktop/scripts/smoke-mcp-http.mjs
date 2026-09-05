/**
 * Dev-adjacent smoke: resolve HTTP MCP injections for builtin gateways and
 * hit /mcp initialize + tools/list. Does not spawn Electron stdio wrappers.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ImageViewMcpGateway } from "../src/main/image-view-mcp-gateway.ts";
import { ImageDisplayMcpGateway } from "../src/main/image-display-mcp-gateway.ts";
import { ImageDisplayStore } from "../src/main/image-display-store.ts";
import { BrowserMcpGateway } from "../src/main/browser-mcp-gateway.ts";
import { IntegratedWebSearchMcpGateway } from "../src/main/integrated-web-search-mcp-gateway.ts";

async function hitMcp(label, sdkEntry) {
  const url = String(sdkEntry.url);
  const headers = { "content-type": "application/json", ...(sdkEntry.headers ?? {}) };
  if (sdkEntry.type !== "http") {
    throw new Error(`${label}: expected type=http, got ${String(sdkEntry.type)}`);
  }
  if (!url.includes("/mcp")) {
    throw new Error(`${label}: expected /mcp url, got ${url}`);
  }
  if (sdkEntry.command || sdkEntry.env?.ELECTRON_RUN_AS_NODE) {
    throw new Error(`${label}: still looks like Electron stdio injection`);
  }
  const init = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "eco-smoke", version: "0" },
      },
    }),
  });
  if (init.status !== 200) {
    throw new Error(`${label}: initialize HTTP ${init.status}`);
  }
  const list = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  const body = await list.json();
  const tools = body?.result?.tools?.map((t) => t.name) ?? [];
  console.log(JSON.stringify({ label, url, tools }, null, 0));
  return tools;
}

const closers = [];

const imageView = new ImageViewMcpGateway({ analyze: async () => "smoke-ok" });
closers.push(() => imageView.close());
const viewInj = await imageView.resolveInjection("smoke_view");
await hitMcp("image-view", viewInj.sdkEntry);

const displayStore = new ImageDisplayStore();
const imageDisplay = new ImageDisplayMcpGateway({
  store: displayStore,
  onArtifactChanged: () => {},
});
closers.push(() => imageDisplay.close());
const displayInj = await imageDisplay.resolveInjection("smoke_display");
await hitMcp("image-display", displayInj.sdkEntry);

const browser = new BrowserMcpGateway({
  ensureCdpPort: async () => {
    throw new Error("should not mint CDP during list");
  },
  agentBrowserEnv: () => ({}),
});
closers.push(() => browser.close());
const browserPrep = await browser.prepareThread("smoke_browser");
await hitMcp("browser", browserPrep.sdkEntry);

// web-search only if settings would enable — skip soft if unavailable
try {
  const { IntegratedWebSearchSettingsStore } = await import(
    "../src/main/integrated-web-search-settings-store.ts"
  );
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-ws-smoke-"));
  const store = new IntegratedWebSearchSettingsStore(path.join(dir, "ws.json"));
  // Don't force enable with fake key — just ensure gateway class constructs.
  const web = new IntegratedWebSearchMcpGateway({
    store,
    getApiKey: () => undefined,
  });
  closers.push(() => web.close());
  const inj = await web.resolveInjection({ threadId: "smoke_ws", sessionEnabled: true });
  console.log(JSON.stringify({ label: "web-search", enabled: inj.enabled }, null, 0));
} catch (error) {
  console.log(
    JSON.stringify({
      label: "web-search",
      skipped: true,
      reason: error instanceof Error ? error.message : String(error),
    }),
  );
}

for (const close of closers.reverse()) {
  await close();
}
console.log("SMOKE_OK");
