import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createPiMcpExtensionFactory,
  fingerprintPiMcpServers,
  piMcpToolAllowlist,
  toPiMcpAdapterConfig,
  toPiMcpServerEntry,
} from "../src/pi-mcp";

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
    lifecycle: "lazy",
  });
  expect(mapped).not.toHaveProperty("alwaysLoad");
  expect(mapped).not.toHaveProperty("timeout");
  expect(mapped).not.toHaveProperty("type");
});

test("toPiMcpServerEntry maps http and sse", () => {
  expect(
    toPiMcpServerEntry({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer a" },
    }),
  ).toEqual({
    url: "https://mcp.example.com/mcp",
    headers: { Authorization: "Bearer a" },
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
  const {
    createAgentSession,
    DefaultResourceLoader,
    ModelRuntime,
    SessionManager,
    SettingsManager,
  } = pi;

  const factory = await createPiMcpExtensionFactory(
    { demo: { command: "true", args: [] } },
    { agentDir },
  );
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
      agent?: { state?: { tools?: Array<{ name: string; execute: (...args: unknown[]) => Promise<{ content?: Array<{ text?: string }> }> }> } };
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
