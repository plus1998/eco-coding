import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFixturePointerDir } from "../../../scripts/conversation-round/lib/fixture-pointer.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function relocatedCheckout() {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "eco-round-cli-test-"));
  temporaryRoots.push(temporaryRoot);
  // Use the CLI's Node filesystem semantics: Bun preserves Windows 8.3 names
  // such as RUNNER~1 while Node's module loader expands them to runneradmin.
  const canonical = spawnSync("node", [
    "--input-type=module", "-e",
    'import { realpathSync } from "node:fs"; process.stdout.write(realpathSync(process.argv[1]));',
    temporaryRoot,
  ], { encoding: "utf8" });
  if (canonical.error) throw canonical.error;
  if (canonical.status !== 0) throw new Error(canonical.stderr);
  const root = canonical.stdout;
  for (const relative of [
    "scripts/conversation-round/replay.mjs",
    "scripts/conversation-round/lib",
    "scripts/codex-scenario-smoke/assert.mjs",
    "scripts/pi-regression.mjs",
    "scripts/gateway-http-round/replay.mjs",
    "apps/desktop/test/sdk-round-replay.test.ts",
    "apps/desktop/test/helpers/sdk-round-replay.ts",
  ]) {
    const destination = path.join(root, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(repoRoot, relative), destination, { recursive: true });
  }
  symlinkSync(path.join(repoRoot, "packages"), path.join(root, "packages"), "junction");
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"), "junction");
  for (const core of ["pi", "claude"]) {
    const relative = `scripts/conversation-round/fixtures/latest-${core}.json`;
    const pointer = JSON.parse(readFileSync(path.join(repoRoot, relative), "utf8"));
    const pointerPath = path.join(root, relative);
    mkdirSync(path.dirname(pointerPath), { recursive: true });
    cpSync(path.join(repoRoot, "scripts/conversation-round/fixtures", pointer.runId), path.join(path.dirname(pointerPath), pointer.runId), { recursive: true });
    pointer.path = path.join(root, "missing-original-checkout", pointer.runId);
    writeFileSync(pointerPath, JSON.stringify(pointer));
  }
  return root;
}

test("CLI replays the checked-in PI recording after checkout relocation", () => {
  const root = relocatedCheckout();
  const result = spawnSync("bun", ["scripts/conversation-round/replay.mjs", "--core=pi", "--strict"], { cwd: root, encoding: "utf8" });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  expect(payload.ok).toBe(true);
  expect(payload.fixtureDir.startsWith(path.join(root, "scripts/conversation-round/fixtures"))).toBe(true);
  expect(`${result.stdout}\n${result.stderr}`).toMatch(/4 pass/);
}, 15_000);

test("missing recordings fail the replay and retain the actual error in PI regression output", () => {
  const root = relocatedCheckout();
  const pointerPath = path.join(root, "scripts/conversation-round/fixtures/latest-pi.json");
  rmSync(resolveFixturePointerDir(pointerPath), { recursive: true });
  const result = spawnSync("node", ["scripts/pi-regression.mjs", "--only=replay", "--json"], { cwd: root, encoding: "utf8" });
  expect(result.status).toBe(1);
  const payload = JSON.parse(result.stdout);
  expect(payload.failed).toBe(1);
  expect(payload.steps[0].detail).toContain("Fixture directory missing");
  expect(payload.steps[0].detail).toContain(pointerPath);
}, 15_000);

test("prefers the current checkout even if the recorder's old absolute directory exists", () => {
  const root = relocatedCheckout();
  const pointerPath = path.join(root, "scripts/conversation-round/fixtures/latest-pi.json");
  const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
  mkdirSync(pointer.path, { recursive: true });
  const expected = path.join(path.dirname(pointerPath), pointer.runId);
  expect(resolveFixturePointerDir(pointerPath)).toBe(expected);
});
