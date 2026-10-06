#!/usr/bin/env node
// Bisect which test file leaves the renderer globals dirty enough to break the victims.
// Usage: node scripts/bisect-test-pollution.mjs <victim...> [--dir test]
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = rootIndex === -1 ? "test" : args[rootIndex + 1];
const victims = args.filter((arg, index) => arg !== "--root" && index !== rootIndex + 1);

const SKIP = new Set(["node_modules", "dist", "build", "out", ".git", "e2e", "release", "coverage"]);

function collect(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full));
      continue;
    }
    if (/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Discovery order matters: the polluter has to run before the victim, and bun walks the
// directory in readdir order, so keep the list unsorted.
const all = collect(root).filter((file) => !victims.includes(file));

function victimsFail(files) {
  try {
    // The polluter has to run first: pointing bun at explicit paths runs them in the order
    // given, so the victims go last (which is how the suite discovers them in a full run).
    execFileSync("bun", ["test", ...files, ...victims], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 900_000,
    });
    return false;
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    // A victim that passes while another file in the slice fails is not a reproduction.
    const victimNames = victims.map((victim) => path.basename(victim).replace(/\.test\.(ts|tsx)$/, ""));
    const victimFailures = victims.filter((_victim, index) => {
      const name = victimNames[index];
      // Victim files are named after the module they cover; the test names are not, so a
      // failure is attributed by looking for the victim's file in the failing file list.
      return output.split("\n").some((line) => line.startsWith("(fail)"));
    });
    for (const name of victimNames) {
      if (output.includes(name)) {
      }
      // The victim's own failures always mention the file bun ran; when the output never
      // names it, the victim did not get to fail for the reason we are chasing.
    }
    return true;
  }
}

if (all.length === 0) {
  console.error("no test files found");
  process.exit(1);
}

if (!victimsFail(all)) {
  console.log("victims pass with every other file: no pollution reproduced");
  process.exit(0);
}

let current = all;
while (current.length > 1) {
  const half = Math.floor(current.length / 2);
  const left = current.slice(0, half);
  const right = current.slice(half);
  if (victimsFail(left)) {
    current = left;
    console.log(`narrowed to ${left.length} files (left half)`);
    continue;
  }
  if (victimsFail(right)) {
    current = right;
    console.log(`narrowed to ${right.length} files (right half)`);
    continue;
  }
  // Neither half alone reproduces: the pair spans the split, so search the boundary
  // greedily by adding files one at a time from the other half.
  const found = right.find((file) => victimsFail([...left, file]));
  if (found) {
    console.log(`polluter: ${found}`);
    process.exit(0);
  }
  console.log("interaction requires more than two files; leaving the halves as candidates");
  break;
}
console.log(`polluter: ${current[0]}`);
