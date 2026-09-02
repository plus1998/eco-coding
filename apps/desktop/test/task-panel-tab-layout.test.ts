import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("task panel tabs truncate labels without covering the close button", () => {
  expect(styles).toContain(".subagent-task-panel-tab > span:not(.subagent-task-panel-tab-meta)");
  expect(styles).toMatch(
    /\.subagent-task-panel-tab-shell \.subagent-task-panel-tab\s*\{[^}]*padding-right:\s*30px;/s,
  );
  expect(styles).toMatch(
    /\.subagent-task-panel-tab > span:not\(\.subagent-task-panel-tab-meta\)\s*\{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
  );
  expect(styles).toMatch(/\.subagent-task-panel-tab-close\s*\{[^}]*z-index:\s*1;[^}]*width:\s*22px;/s);
});

test("fullscreen task tabs clear macOS traffic lights when the project sidebar is collapsed", () => {
  expect(styles).toMatch(
    /@media \(min-width: 721px\) \{[\s\S]*?html\[data-platform="darwin"\][\s\S]*?\.shell\.shell-sidebar-hidden[\s\S]*?\.is-task-panel-fullscreen[\s\S]*?\.subagent-task-panel-topbar[\s\S]*?padding-left:\s*max\(10px,\s*var\(--macos-window-controls-safe-inline-start\)\)/,
  );
  expect(styles).toMatch(
    /@media \(min-width: 721px\) \{[\s\S]*?html:not\(\[data-platform="darwin"\]\)[\s\S]*?\.shell\.shell-sidebar-hidden[\s\S]*?\.is-task-panel-fullscreen[\s\S]*?\.subagent-task-panel-topbar[\s\S]*?padding-left:\s*max\(10px,\s*var\(--window-sidebar-toolbar-inset-expanded\)\)/,
  );
  expect(styles).toMatch(
    /is-narrow-new-thread[\s\S]*?\.is-task-panel-fullscreen[\s\S]*?\.subagent-task-panel-topbar[\s\S]*?padding-left:\s*max\(10px,\s*var\(--macos-window-controls-safe-inline-start-new-thread\)\)/,
  );
});
