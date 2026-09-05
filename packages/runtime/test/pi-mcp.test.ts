import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  canonicalizePiMcpFingerprint,
  fingerprintPiMcpServers,
  piMcpToolAllowlist,
  toPiMcpAdapterConfig,
  toPiMcpServerEntry,
} from "../src/pi-mcp";
import { createPiMcpExtensionFactory } from "../src/pi-mcp-adapter-factory";

test("toPiMcpServerEntry maps stdio and strips Claude-only fields", () => {
  const mapped = toPiMcpServerEntry({
    type: "stdio",
    command: "npx",
    args: ["-y", "demo-mcp"],
    env: { TOKEN: "x" },
    alwaysLoad: true,
    timeout: 60_000,
  });
  expect(mapped).toEqual({
    command: "npx",
    args: ["-y", "demo-mcp"],
    env: { TOKEN: "x" },
    requestTimeoutMs: 60_000,
    lifecycle: "lazy",
  });
  expect(mapped).not.toHaveProperty("alwaysLoad");
  expect(mapped).not.toHaveProperty("timeout");
  expect(mapped).not.toHaveProperty("type");
});

test("toPiMcpServerEntry prefers requestTimeoutMs over Claude timeout", () => {
  expect(
    toPiMcpServerEntry({
      command: "node",
      args: ["server.mjs"],
      timeout: 60_000,
      requestTimeoutMs: 210_000,
    }),
  ).toMatchObject({ requestTimeoutMs: 210_000 });
});

test("toPiMcpServerEntry maps http and sse", () => {
  expect(
    toPiMcpServerEntry({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer a" },
      timeout: 120_000,
    }),
  ).toEqual({
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: "Bearer a" },
    httpTransport: "streamable-http",
    requestTimeoutMs: 120_000,
    lifecycle: "lazy",
  });

  expect(
    toPiMcpServerEntry({
      type: "sse",
      url: "https://mcp.example.com/sse",
    }),
  ).toEqual({
    url: "https://mcp.example.com/sse",
    httpTransport: "sse",
    lifecycle: "lazy",
  });
});

test("toPiMcpAdapterConfig drops incomplete entries and keeps only mapped servers", () => {
  const config = toPiMcpAdapterConfig({
    github: { command: "uvx", args: ["mcp-github"] },
    broken: { type: "stdio" },
    remote: { type: "http", url: "https://example.com" },
  });
  expect(Object.keys(config.mcpServers).sort()).toEqual(["github", "remote"]);
  expect(config.mcpServers.github?.command).toBe("uvx");
  expect(config.mcpServers.remote?.url).toBe("https://example.com");
});

test("fingerprintPiMcpServers is order-independent and empty when unset", () => {
  expect(fingerprintPiMcpServers(undefined)).toBe("");
  expect(fingerprintPiMcpServers({})).toBe("");
  const a = fingerprintPiMcpServers({
    b: { command: "b" },
    a: { command: "a" },
  });
  const b = fingerprintPiMcpServers({
    a: { command: "a" },
    b: { command: "b" },
  });
  expect(a).toBe(b);
  expect(a).not.toBe(fingerprintPiMcpServers({ a: { command: "a" } }));
});

test("fingerprintPiMcpServers ignores ECO auth secrets in env", () => {
  const base = {
    eco_agent_browser: {
      command: "node",
      args: ["b.mjs"],
      env: {
        ECO_BROWSER_CONTROL_URL: "http://127.0.0.1:1",
        ECO_BROWSER_AUTH_TOKEN: "token-a",
        ECO_BROWSER_CONTROL_SECRET: "secret-a",
        ELECTRON_RUN_AS_NODE: "1",
      },
    },
  };
  const otherToken = {
    eco_agent_browser: {
      command: "node",
      args: ["b.mjs"],
      env: {
        ECO_BROWSER_CONTROL_URL: "http://127.0.0.1:1",
        ECO_BROWSER_AUTH_TOKEN: "token-b",
        ECO_BROWSER_CONTROL_SECRET: "secret-b",
        ELECTRON_RUN_AS_NODE: "1",
      },
    },
  };
  expect(fingerprintPiMcpServers(base)).toBe(fingerprintPiMcpServers(otherToken));
  expect(fingerprintPiMcpServers(base)).not.toBe(
    fingerprintPiMcpServers({
      eco_agent_browser: {
        command: "node",
        args: ["other.mjs"],
        env: base.eco_agent_browser.env,
      },
    }),
  );
});

test("fingerprintPiMcpServers ignores inherited spawn env", () => {
  const base = {
    eco_image_view: {
      command: "Electron",
      args: ["stdio.mjs"],
      env: {
        PATH: "/usr/bin",
        PI_CODING_AGENT_DIR: "/tmp/parent",
        ECO_IMAGE_VIEW_CONTROL_URL: "http://127.0.0.1:1111",
        ELECTRON_RUN_AS_NODE: "1",
      },
    },
  };
  const poisoned = {
    eco_image_view: {
      command: "Electron",
      args: ["stdio.mjs"],
      env: {
        PATH: "/usr/bin:/opt/homebrew/bin",
        PI_CODING_AGENT_DIR: "/tmp/parent/subagents/coder",
        ECO_IMAGE_VIEW_CONTROL_URL: "http://127.0.0.1:2222",
        ELECTRON_RUN_AS_NODE: "1",
      },
    },
  };
  expect(fingerprintPiMcpServers(base)).toBe(fingerprintPiMcpServers(poisoned));
  expect(fingerprintPiMcpServers(base)).toBe(
    fingerprintPiMcpServers({
      eco_image_view: { command: "Electron", args: ["stdio.mjs"] },
    }),
  );
});

test("canonicalizePiMcpFingerprint strips secrets from stored payloads", () => {
  const live = fingerprintPiMcpServers({
    eco_agent_browser: {
      command: "node",
      args: ["b.mjs"],
      env: {
        ECO_BROWSER_CONTROL_URL: "http://127.0.0.1:1",
        ECO_BROWSER_AUTH_TOKEN: "new",
        ELECTRON_RUN_AS_NODE: "1",
      },
    },
  });
  const legacyStored = JSON.stringify([
    [
      "eco_agent_browser",
      {
        command: "node",
        args: ["b.mjs"],
        env: {
          ECO_BROWSER_CONTROL_URL: "http://127.0.0.1:1",
          ECO_BROWSER_AUTH_TOKEN: "old-token-with-secrets",
          ECO_BROWSER_CONTROL_SECRET: "old-secret",
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
    ],
  ]);
  expect(canonicalizePiMcpFingerprint(legacyStored)).toBe(live);
  expect(canonicalizePiMcpFingerprint("not-json")).toBe("not-json");
});

test("canonicalizePiMcpFingerprint drops inherited spawn env from stored payloads", () => {
  const live = fingerprintPiMcpServers({
    eco_image_view: { command: "Electron", args: ["stdio.mjs"] },
  });
  const legacyStored = JSON.stringify([
    [
      "eco_image_view",
      {
        command: "Electron",
        args: ["stdio.mjs"],
        env: {
          PATH: "/usr/bin",
          PI_CODING_AGENT_DIR: "/tmp/parent/subagents/coder",
          ECO_IMAGE_VIEW_CONTROL_URL: "http://127.0.0.1:58637",
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
    ],
  ]);
  expect(canonicalizePiMcpFingerprint(legacyStored)).toBe(live);
});

test("piMcpToolAllowlist includes proxy tools only when MCP is present", () => {
  expect(piMcpToolAllowlist(false)).toEqual(["read", "bash", "edit", "write"]);
  expect(piMcpToolAllowlist(true)).toEqual(["read", "bash", "edit", "write", "mcp", "mcpScript"]);
});

test("createPiMcpExtensionFactory returns undefined for empty config and a factory otherwise", async () => {
  expect(await createPiMcpExtensionFactory(undefined)).toBeUndefined();
  expect(await createPiMcpExtensionFactory({})).toBeUndefined();
  const factory = await createPiMcpExtensionFactory({
    docs: { url: "https://mcp.example.com/mcp" },
  });
  expect(typeof factory).toBe("function");
});

test("two createPiMcpExtensionFactory calls receive isolated config snapshots", async () => {
  const serversA = { a: { command: "server-a" } };
  const serversB = { b: { command: "server-b" } };
  const factoryA = await createPiMcpExtensionFactory(serversA);
  const factoryB = await createPiMcpExtensionFactory(serversB);
  expect(factoryA).toBeDefined();
  expect(factoryB).toBeDefined();
  expect(factoryA).not.toBe(factoryB);
});

test("MCP proxy stays uninitialized until bindExtensions emits session_start", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "eco-pi-mcp-bind-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await mkdir(path.join(agentDir, "skills"), { recursive: true });

  const pi = await import("@earendil-works/pi-coding-agent");
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = pi;

  const factory = await createPiMcpExtensionFactory({ demo: { command: "true", args: [] } }, { agentDir });
  expect(factory).toBeDefined();

  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: agentDir,
    agentDir,
    settingsManager,
    noExtensions: true,
    extensionFactories: [{ name: "eco-pi-mcp", factory: factory as never }],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => "test",
  });
  await resourceLoader.reload();

  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const sessionManager = SessionManager.inMemory(agentDir);
  const { session } = await createAgentSession({
    cwd: agentDir,
    agentDir,
    modelRuntime,
    resourceLoader: resourceLoader as never,
    tools: piMcpToolAllowlist(true),
    sessionManager,
    settingsManager,
  });

  const mcpTool = (
    session as {
      agent?: {
        state?: {
          tools?: Array<{
            name: string;
            execute: (...args: unknown[]) => Promise<{ content?: Array<{ text?: string }> }>;
          }>;
        };
      };
    }
  ).agent?.state?.tools?.find((tool) => tool.name === "mcp");
  expect(mcpTool).toBeDefined();

  const before = await mcpTool!.execute(
    "call-before",
    { action: "status" },
    new AbortController().signal,
    () => {},
  );
  expect(before.content?.[0]?.text).toBe("MCP not initialized");

  await session.bindExtensions({ mode: "rpc" });
  const after = await mcpTool!.execute(
    "call-after",
    { action: "status" },
    new AbortController().signal,
    () => {},
  );
  const afterText = after.content?.[0]?.text ?? "";
  expect(afterText).not.toBe("MCP not initialized");
  expect(afterText).toContain("servers");

  session.dispose();
});
