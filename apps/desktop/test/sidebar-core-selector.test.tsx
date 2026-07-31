import { expect, test } from "bun:test";
import { createElement } from "react";
import { coreDisplayName, SidebarCoreSelector } from "../src/renderer/SidebarCoreSelector";
import { i18n } from "../src/renderer/i18n";
import type { AppLocale } from "../src/shared/locale";
import { renderLocalized } from "./i18n-test";

function renderSelector(locale: AppLocale, locked: boolean): string {
  return renderLocalized(
    createElement(SidebarCoreSelector, {
      coreKind: locked ? "codex" : "claude",
      locked,
      busy: false,
      codexAvailable: true,
      attentionItems: [],
      onChange: () => undefined,
      onOpenSearch: () => undefined,
      onSelectAttentionThread: () => undefined,
    }),
    locale,
  );
}

test("Core display names match the product labels in both locales", async () => {
  const previousLanguage = i18n.resolvedLanguage ?? i18n.language;
  try {
    expect(coreDisplayName("codex")).toBe("Codex");
    expect(coreDisplayName("claude")).toBe("Claude Code");

    await i18n.changeLanguage("zh-CN");
    expect(coreDisplayName(undefined)).toBe("Core 未知");

    await i18n.changeLanguage("en-US");
    expect(coreDisplayName(undefined)).toBe("Unknown core");
  } finally {
    await i18n.changeLanguage(previousLanguage);
  }
});

test("draft Core heading is switchable in both locales", () => {
  const chineseMarkup = renderSelector("zh-CN", false);
  const englishMarkup = renderSelector("en-US", false);

  expect(chineseMarkup).toContain("Claude Code");
  expect(chineseMarkup).toContain('aria-haspopup="menu"');
  expect(chineseMarkup).toContain('aria-expanded="false"');
  expect(chineseMarkup).toContain("lucide-chevron-down");
  expect(chineseMarkup).toContain('aria-label="搜索会话和项目"');
  expect(chineseMarkup).toContain('aria-label="需要关注的通知"');
  expect(chineseMarkup).toContain("lucide-bell");
  expect(englishMarkup).toContain('aria-label="Search threads and projects"');
  expect(englishMarkup).toContain('aria-label="Attention notifications"');
});

test("bound thread Core heading is read-only in both locales", () => {
  const chineseMarkup = renderSelector("zh-CN", true);
  const englishMarkup = renderSelector("en-US", true);

  expect(chineseMarkup).toContain("Codex");
  expect(chineseMarkup).not.toContain('aria-haspopup="menu"');
  expect(chineseMarkup).toContain('aria-label="搜索会话和项目"');
  expect(chineseMarkup).toContain('aria-label="需要关注的通知"');
  expect(englishMarkup).toContain('aria-label="Search threads and projects"');
  expect(englishMarkup).toContain('aria-label="Attention notifications"');
});

test("attention badge appears when items are present", () => {
  const markup = renderLocalized(
    createElement(SidebarCoreSelector, {
      coreKind: "claude",
      locked: false,
      busy: false,
      codexAvailable: true,
      attentionItems: [
        {
          id: "completed:t-1",
          threadId: "t-1",
          title: "完成任务",
          kind: "completed",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      onChange: () => undefined,
      onOpenSearch: () => undefined,
      onSelectAttentionThread: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("sidebar-core-attention-dot");
});
