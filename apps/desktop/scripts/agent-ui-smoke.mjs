import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const defaultRendererDir = path.join(appDir, "dist", "renderer");

const jsChecks = [
  { label: "Agent Builder shell", value: "Agent Builder" },
  { label: "Agent Profile selector", value: "Agent Profile" },
  { label: "Orchestration profiles tab", value: "编排配置" },
  { label: "Presets tab", value: "场景预设" },
  { label: "Evaluation tab", value: "效果评测" },
  { label: "Workflow editor", value: "Workflow Steps" },
  { label: "Workflow run monitor", value: "子代理编排" },
];

const cssChecks = [
  { label: "Evaluation panel styles", value: ".models-evaluation-layout" },
  { label: "Workflow monitor styles", value: ".run-log-workflow" },
  { label: "Billing diagnostics styles", value: ".thread-info-billing-diagnostics" },
];

export function runAgentUiSmoke(input = {}) {
  const rendererDir = input.rendererDir ?? defaultRendererDir;
  const indexPath = path.join(rendererDir, "index.html");
  assertFile(indexPath, "renderer index.html");
  const html = readFileSync(indexPath, "utf8");
  const assetPaths = collectAssetPaths(html);
  if (!html.includes('id="root"')) {
    throw new Error("renderer index.html is missing #root mount point.");
  }
  if (assetPaths.length === 0) {
    throw new Error("renderer index.html does not reference built assets.");
  }

  const assets = assetPaths.map((assetPath) => {
    const filePath = path.join(rendererDir, assetPath.replace(/^(?:\.\/|\/)/, ""));
    assertFile(filePath, assetPath);
    const size = statSync(filePath).size;
    if (size <= 0) {
      throw new Error(`built asset is empty: ${assetPath}`);
    }
    return { assetPath, filePath, size };
  });
  const jsBundle = assets
    .filter((asset) => asset.assetPath.endsWith(".js"))
    .map((asset) => readFileSync(asset.filePath, "utf8"))
    .join("\n");
  const cssBundle = assets
    .filter((asset) => asset.assetPath.endsWith(".css"))
    .map((asset) => readFileSync(asset.filePath, "utf8"))
    .join("\n");
  assertContainsAll(jsBundle, jsChecks, "renderer JavaScript bundle");
  assertContainsAll(cssBundle, cssChecks, "renderer CSS bundle");

  return {
    ok: true,
    rendererDir,
    assetCount: assets.length,
    jsBytes: Buffer.byteLength(jsBundle),
    cssBytes: Buffer.byteLength(cssBundle),
    checkedJs: jsChecks.map((check) => check.label),
    checkedCss: cssChecks.map((check) => check.label),
  };
}

function collectAssetPaths(html) {
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const assetPath = match[1];
    if (assetPath?.startsWith("/assets/") || assetPath?.startsWith("./assets/")) {
      assets.add(assetPath);
    }
  }
  return [...assets].sort();
}

function assertFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`missing ${label}: ${filePath}`);
  }
}

function assertContainsAll(content, checks, label) {
  if (!content.trim()) {
    throw new Error(`${label} is empty.`);
  }
  const missing = checks.filter((check) => !content.includes(check.value));
  if (missing.length > 0) {
    throw new Error(
      `${label} is missing smoke markers: ${missing.map((check) => check.label).join(", ")}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runAgentUiSmoke();
  console.log(`[agent-ui-smoke] ok ${report.assetCount} assets · js ${report.jsBytes} bytes · css ${report.cssBytes} bytes`);
}
