import { expect, test } from "bun:test";
import fs from "node:fs";
import { INTEGRATION_IDS } from "../src/shared/integrations";

const indexSource = fs.readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
const piSessionSource = fs.readFileSync(
  new URL("../src/main/pi-mcp-session.ts", import.meta.url),
  "utf8",
);

test("INTEGRATION_IDS stays browser and imageGeneration only", () => {
  expect(INTEGRATION_IDS).toEqual(["browser", "imageGeneration"]);
});

test("image view injection is always-on and not an integration switch", () => {
  expect(indexSource).toContain("imageViewGateway.resolveInjection(");
  expect(indexSource).toContain("imageViewGateway.mergeIntoSdkConfig(");
  expect(indexSource).toContain("imageViewGateway.resolveGlobalCodexServer()");
  expect(indexSource).toContain("buildImageViewPromptAppend()");
  expect(indexSource).toContain("imageViewGateway.noteThreadPrompt(");
  expect(indexSource).toContain("ECO_IMAGE_VIEW_MCP_SERVER");
  expect(indexSource).not.toMatch(/integrationEnabled\([^)]*["']imageView["']/);
});

test("Claude MCP merge always includes eco_image_view after image generation", () => {
  const start = indexSource.indexOf("const withImageMcp = imageGenerationGateway.mergeIntoSdkConfig");
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = indexSource.slice(start, start + 1200);
  expect(slice).toContain("imageViewGateway.mergeIntoSdkConfig");
  expect(slice).toContain("ECO_IMAGE_VIEW_MCP_SERVER");
});

test("Pi session builder accepts always-on imageViewInject and excludes user override", () => {
  expect(piSessionSource).toContain("imageViewInject");
  expect(piSessionSource).toContain("ECO_IMAGE_VIEW_MCP_SERVER");
});
