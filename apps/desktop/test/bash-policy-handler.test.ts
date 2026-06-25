import { expect, test } from "bun:test";
import { evaluateThreadToolConfirmation } from "../src/main/thread-bash-permission";

const workspace = "/repo";
const cwd = "/repo";

test("always mode asks for safe commands", () => {
  const decision = evaluateThreadToolConfirmation({
    command: "echo ok",
    cwd,
    workspacePath: workspace,
    confirmationMode: "always",
  });
  expect(decision.action).toBe("ask");
});

test("auto mode allows low-risk commands", () => {
  const decision = evaluateThreadToolConfirmation({
    command: "python3 -c 'print(1)'",
    cwd,
    workspacePath: workspace,
    confirmationMode: "auto",
  });
  expect(decision.action).toBe("allow");
});

test("allow_all mode still denies rm -rf /", () => {
  const decision = evaluateThreadToolConfirmation({
    command: "rm -rf /",
    cwd,
    workspacePath: workspace,
    confirmationMode: "allow_all",
  });
  expect(decision.action).toBe("deny");
});

test("plan phase denies bash when phaseAllowsExecution is false", () => {
  const decision = evaluateThreadToolConfirmation({
    command: "grep -R foo .",
    cwd,
    workspacePath: workspace,
    confirmationMode: "allow_all",
    phaseAllowsExecution: false,
  });
  expect(decision.action).toBe("deny");
  expect(decision.matchedRule).toBe("phase_execution_disabled");
});
