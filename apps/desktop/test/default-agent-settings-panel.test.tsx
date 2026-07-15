import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DefaultAgentSettingsPanel } from "../src/renderer/DefaultAgentSettingsPanel";

test("default Agent settings renders Claude Code and Codex choices", () => {
  const markup = renderToStaticMarkup(
    createElement(DefaultAgentSettingsPanel, {
      defaultCoreKind: "claude",
      codexAvailable: true,
      onChange: () => undefined,
    }),
  );

  expect(markup).toContain("默认 Agent");
  expect(markup).toContain("Claude Code");
  expect(markup).toContain("Codex");
  expect(markup).toContain('role="radiogroup"');
  expect(markup).toContain('checked="" value="claude"');
  expect(markup).toContain('src="/agent-icons/claude-code.ico"');
  expect(markup).toContain('src="/agent-icons/codex.ico"');
});

test("unavailable Codex is disabled with its explicit reason", () => {
  const markup = renderToStaticMarkup(
    createElement(DefaultAgentSettingsPanel, {
      defaultCoreKind: "claude",
      codexAvailable: false,
      codexUnavailableReason: "未安装 Codex CLI",
      onChange: () => undefined,
    }),
  );

  expect(markup).toContain("未安装 Codex CLI");
  expect(markup).toContain("disabled");
});
