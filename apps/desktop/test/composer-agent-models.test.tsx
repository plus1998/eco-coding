import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerAgentModelsCardBody } from "../src/renderer/ComposerAgentModels";
import type { SubagentEnabledSettings } from "../src/shared/ipc";

const subagentSettings: SubagentEnabledSettings = {
  explore: false,
  architect: false,
  coder: false,
  reviewer: false,
  tester: false,
};

test("Explore switch remains editable when it is disabled", () => {
  const markup = renderToStaticMarkup(
    <ComposerAgentModelsCardBody
      embedded
      labels={[
        {
          role: "explore",
          subagentRole: "explore",
          displayName: "Explore",
          title: "Explore",
          main: false,
        },
      ]}
      subagentSettings={subagentSettings}
      canEditSubagents
      onToggleSubagent={() => {}}
    />,
  );

  expect(markup).toContain('aria-label="Explore 已停用"');
  expect(markup).not.toContain("disabled");
});
