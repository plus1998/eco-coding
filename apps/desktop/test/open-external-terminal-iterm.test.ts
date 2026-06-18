import { expect, test } from "bun:test";
import { buildITermOsascriptArgs } from "../src/main/open-external-terminal";

test("buildITermOsascriptArgs uses create window command to bypass login shell", () => {
  const args = buildITermOsascriptArgs("/bin/zsh -fc 'cd /tmp && bun run dev'");
  expect(args.join(" ")).toContain('tell application "iTerm"');
  expect(args.join(" ")).toContain("create window with default profile command");
  expect(args.join(" ")).toContain("/bin/zsh -fc 'cd /tmp && bun run dev'");
});

test("buildITermOsascriptArgs escapes double quotes in shell command", () => {
  const args = buildITermOsascriptArgs('/bin/zsh -fc \'echo "hello"\'');
  expect(args.join(" ")).toContain('echo \\"hello\\"');
});
