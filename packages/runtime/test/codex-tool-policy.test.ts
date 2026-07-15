import { expect, test } from "bun:test";
import {
  applyCodexExecutionConfirmation,
  DEFAULT_CODEX_TOOL_POLICY,
  ecoToolPolicyToRoleTomlFields,
  normalizeEcoToolPolicy,
  resolveEffectiveTurnSandbox,
} from "../src/codex-tool-policy";

test("maps Eco execution-confirmation modes to Codex approval policies", () => {
  expect(applyCodexExecutionConfirmation(DEFAULT_CODEX_TOOL_POLICY, "always").approvalPolicy).toBe(
    "untrusted",
  );
  expect(applyCodexExecutionConfirmation(DEFAULT_CODEX_TOOL_POLICY, "auto").approvalPolicy).toBe(
    "on-request",
  );
  expect(
    applyCodexExecutionConfirmation(DEFAULT_CODEX_TOOL_POLICY, "allow_all").approvalPolicy,
  ).toBe("never");
  expect(DEFAULT_CODEX_TOOL_POLICY.approvalPolicy).toBe("on-request");
});

test("execution confirmation cannot widen an explicit Codex strict override", () => {
  expect(
    applyCodexExecutionConfirmation(DEFAULT_CODEX_TOOL_POLICY, "allow_all", {
      minimumApprovalPolicy: "untrusted",
    }).approvalPolicy,
  ).toBe("untrusted");
});

test("default policy is workspace-write + on-request", () => {
  expect(DEFAULT_CODEX_TOOL_POLICY.sandboxMode).toBe("workspace-write");
  expect(DEFAULT_CODEX_TOOL_POLICY.approvalPolicy).toBe("on-request");
});

test("normalizeEcoToolPolicy accepts Codex shape", () => {
  const policy = normalizeEcoToolPolicy({
    sandboxMode: "read-only",
    approvalPolicy: "untrusted",
    webSearch: "live",
    allowSpawn: false,
  });
  expect(policy.sandboxMode).toBe("read-only");
  expect(policy.approvalPolicy).toBe("untrusted");
  expect(policy.webSearch).toBe("live");
  expect(policy.allowSpawn).toBe(false);
});

test("normalizeEcoToolPolicy rejects networkAccess without workspace-write", () => {
  expect(() =>
    normalizeEcoToolPolicy({
      sandboxMode: "read-only",
      approvalPolicy: "on-request",
      networkAccess: true,
    }),
  ).toThrow(/networkAccess is only valid/);
});

test("legacy Claude write-none maps to read-only", () => {
  const policy = normalizeEcoToolPolicy({
    allowed: [],
    disallowed: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"],
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: true, webFetch: true },
  });
  expect(policy.sandboxMode).toBe("read-only");
  expect(policy.webSearch).toBe("live");
});

test("legacy Claude workspace write maps to workspace-write", () => {
  const policy = normalizeEcoToolPolicy({
    allowed: [],
    disallowed: [],
    bash: { enabled: true },
    filesystem: { read: "workspace", write: "workspace" },
    network: { webSearch: false, webFetch: false },
  });
  expect(policy.sandboxMode).toBe("workspace-write");
  expect(policy.webSearch).toBe("disabled");
});

test("semantic confirmation and Codex overrides only tighten the migrated policy", () => {
  const policy = normalizeEcoToolPolicy({
    allowed: [],
    disallowed: [],
    bash: { enabled: true },
    filesystem: { read: "workspace", write: "workspace" },
    confirmation: "never",
    coreOverrides: {
      claude: { disallowedTools: ["Bash"] },
      codex: { sandboxMode: "read-only", approvalPolicy: "untrusted" },
    },
  });
  expect(policy.sandboxMode).toBe("read-only");
  expect(policy.approvalPolicy).toBe("untrusted");
});

test("rejects widening Codex overrides", () => {
  expect(() =>
    normalizeEcoToolPolicy({
      allowed: [],
      disallowed: [],
      filesystem: { read: "workspace", write: "none" },
      coreOverrides: { codex: { sandboxMode: "workspace-write" } },
    }),
  ).toThrow(/only tighten/);
});

test("legacy bash disabled with writes fails closed", () => {
  expect(() =>
    normalizeEcoToolPolicy({
      allowed: [],
      disallowed: ["Bash"],
      bash: { enabled: false },
      filesystem: { read: "workspace", write: "workspace" },
    }),
  ).toThrow(/cannot remove shell/);
});

test("role toml fields include sandbox and approval", () => {
  const fields = ecoToolPolicyToRoleTomlFields(
    normalizeEcoToolPolicy({
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      networkAccess: true,
      webSearch: "cached",
    }),
  );
  expect(fields.sandbox_mode).toBe("workspace-write");
  expect(fields.approval_policy).toBe("on-request");
  expect(fields.web_search).toBe("cached");
  expect(fields.sandbox_workspace_write).toEqual({ network_access: true });
});

test("ask sessionMode forces readOnly even if profile is workspace-write", () => {
  const effective = resolveEffectiveTurnSandbox({
    sessionMode: "ask",
    profilePolicy: DEFAULT_CODEX_TOOL_POLICY,
  });
  expect(effective.sandboxPolicy).toBe("readOnly");
});

test("agent sessionMode uses profile danger-full-access", () => {
  const effective = resolveEffectiveTurnSandbox({
    sessionMode: "agent",
    profilePolicy: normalizeEcoToolPolicy({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    }),
  });
  expect(effective.sandboxPolicy).toBe("dangerFullAccess");
  expect(effective.approvalPolicy).toBe("never");
});

test("round-trip preserves Codex policy", () => {
  const original = normalizeEcoToolPolicy({
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    networkAccess: false,
    webSearch: "disabled",
    allowSpawn: true,
    mcp: { allowedServers: ["docs"], enabledTools: ["search"] },
  });
  expect(normalizeEcoToolPolicy(original)).toEqual(original);
});
