import { chromium } from "playwright-core";

const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(cdpUrl);
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => candidate.url().startsWith("http://127.0.0.1:5174/"));
if (!page) {
  throw new Error("No Eco Electron page is available through CDP.");
}

const newConversation = page.locator("button.sidebar-action").filter({ hasText: "新对话" });
if ((await newConversation.count()) !== 1) {
  throw new Error("Expected one new-conversation button.");
}
await newConversation.click();

const codexCore = page.locator(".composer-core-segmented button").filter({ hasText: /^Codex$/ });
if ((await codexCore.count()) !== 1) {
  throw new Error("Expected one Codex Core selector.");
}
await codexCore.click();

const mcpUnsupported = page.locator('div[title="Codex Core 首版暂不支持 MCP"]');
await mcpUnsupported.waitFor({ state: "visible", timeout: 10_000 });
const mcpTrigger = mcpUnsupported.locator("button.composer-agents-trigger");
const mcpLabel = await mcpTrigger.getAttribute("aria-label");
if (!mcpLabel?.includes("已启用 0/")) {
  throw new Error(`Codex MCP summary is not disabled: ${mcpLabel ?? "missing"}`);
}
await mcpTrigger.click();
const mcpSwitches = page.locator('.composer-agents-popover[aria-label="MCP 服务器"] input[type="checkbox"]');
const mcpSwitchCount = await mcpSwitches.count();
for (let index = 0; index < mcpSwitchCount; index += 1) {
  const state = await mcpSwitches.nth(index).evaluate((input) => ({
    checked: input.checked,
    disabled: input.disabled,
  }));
  if (state.checked || !state.disabled) {
    throw new Error(`Codex MCP switch ${index} is not disabled: ${JSON.stringify(state)}`);
  }
}
await mcpTrigger.click();

const subagentUnsupported = page.locator('div[title="Codex Core 首版暂不支持子代理"]');
const subagentTrigger = subagentUnsupported.locator("button.composer-agents-trigger");
const subagentLabel = await subagentTrigger.getAttribute("aria-label");
if (!subagentLabel?.includes("已启用 0/")) {
  throw new Error(`Codex subagent summary is not disabled: ${subagentLabel ?? "missing"}`);
}
await subagentTrigger.click();
const subagentSwitches = page.locator(
  '.composer-agents-popover[aria-label="子代理详情"] input[type="checkbox"]',
);
const subagentSwitchCount = await subagentSwitches.count();
for (let index = 0; index < subagentSwitchCount; index += 1) {
  const state = await subagentSwitches.nth(index).evaluate((input) => ({
    checked: input.checked,
    disabled: input.disabled,
  }));
  if (state.checked || !state.disabled) {
    throw new Error(`Codex subagent switch ${index} is not disabled: ${JSON.stringify(state)}`);
  }
}
const disabledSubagentRows = await page
  .locator('.composer-agents-popover[aria-label="子代理详情"] .composer-agent-row.is-disabled')
  .count();
if (disabledSubagentRows === 0) {
  throw new Error("Codex subagent popover has no explicitly disabled rows.");
}
const clickableSubagentRows = await page
  .locator('.composer-agents-popover[aria-label="子代理详情"] .composer-agent-row.is-clickable')
  .count();
if (clickableSubagentRows !== 0) {
  throw new Error(`Codex subagent popover has ${clickableSubagentRows} clickable rows.`);
}

const skillsBarCount = await page.locator(".composer-skills-bar").count();
if (skillsBarCount !== 0) {
  throw new Error(`Codex should hide the project Skills bar, found ${skillsBarCount}.`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      core: "codex",
      mcpLabel,
      mcpSwitchCount,
      subagentLabel,
      subagentSwitchCount,
      disabledSubagentRows,
      skillsBarCount,
    },
    null,
    2,
  ),
);
await browser.close();
