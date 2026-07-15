import { chromium } from "playwright-core";

const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(cdpUrl);
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => candidate.url().startsWith("http://127.0.0.1:"));
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

const mcpControl = page.locator('.composer-context-bar').locator('button.composer-agents-trigger[aria-label*="MCP"]');
const mcpTrigger = mcpControl;
const mcpLabel = await mcpTrigger.getAttribute("aria-label");
if (!mcpLabel?.includes("MCP")) throw new Error(`Codex MCP summary is missing: ${mcpLabel ?? "missing"}`);
await mcpTrigger.click();
const mcpSwitches = page.locator('.composer-agents-popover[aria-label="MCP 服务器"] input[type="checkbox"]');
const mcpSwitchCount = await mcpSwitches.count();
for (let index = 0; index < mcpSwitchCount; index += 1) {
  const state = await mcpSwitches.nth(index).evaluate((input) => ({
    checked: input.checked,
    disabled: input.disabled,
  }));
  if (state.disabled) throw new Error(`Codex MCP switch ${index} is disabled.`);
}
await mcpTrigger.click();

const subagentTrigger = page.locator('.composer-context-bar').locator('button.composer-agents-trigger[aria-label*="子代理"]');
const subagentLabel = await subagentTrigger.getAttribute("aria-label");
if (!subagentLabel?.includes("子代理")) throw new Error(`Codex subagent summary is missing: ${subagentLabel ?? "missing"}`);
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
  if (state.disabled) throw new Error(`Codex subagent switch ${index} is disabled.`);
}
const clickableSubagentRows = await page
  .locator('.composer-agents-popover[aria-label="子代理详情"] .composer-agent-row.is-clickable')
  .count();
if (clickableSubagentRows === 0) throw new Error("Codex subagent popover has no editable rows.");

const skillsBarCount = await page.locator(".composer-skills-bar").count();
const composerInput = page.locator('.composer-primary [contenteditable="true"]');
if ((await composerInput.count()) !== 1) throw new Error("Codex composer input is missing.");

console.log(
  JSON.stringify(
    {
      ok: true,
      core: "codex",
      mcpLabel,
      mcpSwitchCount,
      subagentLabel,
      subagentSwitchCount,
      clickableSubagentRows,
      skillsBarCount,
    },
    null,
    2,
  ),
);
await browser.close();
