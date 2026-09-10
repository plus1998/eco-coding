/**
 * CDP smoke for Codex 0.153.4 upgrade scenarios against a running Dev app.
 *
 * ECO_DEV_CDP_URL=http://127.0.0.1:9366 bun scripts/dev-cdp-codex-upgrade-smoke.mjs
 */
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL?.trim() || "http://127.0.0.1:9366";
const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "180000", 10);
const marker = `U153_${Date.now().toString(36).toUpperCase()}`;
const report = { ok: [], fail: [], meta: { cdpUrl, marker, timeoutMs } };

function pass(name, detail) {
  report.ok.push({ name, detail });
  console.log(`[pass] ${name}`, typeof detail === "string" ? detail : JSON.stringify(detail));
}
function fail(name, detail) {
  report.fail.push({ name, detail: String(detail) });
  console.error(`[fail] ${name}`, detail);
}

async function waitForThread(page, threadId, expectedStatuses, waitMs) {
  const startedAt = Date.now();
  let last;
  while (Date.now() - startedAt < waitMs) {
    last = await page.evaluate(async (id) => {
      const [thread, projection, pendingPlan, clarification, approval] = await Promise.all([
        window.eco.getThread(id),
        window.eco.getThreadRunProjection?.(id),
        window.eco.getPendingPlan?.(id),
        window.eco.getPendingClarification?.(id),
        window.eco.getPendingBashApproval?.(id),
      ]);
      if (approval?.toolUseId) {
        await window.eco.resolveBashApproval?.({ toolUseId: approval.toolUseId, decision: "approved" });
      }
      return { thread, projection, pendingPlan, clarification, approval };
    }, threadId);
    const status = last?.thread?.status;
    if (status && expectedStatuses.includes(status)) {
      return last;
    }
    if (status === "failed" || status === "interrupted") {
      return last;
    }
    await page.waitForTimeout(500);
  }
  return last;
}

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) {
  fail("cdp_page", "no page on CDP");
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}
await page.bringToFront();

// --- 1) Core availability / Codex version ---
try {
  const availability = await page.evaluate(async () => window.eco.getCoreAvailability());
  const version = String(availability?.codex?.version ?? "");
  if (!availability?.codex?.available) {
    fail("core_availability", availability);
  } else if (!/\b0\.153\.4\b/.test(version)) {
    fail("codex_version", `expected 0.153.4, got ${version}`);
  } else {
    pass("codex_version", version);
  }
} catch (error) {
  fail("core_availability", error);
}

// Template thread for workspace + runtimeConfig
const template = await page.evaluate(async () => {
  const threads = (await window.eco.listThreads?.()) ?? [];
  return (
    threads.find(
      (thread) =>
        thread.coreKind === "codex" &&
        thread.runtimeConfig &&
        thread.status !== "running" &&
        thread.status !== "queued",
    ) ??
    threads.find((thread) => thread.runtimeConfig && thread.status !== "running" && thread.status !== "queued")
  );
});

if (!template?.workspacePath || !template?.runtimeConfig) {
  fail("template_thread", "No idle thread with workspacePath + runtimeConfig");
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
  process.exit(1);
}
pass("template_thread", { id: template.id, workspacePath: template.workspacePath });

// --- 2) Ask mode ---
try {
  const askMarker = `ASK_${marker}`;
  const ask = await page.evaluate(
    async (request) => window.eco.startThread({ ...request, coreKind: "codex" }),
    {
      workspacePath: template.workspacePath,
      runtimeConfig: { ...template.runtimeConfig, sessionMode: "ask" },
      prompt: `Reply exactly ${askMarker}. Do not call tools or modify files.`,
    },
  );
  const askResult = await waitForThread(page, ask.thread.id, ["completed"], timeoutMs);
  const text = JSON.stringify(askResult?.projection ?? askResult?.thread ?? {});
  if (askResult?.thread?.status === "completed" && text.includes(askMarker)) {
    pass("ask_mode", { threadId: ask.thread.id, status: askResult.thread.status });
  } else {
    fail("ask_mode", {
      status: askResult?.thread?.status,
      message: askResult?.thread?.message,
      hasMarker: text.includes(askMarker),
    });
  }
} catch (error) {
  fail("ask_mode", error);
}

// --- 3) Plan mode (update_plan must remain available) ---
try {
  const planMarker = `PLAN_${marker}`;
  const plan = await page.evaluate(
    async (request) => window.eco.startThread({ ...request, coreKind: "codex" }),
    {
      workspacePath: template.workspacePath,
      runtimeConfig: { ...template.runtimeConfig, sessionMode: "plan" },
      prompt: [
        "Create a concise implementation plan without calling tools or modifying files.",
        `Include the exact marker ${planMarker} in the plan text.`,
      ].join(" "),
    },
  );
  const planResult = await waitForThread(page, plan.thread.id, ["awaiting_plan", "completed"], timeoutMs);
  const pending = planResult?.pendingPlan?.plan || "";
  const ok =
    planResult?.thread?.status === "awaiting_plan" &&
    Boolean(planResult?.pendingPlan) &&
    (pending.includes(planMarker) || JSON.stringify(planResult.projection ?? {}).includes(planMarker));
  if (ok) {
    pass("plan_mode_update_plan", {
      threadId: plan.thread.id,
      status: planResult.thread.status,
      hasPendingPlan: Boolean(planResult.pendingPlan),
    });
  } else {
    fail("plan_mode_update_plan", {
      status: planResult?.thread?.status,
      message: planResult?.thread?.message,
      hasPendingPlan: Boolean(planResult?.pendingPlan),
      pendingSnippet: String(pending).slice(0, 240),
    });
  }
} catch (error) {
  fail("plan_mode_update_plan", error);
}

// --- 4) Agent turn + mid-turn follow-up steer ---
try {
  const steerMarker = `STEER_${marker}`;
  const base = await page.evaluate(
    async (request) => window.eco.startThread({ ...request, coreKind: "codex" }),
    {
      workspacePath: template.workspacePath,
      runtimeConfig: {
        ...template.runtimeConfig,
        sessionMode: "agent",
        bashReviewMode: "allow_all",
        followUpDeliveryMode: "steer",
      },
      prompt: [
        "You are in a long-running agent turn.",
        "First reply with a short sentence acknowledging you are waiting for a mid-turn follow-up.",
        "Do not finish the task until you receive a follow-up containing STEER_INJECT.",
        "When you receive STEER_INJECT, reply exactly with the marker that follows it and stop.",
      ].join(" "),
    },
  );

  // Wait until running, then enqueue steer follow-up
  const startedAt = Date.now();
  let running = false;
  while (Date.now() - startedAt < 60_000) {
    const t = await page.evaluate(async (id) => window.eco.getThread(id), base.thread.id);
    if (t?.status === "running") {
      running = true;
      break;
    }
    if (t?.status === "failed" || t?.status === "interrupted" || t?.status === "completed") {
      break;
    }
    await page.waitForTimeout(400);
  }

  if (!running) {
    fail("mid_turn_steer", `thread never reached running (${base.thread.id})`);
  } else {
    const enqueue =
      (await page.evaluate(
        async ({ threadId, prompt }) => {
          if (typeof window.eco.enqueueThreadFollowUp === "function") {
            return window.eco.enqueueThreadFollowUp({
              threadId,
              prompt,
              followUpDeliveryMode: "steer",
            });
          }
          if (typeof window.eco.enqueueFollowUp === "function") {
            return window.eco.enqueueFollowUp({
              threadId,
              prompt,
              followUpDeliveryMode: "steer",
            });
          }
          // Fallback: continueThread may queue/steer depending on settings
          return window.eco.continueThread({ threadId, prompt });
        },
        {
          threadId: base.thread.id,
          prompt: `STEER_INJECT ${steerMarker}. Reply exactly ${steerMarker} and stop.`,
        },
      )) ?? null;

    const result = await waitForThread(page, base.thread.id, ["completed"], timeoutMs);
    const blob = JSON.stringify(result?.projection ?? result?.thread ?? {});
    if (result?.thread?.status === "completed" && blob.includes(steerMarker)) {
      pass("mid_turn_steer", { threadId: base.thread.id, enqueue });
    } else {
      fail("mid_turn_steer", {
        status: result?.thread?.status,
        message: result?.thread?.message,
        hasMarker: blob.includes(steerMarker),
        enqueue,
      });
    }
  }
} catch (error) {
  fail("mid_turn_steer", error);
}

// --- 5) Bash approval path ---
try {
  const approvalMarker = `APPR_${marker}`;
  const started = await page.evaluate(
    async (request) => window.eco.startThread({ ...request, coreKind: "codex" }),
    {
      workspacePath: template.workspacePath,
      runtimeConfig: {
        ...template.runtimeConfig,
        sessionMode: "agent",
        bashReviewMode: "always",
      },
      prompt: [
        process.platform === "win32"
          ? `Run this shell command: powershell -NoProfile -Command "Write-Output ${approvalMarker}"`
          : `Run this shell command: printf ${approvalMarker}`,
        "Do not modify files.",
        `After it completes, reply only with ${approvalMarker}.`,
      ].join(" "),
    },
  );
  const result = await waitForThread(page, started.thread.id, ["completed"], timeoutMs);
  const blob = JSON.stringify(result?.projection ?? result?.thread ?? {});
  if (result?.thread?.status === "completed" && blob.includes(approvalMarker)) {
    pass("bash_approval", { threadId: started.thread.id });
  } else {
    fail("bash_approval", {
      status: result?.thread?.status,
      message: result?.thread?.message,
      hasMarker: blob.includes(approvalMarker),
    });
  }
} catch (error) {
  fail("bash_approval", error);
}

// --- 6) Composer UI: Codex core + MCP/subagent triggers ---
try {
  await page.getByRole("button", { name: /新对话/ }).click({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const coreBtn = page.locator(".composer-core-segmented button").filter({ hasText: /^Codex$/ });
  if ((await coreBtn.count()) > 0) {
    await coreBtn.click();
  } else {
    await page.getByRole("button", { name: /当前 Core/ }).click({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await page.getByRole("menuitemradio", { name: /Codex/i }).click();
  }
  await page.waitForTimeout(500);

  const mcpTrigger = page
    .locator(".composer-context-bar")
    .locator('button.composer-agents-trigger[aria-label*="MCP"]');
  const subagentTrigger = page
    .locator(".composer-context-bar")
    .locator('button.composer-agents-trigger[aria-label*="子代理"]');
  const mcpLabel = (await mcpTrigger.count()) ? await mcpTrigger.getAttribute("aria-label") : null;
  const subLabel = (await subagentTrigger.count()) ? await subagentTrigger.getAttribute("aria-label") : null;
  if (mcpLabel && subLabel) {
    pass("composer_ui_codex_mcp_subagent", { mcpLabel, subLabel });
  } else {
    fail("composer_ui_codex_mcp_subagent", { mcpLabel, subLabel });
  }
} catch (error) {
  fail("composer_ui_codex_mcp_subagent", error);
}

// --- 7) Clarification panel plumbing (no model async force): ensure API exists ---
try {
  const api = await page.evaluate(() => ({
    getPendingClarification: typeof window.eco.getPendingClarification === "function",
    submitClarification: typeof window.eco.submitClarification === "function",
    dismissClarification: typeof window.eco.dismissClarification === "function",
  }));
  if (api.getPendingClarification && api.submitClarification) {
    pass("clarification_api_surface", api);
  } else {
    fail("clarification_api_surface", api);
  }
} catch (error) {
  fail("clarification_api_surface", error);
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.fail.length ? 1 : 0;
await browser.close().catch(() => undefined);
