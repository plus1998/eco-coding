/**
 * LongCat-2.0 V2-only end-to-end smoke against a running Dev desktop.
 *
 * Covers fresh threads for pi/claude/codex, durable tool rows, orchestration,
 * native plan approval with subagent execution, and V2 message uniqueness.
 *
 * ECO_DEV_CDP_URL=http://127.0.0.1:9333 \
 * ECO_LONGCAT_SMOKE_TIMEOUT_MS=240000 \
 * bun scripts/dev-cdp-longcat-v2-full-smoke.mjs
 */
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL?.trim() || "http://127.0.0.1:9333";
const timeoutMs = Number.parseInt(process.env.ECO_LONGCAT_SMOKE_TIMEOUT_MS ?? "240000", 10);
const marker = `V2_LONGCAT_FULL_${Date.now().toString(36).toUpperCase()}`;
const report = { ok: [], fail: [], meta: { cdpUrl, marker, timeoutMs } };

function tunedRuntimeConfig(runtimeConfig) {
  const cloned = JSON.parse(JSON.stringify(runtimeConfig));
  // A persisted thread snapshot is historical evidence, not the source of truth for a
  // new smoke thread. Force thread:start to materialize the selected resources again so
  // provider apiCompat changes (for example LongCat Responses) are exercised.
  delete cloned.resolvedOrchestrationSnapshot;
  return cloned;
}

function pass(name, detail) {
  report.ok.push({ name, detail });
  console.log(`[pass] ${name}`, JSON.stringify(detail));
}

function fail(name, detail) {
  report.fail.push({ name, detail });
  console.error(`[fail] ${name}`, JSON.stringify(detail));
}

function exactMarkerBashTools(tools, markerText) {
  const expectedCommands = new Set([
    `printf '${markerText}'`,
    `/bin/zsh -lc "printf '${markerText}'"`,
    `/bin/bash -lc "printf '${markerText}'"`,
  ]);
  return (tools ?? []).filter(
    (tool) =>
      /^(bash|shell)$/i.test(String(tool?.name ?? "")) &&
      expectedCommands.has(String(tool?.input?.command ?? "").trim()) &&
      String(tool?.output ?? "").trim() === markerText,
  );
}

async function openThreadAndCountPrompt(page, threadId, markerText) {
  const item = page.locator(`.chat-item-row[data-thread-id="${threadId}"] button.chat-item`);
  if ((await item.count()) === 1) {
    await item.click();
    await page
      .waitForFunction(
        (marker) =>
          [...document.querySelectorAll(".run-log-user-prompt[data-user-message-anchor-id]")].some((node) =>
            node.innerText.includes(marker),
          ),
        markerText,
        { timeout: 10000 },
      )
      .catch(() => undefined);
  }
  return page
    .locator(".run-log-user-prompt[data-user-message-anchor-id]")
    .evaluateAll(
      (nodes, marker) => nodes.filter((node) => node.innerText.includes(marker)).length,
      markerText,
    );
}

async function selectThread(page, threadId) {
  const item = page.locator(`.chat-item-row[data-thread-id="${threadId}"] button.chat-item`);
  await item.waitFor({ state: "visible", timeout: 10000 });
  await item.click();
}

async function readState(page, threadId) {
  return page.evaluate(async (id) => {
    const [thread, pendingPlan, head, bootstrap] = await Promise.all([
      window.eco.getThread(id),
      window.eco.getPendingPlan?.(id),
      window.eco.conversationV2Head?.(id),
      window.eco.conversationV2Bootstrap?.(id, { pageSize: 200 }),
    ]);
    const messages = bootstrap?.messages ?? [];
    const tools = bootstrap?.tools ?? [];
    const assistantText = messages
      .filter((message) => message?.role === "assistant" && !message?.isDeleted)
      .map((message) => String(message?.body ?? ""))
      .join("\n");
    return {
      thread,
      pendingPlan,
      head,
      renderer: window.__ecoConversationV2RendererSnapshot?.()?.[id] ?? null,
      bootstrap,
      assistantText,
      toolCount: bootstrap?.tools?.length ?? 0,
      tools,
      userMessageCount: messages.filter((message) => message?.role === "user" && !message?.isDeleted).length,
      agentCount: bootstrap?.agents?.length ?? 0,
      messageCount: messages.length,
    };
  }, threadId);
}

async function waitForRendererConvergence(page, threadId, waitMs = 20000) {
  const startedAt = Date.now();
  let last;
  let stableHeadReads = 0;
  let previousHead;
  while (Date.now() - startedAt < waitMs) {
    last = await page.evaluate(async (id) => {
      const [head, renderer] = await Promise.all([
        window.eco.conversationV2Head?.(id),
        Promise.resolve(window.__ecoConversationV2RendererSnapshot?.()?.[id] ?? null),
      ]);
      return { head, renderer };
    }, threadId);
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

async function waitForState(page, threadId, { markerText, waitForPlan = false, waitMs = timeoutMs } = {}) {
  const startedAt = Date.now();
  let state;
  while (Date.now() - startedAt < waitMs) {
    const pendingApproval = await page.evaluate(
      async (id) => window.eco.getPendingBashApproval?.(id),
      threadId,
    );
    if (pendingApproval?.toolUseId) {
      await page.evaluate(async (toolUseId) => {
        await window.eco.resolveBashApproval?.({ toolUseId, decision: "approved" });
      }, pendingApproval.toolUseId);
    }
    state = await readState(page, threadId);
    const status = state?.thread?.status;
    const hasMarker = markerText ? state.assistantText.includes(markerText) : false;
    if (waitForPlan && state.pendingPlan?.plan && (status === "awaiting_plan" || status === "running")) {
      return { ...state, hasMarker };
    }
    if (
      !waitForPlan &&
      (status === "completed" || status === "failed" || status === "blocked" || status === "interrupted")
    ) {
      if (!markerText || hasMarker || status !== "completed") {
        return { ...state, hasMarker };
      }
    }
    await page.waitForTimeout(750);
  }
  return {
    ...state,
    timedOut: true,
    hasMarker: markerText ? state?.assistantText?.includes(markerText) : false,
  };
}

async function cancelIfStillActive(page, threadId) {
  const current = await page.evaluate(async (id) => window.eco.getThread(id), threadId);
  if (!current || !["running", "queued", "awaiting_plan"].includes(current.status)) return current;
  const result = await page.evaluate(async (id) => {
    const head = await window.eco.conversationV2Head?.(id);
    return window.eco.cancelThread?.({
      principalId: "desktop-local",
      clientCommandId: `longcat_smoke_cancel_${id}_${Date.now()}`,
      threadId: id,
      expectedHistoryRevision: Number.isSafeInteger(head?.historyRevision) ? head.historyRevision : 0,
      worktreeDisposition: "keep",
    });
  }, threadId);
  await page.waitForTimeout(300);
  return { ...current, cancelResult: result };
}

async function startCase(
  page,
  {
    label,
    coreKind,
    template,
    prompt,
    sessionMode = "agent",
    markerText,
    requireToolMarker = true,
    requireSubagentToolMarker = false,
    waitMs = timeoutMs,
  },
) {
  let started;
  try {
    started = await page.evaluate(
      async ({
        workspacePath,
        runtimeConfig,
        coreKind: requestedCoreKind,
        promptText,
        requestedSessionMode,
      }) =>
        window.eco.startThread({
          workspacePath,
          coreKind: requestedCoreKind,
          runtimeConfig: {
            ...runtimeConfig,
            sessionMode: requestedSessionMode,
            bashReviewMode: "allow_all",
          },
          prompt: promptText,
        }),
      {
        workspacePath: template.workspacePath,
        runtimeConfig: tunedRuntimeConfig(template.runtimeConfig),
        coreKind,
        promptText: prompt,
        requestedSessionMode: sessionMode,
      },
    );
  } catch (error) {
    fail(label, { phase: "start", error: String(error) });
    return undefined;
  }
  const threadId = started?.thread?.id;
  if (!threadId) {
    fail(label, { phase: "start", result: started });
    return undefined;
  }
  console.log(`[start] ${label} ${threadId}`);
  await selectThread(page, threadId);
  const state = await waitForState(page, threadId, { markerText, waitMs });
  if (state?.timedOut || state?.thread?.status === "running") {
    await cancelIfStillActive(page, threadId);
  }
  const renderedPromptCount = markerText
    ? await openThreadAndCountPrompt(page, threadId, markerText)
    : undefined;
  const detail = {
    threadId,
    status: state?.thread?.status,
    message: state?.thread?.message,
    hasMarker: state?.hasMarker,
    toolCount: state?.toolCount,
    userMessageCount: state?.userMessageCount,
    renderedPromptCount,
    rendererConvergence: await waitForRendererConvergence(page, threadId),
    bashToolCount: (state?.tools ?? []).filter((tool) => /^(bash|shell)$/i.test(String(tool?.name ?? "")))
      .length,
    markerTools: exactMarkerBashTools(state?.tools, markerText).map((tool) => ({
      name: tool.name,
      status: tool.status,
      agentId: tool.agentId,
    })),
    agentCount: state?.agentCount,
    v2MessageCount: state?.messageCount,
    historyRevision: state?.head?.historyRevision,
    timedOut: Boolean(state?.timedOut),
  };
  const markerTools = detail.markerTools ?? [];
  if (
    state?.thread?.status === "completed" &&
    state.hasMarker &&
    state.userMessageCount === 1 &&
    renderedPromptCount === 1 &&
    (!requireToolMarker ||
      (detail.bashToolCount === 1 && markerTools.length === 1 && markerTools[0].status === "completed")) &&
    (!requireSubagentToolMarker ||
      (markerTools.length === 1 &&
        markerTools[0].status === "completed" &&
        Boolean(markerTools[0].agentId))) &&
    !detail.rendererConvergence?.timedOut
  ) {
    pass(label, detail);
  } else {
    fail(label, detail);
  }
  return { ...state, ...detail };
}

async function expectCodexSubagentCapabilityGate(page, { template, prompt }) {
  const outcome = await page.evaluate(
    async ({ workspacePath, runtimeConfig, promptText }) => {
      const before = new Set(((await window.eco.listThreads?.()) ?? []).map((thread) => thread.id));
      let error = "";
      let started = false;
      try {
        const result = await window.eco.startThread({
          workspacePath,
          coreKind: "codex",
          runtimeConfig: {
            ...runtimeConfig,
            sessionMode: "agent",
            bashReviewMode: "allow_all",
          },
          prompt: promptText,
        });
        started = Boolean(result?.thread?.id);
      } catch (caught) {
        error = String(caught);
      }
      const after = (await window.eco.listThreads?.()) ?? [];
      return {
        error,
        started,
        addedThreadIds: after.filter((thread) => !before.has(thread.id)).map((thread) => thread.id),
      };
    },
    {
      workspacePath: template.workspacePath,
      runtimeConfig: tunedRuntimeConfig(template.runtimeConfig),
      promptText: prompt,
    },
  );
  const expectedMessage = "LongCat-2.0 当前不支持 Codex 子代理的加密 agent_message";
  const detail = { templateId: template.id, ...outcome };
  if (!outcome.started && outcome.error.includes(expectedMessage) && outcome.addedThreadIds.length === 0) {
    pass("longcat_codex_subagent_capability_gate", detail);
  } else {
    fail("longcat_codex_subagent_capability_gate", detail);
  }
}

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) {
  fail("cdp_page", "no page on CDP");
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}
await page.bringToFront();

const templates = await page.evaluate(async () => {
  const threads = (await window.eco.listThreads?.()) ?? [];
  const longcat = threads.filter(
    (thread) =>
      thread.runtimeConfig?.resolvedOrchestrationSnapshot?.mainAgent?.modelRef?.modelId === "LongCat-2.0",
  );
  const simple = longcat.find(
    (thread) => (thread.runtimeConfig?.resolvedOrchestrationSnapshot?.agents?.length ?? 0) === 0,
  );
  const orchestration = longcat.find(
    (thread) => (thread.runtimeConfig?.resolvedOrchestrationSnapshot?.agents?.length ?? 0) > 0,
  );
  return { simple, orchestration };
});

if (!templates.simple?.runtimeConfig || !templates.orchestration?.runtimeConfig) {
  fail("longcat_templates", {
    simple: Boolean(templates.simple),
    orchestration: Boolean(templates.orchestration),
  });
} else {
  pass("longcat_templates", {
    simpleThread: templates.simple.id,
    orchestrationThread: templates.orchestration.id,
    simpleCore: templates.simple.coreKind,
    orchestrationCore: templates.orchestration.coreKind,
  });

  for (const coreKind of ["pi", "claude", "codex"]) {
    const toolMarker = `${marker}_${coreKind.toUpperCase()}_TOOL`;
    await startCase(page, {
      label: `longcat_${coreKind}_tool_v2`,
      coreKind,
      template: templates.simple,
      markerText: toolMarker,
      prompt: [
        "你正在执行自动验收。你唯一要做的事是调用 Bash 一次。",
        `完整命令必须是：printf '${toolMarker}'。必须逐字照抄，不得改动。`,
        "等 Bash 返回后，成功时最终回复只写实际输出。不得猜结果、重试、复验、委派、读写文件或调用其他工具。",
        "如果 Bash 调用失败，就停止并说明失败；不得声称成功。",
      ].join("\n"),
      waitMs: coreKind === "codex" ? Math.min(timeoutMs, 90000) : timeoutMs,
    });
  }

  const subagentMarker = `${marker}_CLAUDE_SUBAGENT`;
  await startCase(page, {
    label: "longcat_claude_subagent_v2",
    coreKind: "claude",
    template: templates.orchestration,
    markerText: subagentMarker,
    prompt: [
      "你是主代理。你的唯一动作是创建一个名为 coder 的子代理，并等待它完成。你自己绝不能调用 Bash。",
      `把这条指令完整交给 coder：只调用 Bash 一次，精确命令为 printf '${subagentMarker}'；等待真实结果并原样返回。`,
      "coder 不得委派其他代理、重试、复验、重复调用、读写文件或调用其他工具。",
      `收到 coder 的真实结果后，你的最终回复只写该结果。若创建 coder 或调用 Bash 失败，说明失败并停止；不得代跑或编造结果。`,
    ].join("\n"),
    requireSubagentToolMarker: true,
  });

  await expectCodexSubagentCapabilityGate(page, {
    template: templates.orchestration,
    prompt: [
      "你是主代理。唯一任务：尝试创建一个名为 coder 的子代理。不要调用 Bash。",
      "交给 coder 的唯一任务是调用一次 Bash，精确命令为 printf 'codex_subagent_capability_gate'，然后返回真实输出。",
      "不要改用其他代理、不要创建第二个代理、不要伪造结果。若系统明确拒绝创建子代理，报告错误并立即停止。",
    ].join("\n"),
  });

  const planMarker = `${marker}_PLAN`;
  let planStarted;
  try {
    planStarted = await page.evaluate(
      async ({ workspacePath, runtimeConfig, promptText }) =>
        window.eco.startThread({
          workspacePath,
          coreKind: "claude",
          runtimeConfig: { ...runtimeConfig, sessionMode: "plan", bashReviewMode: "allow_all" },
          prompt: promptText,
        }),
      {
        workspacePath: templates.orchestration.workspacePath,
        runtimeConfig: tunedRuntimeConfig(templates.orchestration.runtimeConfig),
        promptText: [
          "你正在执行 Claude 原生计划审批验收。现在只提交计划，然后停止等待批准；此阶段绝不执行计划。",
          `计划正文必须包含标记 ${planMarker}，并且必须自包含，因为执行者只会收到计划正文。`,
          "计划里只写一个执行步骤：批准后，由审批界面选定的 coder 子代理直接调用一次 Bash，精确命令 printf 'claude_plan_subagent_ok'，等待真实输出并报告。不要写‘阶段 B’，也不要引用计划以外的说明。",
          "禁止其他命令、工具、重试、复验、重复调用或再次委派；主代理不得代替 coder 执行 Bash。不要提问、读写项目文件或做额外检查。",
          "必须调用 Claude 原生 ExitPlanMode 提交计划。普通文本不算提交成功。允许保存 Claude 原生计划元数据。提交后立即停止，等待用户批准。",
        ].join("\n"),
      },
    );
  } catch (error) {
    fail("longcat_claude_plan_v2", { phase: "start", error: String(error) });
  }

  if (planStarted?.thread?.id) {
    const planId = planStarted.thread.id;
    await selectThread(page, planId);
    const pendingState = await waitForState(page, planId, { waitForPlan: true, markerText: planMarker });
    const pendingRendererConvergence = await waitForRendererConvergence(page, planId);
    const pendingPlanText = String(pendingState?.pendingPlan?.plan ?? "");
    const pendingPlanSelfContained =
      pendingPlanText.includes("printf 'claude_plan_subagent_ok'") && /coder|子代理/i.test(pendingPlanText);
    const pendingOk =
      Boolean(pendingState?.pendingPlan?.plan) &&
      pendingState?.thread?.status === "awaiting_plan" &&
      pendingPlanSelfContained &&
      !pendingRendererConvergence.timedOut;
    if (!pendingOk) {
      if (["queued", "running", "awaiting_plan"].includes(pendingState?.thread?.status)) {
        await cancelIfStillActive(page, planId);
      }
      fail("longcat_claude_plan_v2_pending", {
        threadId: planId,
        status: pendingState?.thread?.status,
        hasPendingPlan: Boolean(pendingState?.pendingPlan?.plan),
        hasMarker: pendingState?.hasMarker,
        planSelfContained: pendingPlanSelfContained,
        plan: pendingPlanText,
        rendererConvergence: pendingRendererConvergence,
        message: pendingState?.thread?.message,
      });
    } else {
      const approved = await page.evaluate(async (id) => {
        const head = await window.eco.conversationV2Head(id);
        return window.eco.approvePlan({
          principalId: "desktop-local",
          clientCommandId: `longcat_plan_${id}_${Date.now()}`,
          threadId: id,
          expectedHistoryRevision: Number.isSafeInteger(head?.historyRevision) ? head.historyRevision : 0,
          executionTarget: { kind: "subagent", agentKey: "coder" },
        });
      }, planId);
      const afterApproval = await waitForState(page, planId, { markerText: planMarker });
      const renderedPlanPromptCount = await openThreadAndCountPrompt(page, planId, planMarker);
      const planArtifactWrites = (afterApproval?.tools ?? [])
        .filter((tool) => /^(write|edit|multiedit|create)$/i.test(String(tool?.name ?? "")))
        .map((tool) => ({
          name: tool.name,
          status: tool.status,
          path: String(tool.input?.fileChange?.path ?? tool.input?.path ?? ""),
        }));
      const allBashTools = (afterApproval?.tools ?? []).filter((tool) =>
        /^(bash|shell)$/i.test(String(tool?.name ?? "")),
      );
      const approvalDetail = approved
        ? {
            threadId: approved.thread?.id,
            status: approved.status ?? approved.thread?.status,
            alreadyResolved: Boolean(approved.alreadyResolved),
          }
        : approved;
      const detail = {
        threadId: planId,
        approveResult: approvalDetail,
        status: afterApproval?.thread?.status,
        hasMarker: afterApproval?.hasMarker,
        toolCount: afterApproval?.toolCount,
        userMessageCount: afterApproval?.userMessageCount,
        renderedPlanPromptCount,
        planArtifactWrites,
        bashToolCount: allBashTools.length,
        planCommandTools: exactMarkerBashTools(afterApproval?.tools, "claude_plan_subagent_ok").map(
          (tool) => ({ name: tool.name, status: tool.status, agentId: tool.agentId }),
        ),
        agentCount: afterApproval?.agentCount,
        v2MessageCount: afterApproval?.messageCount,
        historyRevision: afterApproval?.head?.historyRevision,
        rendererConvergence: await waitForRendererConvergence(page, planId),
      };
      if (
        afterApproval?.thread?.status === "completed" &&
        afterApproval.hasMarker &&
        afterApproval.userMessageCount === 1 &&
        renderedPlanPromptCount === 1 &&
        afterApproval.agentCount > 1 &&
        detail.bashToolCount === 1 &&
        planArtifactWrites.length === 1 &&
        planArtifactWrites[0].status === "completed" &&
        planArtifactWrites[0].path.includes("/.claude/plans/") &&
        detail.planCommandTools.length === 1 &&
        detail.planCommandTools[0].status === "completed" &&
        detail.planCommandTools[0].agentId &&
        !detail.rendererConvergence?.timedOut
      ) {
        pass("longcat_claude_plan_v2_approved_subagent", detail);
      } else {
        fail("longcat_claude_plan_v2_approved_subagent", detail);
      }
    }
  }
}

console.log(JSON.stringify(report, null, 2));
await browser.close().catch(() => undefined);
process.exitCode = report.fail.length > 0 ? 1 : 0;
