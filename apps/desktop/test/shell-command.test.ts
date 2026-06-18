import { expect, test } from "bun:test";
import {
  buildLinuxOneLineCommand,
  buildMacITermOneLineCommand,
  buildMacTerminalScriptContent,
  buildPosixInnerCommand,
  buildWindowsCmdLine,
  formatPosixShellCommand,
  shellQuote,
  windowsCmdQuote,
} from "../src/shared/shell-command";

test("shellQuote leaves simple tokens unquoted", () => {
  expect(shellQuote("bun")).toBe("bun");
  expect(shellQuote("run")).toBe("run");
});

test("shellQuote wraps values with spaces", () => {
  expect(shellQuote("/tmp/my project")).toBe("'/tmp/my project'");
});

test("formatPosixShellCommand builds cd and command chain", () => {
  expect(formatPosixShellCommand(["bun", "run", "dev"], "/workspace/eco")).toBe(
    "cd /workspace/eco && bun run dev",
  );
});

test("buildMacTerminalScriptContent uses zsh -f shebang", () => {
  const content = buildMacTerminalScriptContent(
    ["/Users/plus/.bun/bin/bun", "run", "publish", "root@8.163.69.251"],
    "/workspace/demo",
    "/Users/plus/.bun/bin:/opt/homebrew/bin",
  );
  expect(content).toStartWith("#!/bin/zsh -f\n");
  expect(content).toContain("cd /workspace/demo && /Users/plus/.bun/bin/bun run publish root@8.163.69.251");
});

test("buildMacITermOneLineCommand wraps command in zsh -fc", () => {
  const command = buildMacITermOneLineCommand(
    ["/Users/plus/.bun/bin/bun", "run", "dev"],
    "/workspace/demo",
    "/Users/plus/.bun/bin",
  );
  expect(command).toStartWith("/bin/zsh -fc ");
});

test("buildLinuxOneLineCommand uses bash --noprofile --norc", () => {
  const command = buildLinuxOneLineCommand(["bun", "run", "dev"], "/workspace/demo", "/opt/homebrew/bin");
  expect(command).toStartWith("/bin/bash --noprofile --norc -c ");
  expect(command).toContain("cd /workspace/demo && bun run dev");
});

test("buildWindowsCmdLine uses cmd syntax", () => {
  expect(
    buildWindowsCmdLine(
      ["C:\\Users\\plus\\.bun\\bin\\bun.exe", "run", "dev"],
      "C:\\workspace\\demo",
      "C:\\Users\\plus\\.bun\\bin;C:\\Windows\\system32",
    ),
  ).toBe(
    'set PATH=C:\\Users\\plus\\.bun\\bin;C:\\Windows\\system32 && cd /d C:\\workspace\\demo && C:\\Users\\plus\\.bun\\bin\\bun.exe run dev',
  );
});

test("windowsCmdQuote wraps paths with spaces", () => {
  expect(windowsCmdQuote("C:\\workspace\\my project")).toBe('"C:\\workspace\\my project"');
});

test("buildPosixInnerCommand joins path export and script with semicolons", () => {
  expect(buildPosixInnerCommand(["bun", "run", "dev"], "/workspace/demo", "/opt/homebrew/bin")).toBe(
    "export PATH=/opt/homebrew/bin; cd /workspace/demo && bun run dev",
  );
});
