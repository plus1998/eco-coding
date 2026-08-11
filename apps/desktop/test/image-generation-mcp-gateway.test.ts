import { expect, test } from "bun:test";
import { ImageGenerationMcpGateway } from "../src/main/image-generation-mcp-gateway";
import { ECO_IMAGE_GENERATION_MCP_SERVER } from "../src/shared/image-generation";

test("global image generation Codex server starts once and has a stable definition", async () => {
  const gateway = new ImageGenerationMcpGateway({
    store: { getSettings: () => ({ enabled: true }) } as never,
    resolveWorkspacePath: () => undefined,
    resolveGenerationRoot: () => undefined,
    onArtifactChanged: () => undefined,
  });
  try {
    const first = await gateway.resolveGlobalCodexServer();
    const second = await gateway.resolveGlobalCodexServer();
    expect(first?.name).toBe(ECO_IMAGE_GENERATION_MCP_SERVER);
    expect(first?.env?.ECO_IMAGE_CONTROL_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(second).toEqual(first);
  } finally {
    await gateway.close();
  }
});
