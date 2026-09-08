/**
 * Main-process only: inspect the live process tree for Screen Recording TCC host.
 * Must not be imported from sandboxed preload or renderer.
 */
import { spawnSync } from "node:child_process";
import {
  readProcessAncestorCommands,
  resolveScreenRecordingAppLabel,
} from "../shared/computer-use-screen-host";

function readMacOsProcessEntry(pid: number): { ppid: number; command: string } | undefined {
  if (process.platform !== "darwin" || !Number.isFinite(pid) || pid <= 1) {
    return undefined;
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "ppid=", "-o", "command="], {
    encoding: "utf8",
    timeout: 1_000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const line = (result.stdout ?? "").trim();
  if (!line) {
    return undefined;
  }
  const match = /^(\d+)\s+(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    ppid: Number(match[1]),
    command: match[2] ?? "",
  };
}

/** Label shown in System Settings → Screen Recording for this Eco process. */
export function detectScreenRecordingAppLabel(packaged: boolean): string {
  if (packaged) {
    return resolveScreenRecordingAppLabel({ packaged: true });
  }
  const ancestorCommands =
    process.platform === "darwin" && process.ppid > 1
      ? readProcessAncestorCommands(process.ppid, { readEntry: readMacOsProcessEntry })
      : [];
  return resolveScreenRecordingAppLabel({
    packaged: false,
    ancestorCommands,
    termProgram: process.env.TERM_PROGRAM,
  });
}
