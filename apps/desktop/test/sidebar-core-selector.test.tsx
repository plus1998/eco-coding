import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { coreDisplayName, SidebarCoreSelector } from "../src/renderer/SidebarCoreSelector";

test("Core display names match the product labels", () => {
  expect(coreDisplayName("codex")).toBe("Codex");
  expect(coreDisplayName("claude")).toBe("Claude Code");
  expect(coreDisplayName(undefined)).toBe("Core 未知");
});

test("draft Core heading is switchable", () => {
  const markup = renderToStaticMarkup(
    createElement(SidebarCoreSelector, {
      coreKind: "claude",
      locked: false,
      busy: false,
      codexAvailable: true,
      onChange: () => undefined,
    }),
  );

  expect(markup).toContain("Claude Code");
  expect(markup).toContain('aria-haspopup="menu"');
  expect(markup).toContain('aria-expanded="false"');
});

test("bound thread Core heading is read-only", () => {
  const markup = renderToStaticMarkup(
    createElement(SidebarCoreSelector, {
      coreKind: "codex",
      locked: true,
      busy: false,
      codexAvailable: true,
      onChange: () => undefined,
    }),
  );

  expect(markup).toContain("Codex");
  expect(markup).not.toContain('aria-haspopup="menu"');
  expect(markup).not.toContain("<button");
});
