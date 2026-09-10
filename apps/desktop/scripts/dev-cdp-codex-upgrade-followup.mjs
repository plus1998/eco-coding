/**
 * Follow-up CDP checks after upgrade smoke:
 * - concrete plan mode (native pending plan)
 * - composer MCP/subagent triggers on new chat
 *
 * ECO_DEV_CDP_URL=http://127.0.0.1:9366 bun scripts/dev-cdp-codex-upgrade-followup.mjs
 */
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL?.trim() || "http://127.0.0.1:9366";
const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "180000", 10);
const marker = `PLAN2_${Date.now().toString(36).toUpperCase()}`;

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) throw new Error("no page");
await page.bringToFront();

const hung = await page.evaluate(async () => {
  const threads = await window.eco.listThreads();
  const t = threads.find((x) => x.id === "thr_1788955018476" && x.status === "running");
  if (!t) return null;
  if (typeof window.eco.cancelThread === "function") {
    await window.eco.cancelThread(t.id).catch(() => undefined);
  }
  if (typeof window.eco.interruptThread === "function") {
    await window.eco.interruptThread(t.id).catch(() => undefined);
  }
  return t.id;
});
console.log("[interrupt]", hung);

const template = await page.evaluate(async () => {
  const threads = await window.eco.listThreads();
  return threads.find(
    (t) =>
      t.coreKind === "codex" &&
      t.runtimeConfig &&
      t.status !== "running" &&
      t.status !== "queued",
  );
});
if (!template) throw new Error("no template");

const started = await page.evaluate(
  async (input) =>
    window.eco.startThread({
      workspacePath: input.workspacePath,
      coreKind: "codex",
      runtimeConfig: { ...input.runtimeConfig, sessionMode: "plan" },
      prompt: input.prompt,
    }),
  {
    workspacePath: template.workspacePath,
    runtimeConfig: template.runtimeConfig,
    prompt: [
      "Plan how to add a /healthz HTTP endpoint that returns {ok:true}.",
      "Do not call tools or modify files.",
      "Produce a native structured plan (not just chat).",
      `Include marker ${marker} somewhere in the plan text.`,
    ].join(" "),
  },
);
console.log("[start]", started.thread.id);

const startedAt = Date.now();
let last;
while (Date.now() - startedAt < timeoutMs) {
  last = await page.evaluate(
    async ({ id, markerText }) => {
      const pendingApproval = await window.eco.getPendingBashApproval?.(id);
      if (pendingApproval?.toolUseId) {
        await window.eco.resolveBashApproval({
          toolUseId: pendingApproval.toolUseId,
          decision: "approved",
        });
      }
      const [thread, pendingPlan, projection] = await Promise.all([
        window.eco.getThread(id),
        window.eco.getPendingPlan(id),
        window.eco.getThreadRunProjection(id),
      ]);
      return {
        status: thread?.status,
        message: thread?.message,
        hasPendingPlan: Boolean(pendingPlan?.plan),
        planHead: String(pendingPlan?.plan || "").slice(0, 240),
        eventTypes: [...new Set((projection?.timeline || []).map((e) => e.eventType))],
        hasMarker: JSON.stringify({ pendingPlan, projection }).includes(markerText),
      };
    },
    { id: started.thread.id, markerText: marker },
  );
  console.log(
    "[poll]",
    JSON.stringify({
      status: last.status,
      hasPendingPlan: last.hasPendingPlan,
      hasMarker: last.hasMarker,
    }),
  );
  if (last.status === "awaiting_plan" || (last.hasPendingPlan && last.status !== "running")) {
    break;
  }
  if (last.status === "failed" || last.status === "interrupted") break;
  if (last.status === "idle" || last.status === "completed") break;
  await page.waitForTimeout(1000);
}

await page.getByRole("button", { name: "新对话" }).click({ timeout: 15_000 });
await page.waitForTimeout(800);
const coreBtn = page.getByRole("button", { name: /当前 Core/ });
if (await coreBtn.count()) {
  const label = await coreBtn.getAttribute("aria-label");
  if (label && !/Codex/i.test(label)) {
    await coreBtn.click();
    await page.waitForTimeout(300);
    await page.getByRole("menuitemradio", { name: /Codex/i }).click({ timeout: 8_000 });
    await page.waitForTimeout(500);
  }
}

const ui = await page.evaluate(() => {
  const core =
    document.querySelector('button[aria-label*="当前 Core"]')?.getAttribute("aria-label") ||
    [...document.querySelectorAll("button")].find((b) => /Codex|Claude|Cursor/.test(b.textContent || ""))
      ?.textContent ||
    null;
  const triggers = [...document.querySelectorAll("button.composer-agents-trigger, .composer-context-bar button")]
    .map((b) => b.getAttribute("aria-label") || b.textContent?.trim())
    .filter(Boolean)
    .slice(0, 30);
  return { core, triggers };
});

const planOk = last?.status === "awaiting_plan" || Boolean(last?.hasPendingPlan);
const uiOk =
  /Codex/i.test(String(ui.core || "")) &&
  ui.triggers.some((t) => /MCP/i.test(String(t))) &&
  ui.triggers.some((t) => /子代理/.test(String(t)));

console.log(
  JSON.stringify(
    {
      marker,
      planOk,
      planResult: last,
      uiOk,
      ui,
    },
    null,
    2,
  ),
);

await browser.close().catch(() => undefined);
process.exitCode = planOk && uiOk ? 0 : 1;
