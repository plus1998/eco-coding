import { expect, test } from "bun:test";
import {
  buildBashApprovalRememberPrefixLabel,
  commandMatchesAnyRememberedBashPrefix,
  commandMatchesRememberedBashPrefix,
  formatBashApprovalDenyMessage,
  deriveBashApprovalRememberPrefix,
} from "../src/shared/bash-approval-ui";

test("commandMatchesRememberedBashPrefix matches exact and continuing commands", () => {
  expect(commandMatchesRememberedBashPrefix("bun -e 'console.log(1)'", "bun -e 'console.log(1)'")).toBe(true);
  expect(
    commandMatchesRememberedBashPrefix(
      "bun -e 'console.log(2)'",
      "bun -e 'console.log(1)'",
    ),
  ).toBe(false);
  expect(commandMatchesRememberedBashPrefix("bun test apps/desktop", "bun test")).toBe(true);
});

test("commandMatchesAnyRememberedBashPrefix checks all prefixes", () => {
  expect(
    commandMatchesAnyRememberedBashPrefix("bun test ipc", ["npm test", "bun test"]),
  ).toBe(true);
  expect(commandMatchesAnyRememberedBashPrefix("pnpm test", ["bun test"])).toBe(false);
});

test("buildBashApprovalRememberPrefixLabel truncates long commands", () => {
  const long = "bun -e '" + "x".repeat(80) + "'";
  expect(buildBashApprovalRememberPrefixLabel(long)).toContain("…");
});

test("formatBashApprovalDenyMessage includes user feedback when provided", () => {
  expect(formatBashApprovalDenyMessage()).toBe("User denied this Bash command.");
  expect(formatBashApprovalDenyMessage("  use read-only aggregate  ")).toBe(
    "User denied this Bash command. User feedback: use read-only aggregate",
  );
});

test("deriveBashApprovalRememberPrefix trims command", () => {
  expect(deriveBashApprovalRememberPrefix("  bun test  ")).toBe("bun test");
});
