import { expect, test } from "bun:test";
import { ImageGenerationMcpGateway } from "../src/main/image-generation-mcp-gateway";
import {
  ECO_IMAGE_GENERATION_MCP_SERVER,
  IMAGE_GENERATION_CODEX_TOOL_TIMEOUT_SEC,
  IMAGE_GENERATION_MCP_TOOL_TIMEOUT_MS,
} from "../src/shared/image-generation";

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
    expect(first?.transport).toBe("http");
    expect(first?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(first?.httpHeaders?.["X-Eco-Image-Control-Secret"]).toBeTruthy();
    expect(first?.toolTimeoutSec).toBe(IMAGE_GENERATION_CODEX_TOOL_TIMEOUT_SEC);
    expect(first?.toolTimeoutSec).toBeGreaterThanOrEqual(300);
    expect(second).toEqual(first);
  } finally {
    await gateway.close();
  }
});

test("Claude/Pi injection sets 5-minute MCP tool-call timeout", async () => {
  const gateway = new ImageGenerationMcpGateway({
    store: {
      getSettings: () => ({ enabled: true }),
      getActiveClientConfig: () => ({
        provider: "openai",
        profileName: "demo",
        model: "gpt-image-2",
        supportsImageToImage: true,
        endpoint: "https://api.openai.com/v1",
        apiKey: "sk-test",
      }),
    } as never,
    resolveWorkspacePath: () => undefined,
    resolveGenerationRoot: () => undefined,
    onArtifactChanged: () => undefined,
  });
  try {
    const injection = await gateway.resolveInjection({ threadId: "thr_timeout", sessionEnabled: true });
    expect(injection.enabled).toBe(true);
    expect(injection.sdkEntry).toMatchObject({
      type: "http",
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
    });
    expect(IMAGE_GENERATION_MCP_TOOL_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000);
    expect(injection.sdkEntry).toMatchObject({
      // Claude Agent SDK McpStdioServerConfig.timeout (also used for HTTP entries)
      timeout: IMAGE_GENERATION_MCP_TOOL_TIMEOUT_MS,
      // pi-mcp-adapter ServerEntry.requestTimeoutMs (via toPiMcpServerEntry)
      requestTimeoutMs: IMAGE_GENERATION_MCP_TOOL_TIMEOUT_MS,
    });
  } finally {
    await gateway.close();
  }
});
