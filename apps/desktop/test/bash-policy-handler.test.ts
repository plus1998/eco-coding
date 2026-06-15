import { expect, test } from "bun:test";
import { evaluateThreadBashPermission } from "../src/main/thread-bash-permission";

const workspace = "/repo";
const cwd = "/repo";

test("always mode asks for safe commands", () => {
  const decision = evaluateThreadBashPermission({
    command: "echo ok",
    cwd,
    workspacePath: workspace,
    bashReviewMode: "always",
  });
  expect(decision.action).toBe("ask");
});

test("auto mode allows low-risk commands", () => {
  const decision = evaluateThreadBashPermission({
    command: "python3 -c 'print(1)'",
    cwd,
    workspacePath: workspace,
    bashReviewMode: "auto",
  });
  expect(decision.action).toBe("allow");
});

test("allow_all mode still denies rm -rf /", () => {
  const decision = evaluateThreadBashPermission({
    command: "rm -rf /",
    cwd,
    workspacePath: workspace,
    bashReviewMode: "allow_all",
  });
  expect(decision.action).toBe("deny");
});

test("plan phase denies bash when phaseAllowsBash is false", () => {
  const decision = evaluateThreadBashPermission({
    command: "grep -R foo .",
    cwd,
    workspacePath: workspace,
    bashReviewMode: "allow_all",
    phaseAllowsBash: false,
  });
  expect(decision.action).toBe("deny");
  expect(decision.matchedRule).toBe("phase_bash_disabled");
});
