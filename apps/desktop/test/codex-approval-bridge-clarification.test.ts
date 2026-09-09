import { expect, test } from "bun:test";
import { submitClarification } from "../src/main/clarification-bridge";
import {
  CODEX_MCP_SERVER_ELICITATION_REQUEST,
  CODEX_TOOL_REQUEST_USER_INPUT,
  CODEX_TOOL_REQUEST_USER_INPUT_ASYNC,
  type CodexApprovalBridgeDeps,
  handleCodexServerRequest,
  parseMcpToolRunElicitationMessage,
  shouldAutoAcceptEcoBrowserToolElicitation,
} from "../src/main/codex-approval-bridge";
import type { ThreadLiveEvent } from "../src/shared/ipc";

test("Codex async clarification returns accepted without waiting for answers", async () => {
  const events: ThreadLiveEvent[] = [];
  const injected: string[] = [];
  const deps: CodexApprovalBridgeDeps = {
    resolveEcoThreadId: () => "thread-async",
    getThread: () => ({ prompt: "实现功能", workspacePath: "/workspace" }),
    getWorktreePath: () => undefined,
    getPlannerAgentId: () => "planner-1",
    getRoutesJson: () => "[]",
    savePendingPlan: () => undefined,
    emitThreadLive: (event) => events.push(event),
    updateThreadStatus: () => undefined,
    injectAsyncClarificationAnswers: async ({ text }) => {
      injected.push(text);
    },
  };

  const responsePromise = handleCodexServerRequest(deps, CODEX_TOOL_REQUEST_USER_INPUT_ASYNC, {
    threadId: "codex-thread-async",
    turnId: "turn-async",
    itemId: "question-async",
    questions: [
      {
        id: "choice",
        header: "选择",
        question: "选哪个？",
        options: [
          { label: "A", description: "选项 A" },
          { label: "B", description: "选项 B" },
        ],
      },
    ],
  });

  const response = await responsePromise;
  expect(response).toEqual({ accepted: true });
  expect(events.some((event) => event.type === "clarification.requested")).toBe(true);
  expect(events.find((event) => event.type === "clarification.requested")?.clarification?.delivery).toBe(
    "async",
  );
  expect(injected).toEqual([]);

  expect(
    submitClarification("question-async", {
      toolUseId: "question-async",
      selections: [["A"]],
    }),
  ).toBe(true);

  await Bun.sleep(20);
  expect(events.some((event) => event.type === "clarification.answered")).toBe(true);
  expect(injected.length).toBe(1);
  expect(injected[0]).toContain("Async clarification answers");
});

test("Codex clarification publishes the answered summary and exits the waiting status", async () => {
  const events: ThreadLiveEvent[] = [];
  const statuses: Array<{ status: string; message: string }> = [];
  const deps: CodexApprovalBridgeDeps = {
    resolveEcoThreadId: () => "thread-1",
    getThread: () => ({ prompt: "实现功能", workspacePath: "/workspace" }),
    getWorktreePath: () => undefined,
    getPlannerAgentId: () => "planner-1",
    getRoutesJson: () => "[]",
    savePendingPlan: () => undefined,
    emitThreadLive: (event) => events.push(event),
    updateThreadStatus: (_threadId, patch) => statuses.push(patch),
  };

  const response = handleCodexServerRequest(deps, CODEX_TOOL_REQUEST_USER_INPUT, {
    threadId: "codex-thread-1",
    turnId: "turn-1",
    itemId: "question-1",
    questions: [
      {
        id: "deployment",
        header: "部署方式",
        question: "应该使用哪种部署方式？",
        options: [
          { label: "蓝绿部署", description: "保持两套环境" },
          { label: "滚动发布", description: "逐步替换实例" },
        ],
      },
    ],
  });

  expect(
    submitClarification("question-1", {
      toolUseId: "question-1",
      selections: [["蓝绿部署"]],
    }),
  ).toBe(true);
  await expect(response).resolves.toEqual({
    answers: { deployment: { answers: ["蓝绿部署"] } },
  });

  expect(statuses).toEqual([
    { status: "running", message: "" },
    { status: "running", message: "" },
  ]);
  expect(events.map((event) => event.type)).toEqual(["clarification.requested", "clarification.answered"]);
  expect(events[1]?.message).toBe("澄清回答：应该使用哪种部署方式？ → 蓝绿部署");
  expect(events[0]?.tool).toEqual({
    name: "AskUserQuestion",
    toolUseId: "question-1",
    status: "started",
  });
  expect(events[1]?.tool).toEqual({
    name: "AskUserQuestion",
    toolUseId: "question-1",
    status: "completed",
  });
});

test("parseMcpToolRunElicitationMessage extracts tool name", () => {
  expect(
    parseMcpToolRunElicitationMessage(
      "eco_agent_browser",
      'Allow the eco_agent_browser MCP server to run tool "agent_browser_open"?',
    ),
  ).toBe("mcp__eco_agent_browser__agent_browser_open");
});

test("shouldAutoAcceptEcoBrowserToolElicitation respects open approval mode", () => {
  const openMsg = 'Allow the eco_agent_browser MCP server to run tool "agent_browser_open"?';
  const snapMsg = 'Allow the eco_agent_browser MCP server to run tool "agent_browser_snapshot"?';
  expect(
    shouldAutoAcceptEcoBrowserToolElicitation({
      serverName: "eco_agent_browser",
      message: openMsg,
      openApprovalMode: "always_allow",
    }),
  ).toBe(true);
  expect(
    shouldAutoAcceptEcoBrowserToolElicitation({
      serverName: "eco_agent_browser",
      message: openMsg,
      openApprovalMode: "always_ask",
    }),
  ).toBe(false);
  expect(
    shouldAutoAcceptEcoBrowserToolElicitation({
      serverName: "eco_agent_browser",
      message: snapMsg,
      openApprovalMode: "always_ask",
    }),
  ).toBe(true);
  expect(
    shouldAutoAcceptEcoBrowserToolElicitation({
      serverName: "github",
      message: openMsg,
      openApprovalMode: "always_allow",
    }),
  ).toBe(false);
  expect(
    shouldAutoAcceptEcoBrowserToolElicitation({
      serverName: "eco_ab_ea4a60abe66",
      message: 'Allow the eco_ab_ea4a60abe66 MCP server to run tool "agent_browser_open"?',
      openApprovalMode: "always_allow",
    }),
  ).toBe(true);
});

test("Codex eco_agent_browser tool elicitation auto-accepts when always allow", async () => {
  const events: ThreadLiveEvent[] = [];
  const deps: CodexApprovalBridgeDeps = {
    resolveEcoThreadId: () => "thread-1",
    getThread: () => ({ prompt: "浏览", workspacePath: "/workspace" }),
    getWorktreePath: () => undefined,
    getPlannerAgentId: () => "planner-1",
    getRoutesJson: () => "[]",
    savePendingPlan: () => undefined,
    emitThreadLive: (event) => events.push(event),
    updateThreadStatus: () => undefined,
    getBrowserOpenApprovalMode: () => "always_allow",
  };

  await expect(
    handleCodexServerRequest(deps, CODEX_MCP_SERVER_ELICITATION_REQUEST, {
      threadId: "codex-thread-1",
      serverName: "eco_agent_browser",
      mode: "form",
      message: 'Allow the eco_agent_browser MCP server to run tool "agent_browser_open"?',
      requestedSchema: { type: "object", properties: {} },
    }),
  ).resolves.toEqual({ action: "accept", content: {} });

  expect(events).toEqual([]);
});

test("Codex eco_agent_browser open elicitation still asks when always_ask", async () => {
  const events: ThreadLiveEvent[] = [];
  const deps: CodexApprovalBridgeDeps = {
    resolveEcoThreadId: () => "thread-1",
    getThread: () => ({ prompt: "浏览", workspacePath: "/workspace" }),
    getWorktreePath: () => undefined,
    getPlannerAgentId: () => "planner-1",
    getRoutesJson: () => "[]",
    savePendingPlan: () => undefined,
    emitThreadLive: (event) => events.push(event),
    updateThreadStatus: () => undefined,
    getBrowserOpenApprovalMode: () => "always_ask",
  };

  const pending = handleCodexServerRequest(deps, CODEX_MCP_SERVER_ELICITATION_REQUEST, {
    threadId: "codex-thread-1",
    serverName: "eco_agent_browser",
    mode: "form",
    message: 'Allow the eco_agent_browser MCP server to run tool "agent_browser_open"?',
    requestedSchema: { type: "object", properties: {} },
  });

  // Wait a macrotask so the async handler can emit clarification before we resolve it.
  await Promise.resolve();
  await Promise.resolve();
  const toolUseId = events[0]?.clarification?.toolUseId;
  expect(toolUseId).toBeTruthy();
  expect(events[0]?.type).toBe("clarification.requested");
  expect(
    submitClarification(toolUseId!, {
      toolUseId: toolUseId!,
      selections: [["同意并继续"]],
    }),
  ).toBe(true);
  await expect(pending).resolves.toEqual({ action: "accept", content: {} });
});
