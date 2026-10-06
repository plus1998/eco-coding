import { expect, test } from "bun:test";
import { McpHub } from "../src/main/mcp-hub";

test("MCP Hub searches only the bound session's tools and dispatches by stable id", async () => {
  const calls: string[] = [];
  const hub = new McpHub();
  hub.registerServer({
    name: "github",
    listTools: async () => ({
      tools: [
        { name: "issues", description: "List issues" },
        { name: "delete_repo", description: "Delete repository" },
      ],
    }),
    callTool: async ({ name }) => {
      calls.push(name);
      return { content: [{ type: "text", text: name }] };
    },
  });
  hub.registerServer({
    name: "calendar",
    listTools: async () => ({ tools: [{ name: "list_events" }] }),
    callTool: async ({ name }) => ({ content: [{ type: "text", text: name }] }),
  });
  hub.bindSession({
    sessionId: "A",
    token: "token-a",
    allowedServers: ["github"],
    allowedTools: ["github:issues"],
  });
  hub.bindSession({ sessionId: "B", token: "token-b", allowedServers: ["calendar"] });

  const a = await hub.searchTools({ token: "token-a" });
  const b = await hub.searchTools({ token: "token-b" });
  expect(a.tools.map((tool) => tool.name)).toEqual(["github:issues"]);
  expect(b.tools.map((tool) => tool.name)).toEqual(["calendar:list_events"]);
  await hub.callTool({ token: "token-a", toolId: "github:issues", arguments: { forgedSessionId: "B" } });
  expect(calls).toEqual(["issues"]);
  await expect(hub.callTool({ token: "token-a", toolId: "github:delete_repo" })).rejects.toThrow("denied");
});

test("MCP Hub keeps hyphenated server names consistent across permissions and tool ids", async () => {
  const hub = new McpHub();
  hub.registerServer({
    name: "issue-tracker",
    listTools: async () => ({ tools: [{ name: "list-issues", inputSchema: { type: "object" } }] }),
    callTool: async ({ name }) => ({ content: [{ type: "text", text: name }] }),
  });
  hub.bindSession({ sessionId: "hyphen", token: "token-hyphen", allowedServers: ["issue-tracker"] });
  const result = await hub.searchTools({ token: "token-hyphen" });
  expect(result.tools.map((tool) => tool.name)).toEqual(["issue-tracker:list-issues"]);
  const called = await hub.callTool({ token: "token-hyphen", toolId: "issue-tracker:list-issues" });
  expect(called.content?.[0]).toEqual({ type: "text", text: "list-issues" });
});

test("MCP Hub preserves case-sensitive upstream tool names and schemas", async () => {
  const called: string[] = [];
  const hub = new McpHub();
  hub.registerServer({
    name: "case-server",
    listTools: async () => ({ tools: [{ name: "GetIssue", inputSchema: { type: "object" } }] }),
    callTool: async ({ name }) => {
      called.push(name);
      return { content: [{ type: "text", text: name }] };
    },
  });
  hub.bindSession({ sessionId: "case", token: "token-case", allowedServers: ["case-server"] });
  const search = await hub.searchTools({ token: "token-case" });
  expect(search.tools[0]).toMatchObject({ name: "case-server:GetIssue", inputSchema: { type: "object" } });
  await hub.callTool({ token: "token-case", toolId: "case-server:GetIssue" });
  expect(called).toEqual(["GetIssue"]);
});

test("MCP Hub child sessions cannot widen parent permissions and revocation is immediate", async () => {
  const hub = new McpHub();
  hub.registerServer({
    name: "probe",
    listTools: async () => ({ tools: [{ name: "read" }, { name: "write" }] }),
    callTool: async ({ name }) => ({ content: [{ type: "text", text: name }] }),
  });
  hub.bindSession({
    sessionId: "parent",
    token: "parent-token",
    allowedServers: ["probe"],
    allowedTools: ["probe:read"],
  });
  hub.bindSession({
    sessionId: "child",
    token: "child-token",
    parentSessionId: "parent",
    allowedServers: ["probe"],
    allowedTools: ["probe:read", "probe:write"],
  });
  const child = await hub.searchTools({ token: "child-token" });
  expect(child.tools.map((tool) => tool.name)).toEqual(["probe:read"]);
  hub.revokeTool({ token: "parent-token", toolId: "probe:read" });
  await expect(hub.searchTools({ token: "child-token" })).resolves.toMatchObject({ tools: [] });
  hub.revokeToken("child-token");
  await expect(hub.searchTools({ token: "child-token" })).rejects.toThrow("invalid");
});

test("MCP Hub revokes a tool from an allow-all session without revoking the rest", async () => {
  const hub = new McpHub();
  hub.registerServer({
    name: "probe",
    listTools: async () => ({ tools: [{ name: "read" }, { name: "write" }] }),
    callTool: async ({ name }) => ({ content: [{ type: "text", text: name }] }),
  });
  hub.bindSession({ sessionId: "all", token: "all-token", allowedServers: ["probe"] });

  hub.revokeTool({ token: "all-token", toolId: "probe:write" });
  const listed = await hub.searchTools({ token: "all-token" });
  expect(listed.tools.map((tool) => tool.name)).toEqual(["probe:read"]);
  await expect(hub.callTool({ token: "all-token", toolId: "probe:write" })).rejects.toThrow("denied");
  await expect(hub.callTool({ token: "all-token", toolId: "probe:read" })).resolves.toMatchObject({
    content: [{ text: "read" }],
  });
});

test("MCP Hub parent token revocation cannot be bypassed by rebinding the same parent id", async () => {
  const hub = new McpHub();
  hub.registerServer({
    name: "probe",
    listTools: async () => ({ tools: [{ name: "read" }] }),
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
  });
  hub.bindSession({ sessionId: "parent", token: "parent-old", allowedServers: ["probe"] });
  hub.bindSession({
    sessionId: "child",
    token: "child-old",
    parentSessionId: "parent",
    allowedServers: ["probe"],
  });
  hub.revokeToken("parent-old");
  hub.bindSession({ sessionId: "parent", token: "parent-new", allowedServers: ["probe"] });
  await expect(hub.searchTools({ token: "child-old" })).rejects.toThrow("invalid");
});

test("MCP Hub exposes only fixed search and call wrappers to the transport", async () => {
  const hub = new McpHub();
  hub.registerServer({
    name: "probe",
    listTools: async () => ({ tools: [{ name: "echo", inputSchema: { type: "object" } }] }),
    callTool: async ({ name, arguments: args }) => ({
      content: [{ type: "text", text: `${name}:${String(args.value ?? "")}` }],
    }),
  });
  hub.bindSession({ sessionId: "A", token: "token-a", allowedServers: ["probe"] });
  const handlers = hub.createStreamableHttpHandlers();
  const listed = await handlers.listTools({ headers: {}, signal: new AbortController().signal });
  expect(listed.tools.map((tool) => tool.name)).toEqual(["search_tools", "call_tool"]);
  const search = await handlers.callTool({
    name: "search_tools",
    arguments: {},
    authToken: "token-a",
    headers: {},
    signal: new AbortController().signal,
  });
  expect(search.structuredContent).toEqual({
    tools: [{ name: "probe:echo", inputSchema: { type: "object" } }],
    total: 1,
    hasMore: false,
  });
  const result = await handlers.callTool({
    name: "call_tool",
    arguments: { name: "probe:echo", arguments: { value: "ok" } },
    authToken: "token-a",
    headers: {},
    signal: new AbortController().signal,
  });
  expect(result.content?.[0]?.text).toBe("echo:ok");
});

test("MCP Hub runs approval and audit hooks after policy checks", async () => {
  const events: string[] = [];
  const hub = new McpHub({
    authorizeCall: ({ tool }) => {
      events.push(`authorize:${tool}`);
      if (tool === "write") throw new Error("approval rejected");
    },
    onAudit: (event) => events.push(`${event.kind}:${event.tool ?? ""}`),
  });
  hub.registerServer({
    name: "probe",
    listTools: async () => ({ tools: [{ name: "read" }, { name: "write" }] }),
    callTool: async ({ name }) => ({ content: [{ type: "text", text: name }] }),
  });
  hub.bindSession({ sessionId: "A", token: "token-a", allowedServers: ["probe"] });
  await hub.callTool({ token: "token-a", toolId: "probe:read" });
  await expect(hub.callTool({ token: "token-a", toolId: "probe:write" })).rejects.toThrow(
    "approval rejected",
  );
  expect(events).toEqual(["authorize:read", "call:read", "authorize:write"]);
});
