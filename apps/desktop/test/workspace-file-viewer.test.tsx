import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceFileViewer } from "../src/renderer/WorkspaceFileViewer";
import "../src/renderer/i18n";

test("renders a dedicated file viewer without a directory tree", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { eco: undefined },
  });
  try {
    const html = renderToStaticMarkup(
      createElement(WorkspaceFileViewer, {
        workspacePath: "/repo",
      }),
    );

    expect(html).toContain('class="workspace-file-viewer"');
    expect(html).not.toContain("workspace-file-browser__tree");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});
