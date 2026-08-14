import { expect, test } from "bun:test";
import {
  buildPiMcpSessionConfig,
  mergePiAppendSystemPrompt,
} from "../src/main/pi-mcp-session";
import { ECO_AGENT_BROWSER_MCP_SERVER } from "../src/shared/browser";
import { ECO_IMAGE_GENERATION_MCP_SERVER } from "../src/shared/image-generation";

test("buildPiMcpSessionConfig only includes Composer-selected servers", () => {
  const result = buildPiMcpSessionConfig({
    globalSdkConfig: {
      mcpServers: {
        github: { command: "uvx", args: ["mcp-github"] },
        slack: { command: "npx", args: ["slack-mcp"] },
      },
      allowedTools: ["mcp__github__*", "mcp__slack__*"],
    },
    enabledMcpServerKeys: ["github"],
    browserInject: { enabled: false },
    imageInject: { enabled: false },
  });
  expect(Object.keys(result.mcpServers)).toEqual(["github"]);
  expect(result.appendSystemPrompt).toEqual([]);
  expect(result.extraSkillDirectories).toEqual([]);
});

test("buildPiMcpSessionConfig merges browser and image integrations", () => {
  const result = buildPiMcpSessionConfig({
    globalSdkConfig: {
      mcpServers: {
        github: { command: "uvx", args: ["mcp-github"] },
      },
      allowedTools: [],
    },
    enabledMcpServerKeys: ["github"],
    browserInject: {
      enabled: true,
      sdkEntry: {
        type: "stdio",
        command: "/bin/node",
        args: ["browser.mjs"],
        env: { ECO_BROWSER_AUTH_TOKEN: "tok-a" },
      },
      promptAppend: "Use eco_agent_browser for this thread.",
    },
    imageInject: {
      enabled: true,
      sdkEntry: {
        type: "stdio",
        command: "/bin/node",
        args: ["image.mjs"],
      },
      promptAppend: "Use eco_image_generation when asked.",
    },
    browserSkillDirectory: "/tmp/skills/eco-agent-browser",
  });
  expect(Object.keys(result.mcpServers).sort()).toEqual([
    ECO_AGENT_BROWSER_MCP_SERVER,
    ECO_IMAGE_GENERATION_MCP_SERVER,
    "github",
  ]);
  expect(result.appendSystemPrompt).toEqual([
    "Use eco_agent_browser for this thread.",
    "Use eco_image_generation when asked.",
  ]);
  expect(result.extraSkillDirectories).toEqual(["/tmp/skills/eco-agent-browser"]);
});

test("buildPiMcpSessionConfig isolates different browser tokens per call", () => {
  const base = {
    globalSdkConfig: { mcpServers: {}, allowedTools: [] as string[] },
    enabledMcpServerKeys: [] as string[],
    imageInject: { enabled: false as const },
  };
  const a = buildPiMcpSessionConfig({
    ...base,
    browserInject: {
      enabled: true,
      sdkEntry: {
        command: "node",
        args: ["b.mjs"],
        env: { ECO_BROWSER_AUTH_TOKEN: "token-a" },
      },
    },
  });
  const b = buildPiMcpSessionConfig({
    ...base,
    browserInject: {
      enabled: true,
      sdkEntry: {
        command: "node",
        args: ["b.mjs"],
        env: { ECO_BROWSER_AUTH_TOKEN: "token-b" },
      },
    },
  });
  const envA = (a.mcpServers[ECO_AGENT_BROWSER_MCP_SERVER] as { env?: Record<string, string> })
    .env;
  const envB = (b.mcpServers[ECO_AGENT_BROWSER_MCP_SERVER] as { env?: Record<string, string> })
    .env;
  expect(envA?.ECO_BROWSER_AUTH_TOKEN).toBe("token-a");
  expect(envB?.ECO_BROWSER_AUTH_TOKEN).toBe("token-b");
});

test("mergePiAppendSystemPrompt prepends trimmed global rules before integration append", () => {
  expect(
    mergePiAppendSystemPrompt({
      globalUserRules: "  Always reply in Chinese.  ",
      integrationAppend: ["Use eco_agent_browser for this thread."],
    }),
  ).toEqual(["Always reply in Chinese.", "Use eco_agent_browser for this thread."]);
});

test("mergePiAppendSystemPrompt omits blank global rules", () => {
  expect(
    mergePiAppendSystemPrompt({
      globalUserRules: "   ",
      integrationAppend: ["Use eco_agent_browser for this thread."],
    }),
  ).toEqual(["Use eco_agent_browser for this thread."]);
});

test("mergePiAppendSystemPrompt returns only global rules when integrations are empty", () => {
  expect(
    mergePiAppendSystemPrompt({
      globalUserRules: "Prefer small commits.",
      integrationAppend: ["", "  "],
    }),
  ).toEqual(["Prefer small commits."]);
});
