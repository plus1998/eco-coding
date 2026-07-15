import { expect, test } from "bun:test";
import {
  capabilityFieldsToToolPolicy,
  createDefaultToolCapabilityFields,
  isGroupedCapabilityToolName,
  stripGroupedToolsFromDisallowed,
  toolPolicyToCapabilityFields,
  TOOL_CAPABILITY_PRESETS,
} from "../src/renderer/tool-capability-groups";

test("toolPolicyToCapabilityFields and capabilityFieldsToToolPolicy round-trip", () => {
  const original = capabilityFieldsToToolPolicy(
    createDefaultToolCapabilityFields({
      writeCodebase: false,
      bash: false,
      network: false,
      taskProgress: false,
      allowDelegation: false,
      advancedDisallowedTools: "CustomTool",
    }),
  );

  const capability = toolPolicyToCapabilityFields(original, { allowDelegation: false });
  const roundTrip = capabilityFieldsToToolPolicy(capability);

  expect(roundTrip.disallowed).toEqual(
    expect.arrayContaining([
      "Write",
      "Bash",
      "WebSearch",
      "WebFetch",
      "TaskCreate",
      "Agent",
    ]),
  );
  expect(roundTrip.coreOverrides?.claude?.disallowedTools).toContain("CustomTool");
  expect(roundTrip.filesystem).toEqual({ read: "workspace", write: "none" });
  expect(roundTrip.bash).toEqual({ enabled: false });
  expect(roundTrip.network).toEqual({ webSearch: false, webFetch: false });
});

test("capability save strips grouped tools from advanced overrides", () => {
  const policy = capabilityFieldsToToolPolicy(
    createDefaultToolCapabilityFields({
      readCodebase: true,
      writeCodebase: true,
      bash: true,
      network: true,
      skill: true,
      askUser: true,
      taskProgress: true,
      allowDelegation: true,
      advancedDisallowedTools: "Agent, Read, CustomOnly",
    }),
  );

  expect(policy.disallowed).toEqual([]);
  expect(policy.coreOverrides?.claude?.disallowedTools).toEqual(["Agent", "Read", "CustomOnly"]);
  expect(policy.disallowed).not.toContain("Agent");
  expect(policy.disallowed).not.toContain("Read");
});

test("preset capability states are distinct", () => {
  const ids = TOOL_CAPABILITY_PRESETS.map((preset) => preset.id);
  expect(ids).toEqual(["readonly", "research", "coding", "review"]);
  expect(TOOL_CAPABILITY_PRESETS.find((preset) => preset.id === "coding")?.values.writeCodebase).toBe(true);
  expect(TOOL_CAPABILITY_PRESETS.find((preset) => preset.id === "readonly")?.values.bash).toBe(false);
});

test("toolPolicyToCapabilityFields treats partial network access as enabled", () => {
  const capability = toolPolicyToCapabilityFields({
    allowed: ["Read", "WebSearch"],
    disallowed: ["Bash"],
    filesystem: { read: "workspace", write: "none" },
    network: { webSearch: true, webFetch: false },
  });

  expect(capability.network).toBe(true);
  expect(capability.bash).toBe(false);
});
test("grouped tool filter helpers", () => {
  expect(isGroupedCapabilityToolName("TaskCreate")).toBe(true);
  expect(isGroupedCapabilityToolName("CustomTool")).toBe(false);
  expect(stripGroupedToolsFromDisallowed("Agent, CustomTool, Bash")).toBe("CustomTool");
});

test("rejects write access without shell because Codex cannot express it", () => {
  expect(() =>
    capabilityFieldsToToolPolicy(
      createDefaultToolCapabilityFields({ writeCodebase: true, bash: false }),
    ),
  ).toThrow("Codex 无法表达");
});

test("stores Core-specific policy only as tightening overrides", () => {
  const policy = capabilityFieldsToToolPolicy(
    createDefaultToolCapabilityFields({
      codexSandboxOverride: "read-only",
      codexApprovalOverride: "untrusted",
      advancedDisallowedTools: "CustomClaudeTool",
    }),
  );
  expect(policy.coreOverrides).toEqual({
    claude: { disallowedTools: ["CustomClaudeTool"] },
    codex: { sandboxMode: "read-only", approvalPolicy: "untrusted" },
  });
});
