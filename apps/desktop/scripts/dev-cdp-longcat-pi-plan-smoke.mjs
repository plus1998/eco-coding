/** LongCat PI native finalize_plan -> V2 approval -> execution smoke. */
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL?.trim() || "http://127.0.0.1:9333";
const timeoutMs = Number.parseInt(process.env.ECO_LONGCAT_PLAN_TIMEOUT_MS ?? "180000", 10);
const marker = `V2_LONGCAT_PI_PLAN_${Date.now().toString(36).toUpperCase()}`;
const executionTarget =
  process.env.ECO_LONGCAT_PLAN_TARGET === "subagent"
    ? { kind: "subagent", agentKey: "coder" }
    : { kind: "main" };
const executionMarker = executionTarget.kind === "subagent" ? "pi_plan_subagent_ok" : "pi_plan_main_ok";

function exactExecutionBashTools(tools) {
  const expectedCommand = `printf '${executionMarker}'`;
  return (tools ?? []).filter(
    (tool) =>
      /^(bash|shell)$/i.test(String(tool?.name ?? "")) &&
      String(tool?.input?.command ?? "").trim() === expectedCommand &&
      String(tool?.output ?? "").trim() === executionMarker,
  );
}

function tune(config) {
  const cloned = JSON.parse(JSON.stringify(config));
  if (cloned.thinkingEffort) cloned.thinkingEffort = "minimal";
  const snapshot = cloned.resolvedOrchestrationSnapshot;
  if (snapshot?.mainAgent?.modelRef?.thinkingEffort) snapshot.mainAgent.modelRef.thinkingEffort = "minimal";
  for (const agent of snapshot?.agents ?? []) {
    if (agent?.modelRef?.thinkingEffort) agent.modelRef.thinkingEffort = "minimal";
  }
  return cloned;
}

async function state(page, id) {
  return page.evaluate(async (threadId) => {
    const [thread, pendingPlan, head, bootstrap] = await Promise.all([
      window.eco.getThread(threadId),
      window.eco.getPendingPlan?.(threadId),
      window.eco.conversationV2Head?.(threadId),
      window.eco.conversationV2Bootstrap?.(threadId, { pageSize: 200 }),
    ]);
    const messages = bootstrap?.messages ?? [];
    return {
      thread,
      pendingPlan,
      head,
      renderer: window.__ecoConversationV2RendererSnapshot?.()?.[threadId] ?? null,
      text: messages.map((message) => String(message?.body ?? "")).join("\n"),
      userMessageCount: messages.filter((message) => message?.role === "user" && !message?.isDeleted).length,
      tools: bootstrap?.tools ?? [],
      messageCount: messages.length,
      toolCount: bootstrap?.tools?.length ?? 0,
      agentCount: bootstrap?.agents?.length ?? 0,
    };
  }, id);
}

async function waitForRendererConvergence(page, id, waitMs = 20000) {
  const startedAt = Date.now();
  let last;
  let stableHeadReads = 0;
  let previousHead;
  while (Date.now() - startedAt < waitMs) {
    last = await page.evaluate(async (threadId) => {
      const [head, renderer] = await Promise.all([
        window.eco.conversationV2Head?.(threadId),
        Promise.resolve(window.__ecoConversationV2RendererSnapshot?.()?.[threadId] ?? null),
      ]);
      return { head, renderer };
    }, id);
    const headKey = `${last.head?.storeEpoch ?? ""}:${last.head?.lastSeq ?? -1}:${last.head?.historyRevision ?? -1}`;
    const converged =
      last.head?.protocolVersion === 2 &&
      last.renderer?.storeEpoch === last.head.storeEpoch &&
      last.renderer.appliedSeq >= last.head.lastSeq &&
      last.renderer.historyRevision >= last.head.historyRevision &&
      last.renderer.bufferedEffectSeqs.length === 0 &&
      !last.renderer.loading &&
      !last.renderer.recoveryRequested &&
      !last.renderer.recoveryInFlight;
    if (converged && headKey === previousHead) stableHeadReads += 1;
    else stableHeadReads = 0;
    if (converged && stableHeadReads >= 1) {
      return { ...last, stableHeadReads: stableHeadReads + 1, timedOut: false };
    }
    previousHead = headKey;
    await page.waitForTimeout(300);
  }
  return { ...last, stableHeadReads, timedOut: true };
}

async function wait(page, id, predicate) {
  const startedAt = Date.now();
  let current;
  while (Date.now() - startedAt < timeoutMs) {
    current = await state(page, id);
    if (predicate(current)) return current;
    await page.waitForTimeout(700);
  }
  return { ...current, timedOut: true };
}

async function openThreadAndCountPrompt(page, threadId, targetMarker) {
  const row = page.locator(`.chat-item-row[data-thread-id="${threadId}"] button.chat-item`);
  if ((await row.count()) === 1) {
    await row.click();
    await page
      .waitForFunction(
        (markerText) =>
          [...document.querySelectorAll(".run-log-user-prompt[data-user-message-anchor-id]")].some((node) =>
            node.innerText.includes(markerText),
          ),
        targetMarker,
        { timeout: 10000 },
      )
      .catch(() => undefined);
  }
  return page
    .locator(".run-log-user-prompt[data-user-message-anchor-id]")
    .evaluateAll(
      (nodes, markerText) => nodes.filter((node) => node.innerText.includes(markerText)).length,
      targetMarker,
    );
}

async function selectThread(page, threadId) {
  const row = page.locator(`.chat-item-row[data-thread-id="${threadId}"] button.chat-item`);
  await row.waitFor({ state: "visible", timeout: 10000 });
  await row.click();
}

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) throw new Error("no CDP page");
await page.bringToFront();

const template = await page.evaluate(async () => {
  const threads = (await window.eco.listThreads?.()) ?? [];
  return (
    threads.find(
      (thread) =>
        thread.coreKind === "pi" &&
        thread.runtimeConfig?.resolvedOrchestrationSnapshot?.mainAgent?.modelRef?.modelId === "LongCat-2.0" &&
        (thread.runtimeConfig?.resolvedOrchestrationSnapshot?.agents?.length ?? 0) > 0,
    ) ??
    threads.find(
      (thread) =>
        thread.coreKind === "pi" &&
        thread.runtimeConfig?.resolvedOrchestrationSnapshot?.mainAgent?.modelRef?.modelId === "LongCat-2.0",
    )
  );
});
if (!template?.runtimeConfig) throw new Error("no LongCat PI template");

const started = await page.evaluate(
  async ({ workspacePath, runtimeConfig, prompt }) =>
    window.eco.startThread({
      workspacePath,
      coreKind: "pi",
      runtimeConfig: { ...runtimeConfig, sessionMode: "plan", bashReviewMode: "allow_all" },
      prompt,
    }),
  {
    workspacePath: template.workspacePath,
    runtimeConfig: tune(template.runtimeConfig),
    prompt: [
      "任务：验收 PI 原生计划审批。现在只提交计划，不要执行其中的命令。",
      "1. 只创建一个简短 Markdown 计划，不要提问、运行命令、调用 Bash 或修改项目源文件。",
      `2. 计划正文必须逐字包含标记：${marker}`,
      "3. 批准计划会作为独立文本交给执行者；执行者只会看到获批计划，不会看到本提示的其他内容。因此计划正文必须自包含，不得提到‘阶段 B’或依赖计划正文以外的指令。",
      executionTarget.kind === "subagent"
        ? `4. 计划中唯一执行步骤必须完整写明：审批选定的 coder 子代理本身直接调用一次 Bash，精确命令为 printf '${executionMarker}'；等待真实输出后报告。coder 不得再次委派，主代理不得代跑。`
        : `4. 计划中唯一执行步骤必须完整写明：审批选定的主代理直接调用一次 Bash，精确命令为 printf '${executionMarker}'；等待真实输出后报告。不得委派子代理。`,
      "5. 计划明确禁止任何其他 Bash 命令、重复调用、重试、复验、额外工具或伪造结果。",
      "6. 必须调用 PI 原生 finalize_plan 工具提交计划，然后停止等待审批。只输出普通文本不算提交成功。允许 PI 原生计划工具保存计划文件，这是计划元数据。",
    ].join("\n"),
  },
);
const threadId = started?.thread?.id;
if (!threadId) throw new Error(`startThread returned no thread: ${JSON.stringify(started)}`);
console.log(`[start] ${threadId}`);
await selectThread(page, threadId);

const pending = await wait(
  page,
  threadId,
  (current) => current.thread?.status === "awaiting_plan" && Boolean(current.pendingPlan?.plan),
);
const renderedPendingPromptCount = await openThreadAndCountPrompt(page, threadId, marker);
const pendingRendererConvergence = await waitForRendererConvergence(page, threadId);
const pendingPlanText = String(pending.pendingPlan?.plan ?? "");
const pendingPlanSelfContained =
  pendingPlanText.includes(`printf '${executionMarker}'`) &&
  (executionTarget.kind === "subagent"
    ? /coder|子代理/i.test(pendingPlanText)
    : /主代理/i.test(pendingPlanText));
const pendingOk =
  pending.thread?.status === "awaiting_plan" &&
  pending.pendingPlan?.plan?.includes(marker) &&
  pending.userMessageCount === 1 &&
  renderedPendingPromptCount === 1 &&
  pendingPlanSelfContained &&
  !pendingRendererConvergence.timedOut;
console.log(
  "[pending]",
  JSON.stringify({
    status: pending.thread?.status,
    hasPendingPlan: Boolean(pending.pendingPlan?.plan),
    hasMarker: pending.text?.includes(marker) || pending.pendingPlan?.plan?.includes(marker),
    userMessageCount: pending.userMessageCount,
    renderedPromptCount: renderedPendingPromptCount,
    planSelfContained: pendingPlanSelfContained,
    plan: pendingPlanText,
    historyRevision: pending.head?.historyRevision,
    rendererConvergence: pendingRendererConvergence,
  }),
);
if (!pendingOk) {
  await page
    .evaluate(async (id) => {
      const head = await window.eco.conversationV2Head?.(id);
      return window.eco.cancelThread?.({
        principalId: "desktop-local",
        clientCommandId: `longcat_pi_invalid_plan_cancel_${id}_${Date.now()}`,
        threadId: id,
        expectedHistoryRevision: Number.isSafeInteger(head?.historyRevision) ? head.historyRevision : 0,
        worktreeDisposition: "keep",
      });
    }, threadId)
    .catch(() => undefined);
  console.log(JSON.stringify({ ok: false, phase: "pending", threadId, state: pending }, null, 2));
  await browser.close();
  process.exit(1);
}

let approval;
try {
  approval = await page.evaluate(
    async ({ id, target }) => {
      const head = await window.eco.conversationV2Head(id);
      return window.eco.approvePlan({
        principalId: "desktop-local",
        clientCommandId: `longcat_pi_plan_${id}_${Date.now()}`,
        threadId: id,
        expectedHistoryRevision: Number.isSafeInteger(head?.historyRevision) ? head.historyRevision : 0,
        executionTarget: target,
      });
    },
    { id: threadId, target: executionTarget },
  );
} catch (error) {
  console.log(
    JSON.stringify({ ok: false, phase: "approve", threadId, executionTarget, error: String(error) }, null, 2),
  );
  await browser.close();
  process.exit(1);
}
const completed = await wait(
  page,
  threadId,
  (current) =>
    current.thread?.status === "completed" ||
    current.thread?.status === "failed" ||
    current.thread?.status === "blocked",
);
const allBashTools = completed.tools.filter((tool) => /^(bash|shell)$/i.test(String(tool?.name ?? "")));
const executionTools = exactExecutionBashTools(completed.tools).map((tool) => ({
  name: tool.name,
  status: tool.status,
  agentId: tool.agentId,
}));
const executionOwnershipOk =
  executionTools.some(
    (tool) =>
      tool.status === "completed" &&
      (executionTarget.kind === "subagent" ? Boolean(tool.agentId) : !tool.agentId),
  ) &&
  executionTools.length === 1 &&
  allBashTools.length === 1;
const renderedPromptCount = await openThreadAndCountPrompt(page, threadId, marker);
const rendererConvergence = await waitForRendererConvergence(page, threadId);
const approvalSummary = approval
  ? {
      threadId: approval.thread?.id,
      status: approval.status ?? approval.thread?.status,
      alreadyResolved: Boolean(approval.alreadyResolved),
    }
  : approval;
const result = {
  ok:
    completed.thread?.status === "completed" &&
    completed.userMessageCount === 1 &&
    renderedPromptCount === 1 &&
    executionOwnershipOk &&
    !rendererConvergence.timedOut,
  threadId,
  approval: approvalSummary,
  status: completed.thread?.status,
  message: completed.thread?.message,
  markerInV2Messages: completed.text?.includes(marker),
  userMessageCount: completed.userMessageCount,
  renderedPromptCount,
  toolCount: completed.toolCount,
  executionMarker,
  executionTools,
  bashToolCount: allBashTools.length,
  bashCommands: allBashTools.map((tool) => String(tool.input?.command ?? "")),
  executionOwnershipOk,
  agentCount: completed.agentCount,
  messageCount: completed.messageCount,
  historyRevision: completed.head?.historyRevision,
  rendererConvergence,
  executionTarget,
};
result.renderedPromptCount = await openThreadAndCountPrompt(page, threadId, marker);
result.ok = result.ok && result.userMessageCount === 1 && result.renderedPromptCount === 1;
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exitCode = result.ok ? 0 : 1;
