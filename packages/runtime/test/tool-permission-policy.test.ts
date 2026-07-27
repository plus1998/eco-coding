import { expect, test } from "bun:test";
import type { EcoToolPolicy } from "../src/agent-orchestration";
import {
  capEcoToolPolicyForPhase,
  materializeEcoToolPolicy,
  mergeSdkDisallowedTools,
  resolveMainAgentHandsOnFromPolicy,
} from "../src/tool-permission-policy";

function policy(overrides: Partial<EcoToolPolicy> = {}): EcoToolPolicy {
  return {
    allowed: [],
    disallowed: [],
    ...overrides,
  };
}

test("materializeEcoToolPolicy expands structured flags into disallowed", () => {
  const materialized = materializeEcoToolPolicy(
    policy({
      bash: { enabled: false },
      filesystem: { read: "workspace", write: "none" },
      network: { webSearch: false, webFetch: false },
    }),
  );
  expect(materialized.disallowed).toEqual(
    expect.arrayContaining(["Bash", "Write", "Edit", "WebSearch", "WebFetch"]),
  );
  expect(materialized.bash?.enabled).toBe(false);
});

test("materializeEcoToolPolicy keeps reviewer bash when only writes are blocked", () => {
  const materialized = materializeEcoToolPolicy(
    policy({
      disallowed: ["Write", "Edit", "MultiEdit", "NotebookEdit"],
      bash: { enabled: true },
      filesystem: { read: "workspace", write: "none" },
      network: { webSearch: false, webFetch: false },
    }),
  );
  expect(materialized.disallowed).toContain("Write");
  expect(materialized.disallowed).not.toContain("Bash");
  expect(materialized.bash?.enabled).toBe(true);
  expect(resolveMainAgentHandsOnFromPolicy(materialized)).toEqual({
    canEditFiles: false,
    canRunBash: true,
  });
});

test("materializeEcoToolPolicy tolerates legacy policies without explicit allow lists", () => {
  const materialized = materializeEcoToolPolicy({
    bash: { enabled: false },
  } as EcoToolPolicy);

  expect(materialized.allowed).toEqual([]);
  expect(materialized.disallowed).toContain("Bash");
  expect(materialized.bash?.enabled).toBe(false);
});

test("capEcoToolPolicyForPhase adds phase disallows without implicit bash inference", () => {
  const capped = capEcoToolPolicyForPhase(
    policy({
      bash: { enabled: true },
      filesystem: { read: "workspace", write: "workspace" },
      network: { webSearch: true, webFetch: true },
    }),
    ["Agent", "Read", "Glob", "Grep", "WebSearch", "AskUserQuestion"],
  );
  expect(capped.disallowed).toEqual(
    expect.arrayContaining([
      "Bash",
      "Write",
      "Edit",
      "MultiEdit",
      "NotebookEdit",
      "TaskCreate",
      "TaskUpdate",
      "TodoWrite",
    ]),
  );
  expect(capped.filesystem).toEqual({ read: "workspace", write: "workspace" });
});

test("mergeSdkDisallowedTools deduplicates orchestration and phase denylists", () => {
  expect(mergeSdkDisallowedTools(["Write", "Bash"], ["Bash", "Edit"], undefined)).toEqual([
    "Write",
    "Bash",
    "Edit",
  ]);
});
