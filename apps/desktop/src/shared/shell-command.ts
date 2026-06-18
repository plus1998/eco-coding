export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function windowsCmdQuote(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

export function formatPosixShellCommand(command: readonly string[], cwd: string): string {
  return `cd ${shellQuote(cwd)} && ${command.map(shellQuote).join(" ")}`;
}

/** @deprecated use formatPosixShellCommand */
export const formatShellCommand = formatPosixShellCommand;

export function buildPosixInnerCommand(
  command: readonly string[],
  cwd: string,
  pathValue: string,
): string {
  const segments: string[] = [];
  if (pathValue) {
    segments.push(`export PATH=${shellQuote(pathValue)}`);
  }
  segments.push(formatPosixShellCommand(command, cwd));
  return segments.join("; ");
}

export function buildMacTerminalScriptContent(
  command: readonly string[],
  cwd: string,
  pathValue: string,
): string {
  const lines = ["#!/bin/zsh -f"];
  if (pathValue) {
    lines.push(`export PATH=${shellQuote(pathValue)}`);
  }
  lines.push(formatPosixShellCommand(command, cwd));
  return `${lines.join("\n")}\n`;
}

export function buildMacITermOneLineCommand(
  command: readonly string[],
  cwd: string,
  pathValue: string,
): string {
  return `/bin/zsh -fc ${shellQuote(buildPosixInnerCommand(command, cwd, pathValue))}`;
}

export function buildLinuxOneLineCommand(
  command: readonly string[],
  cwd: string,
  pathValue: string,
): string {
  return `/bin/bash --noprofile --norc -c ${shellQuote(buildPosixInnerCommand(command, cwd, pathValue))}`;
}

export function buildWindowsCmdLine(
  command: readonly string[],
  cwd: string,
  pathValue: string,
): string {
  const segments: string[] = [];
  if (pathValue) {
    segments.push(`set PATH=${pathValue}`);
  }
  segments.push(`cd /d ${windowsCmdQuote(cwd)}`);
  segments.push(command.map(windowsCmdQuote).join(" "));
  return segments.join(" && ");
}

/** @deprecated use buildPosixInnerCommand */
export const buildExternalTerminalInnerCommand = buildPosixInnerCommand;

/** @deprecated use buildMacTerminalScriptContent */
export const buildExternalTerminalScriptContent = buildMacTerminalScriptContent;

/** @deprecated use buildMacITermOneLineCommand */
export const buildExternalTerminalOneLineCommand = buildMacITermOneLineCommand;
