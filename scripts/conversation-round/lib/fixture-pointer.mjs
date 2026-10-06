import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Resolve the same recording after the repository moves to another machine. */
export function resolveFixturePointerDir(pointerPath) {
  const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
  const directory = path.dirname(pointerPath);
  const candidates = [];
  // Prefer this checkout's recording over an absolute path saved by the recorder.
  if (typeof pointer.runId === "string" && pointer.runId.trim()) {
    candidates.push(path.resolve(directory, pointer.runId));
  }
  if (typeof pointer.path === "string" && pointer.path.trim()) {
    candidates.push(path.resolve(directory, pointer.path));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error(`Fixture directory missing for ${pointerPath}; checked: ${candidates.join(", ") || "pointer has neither runId nor path"}`);
}
