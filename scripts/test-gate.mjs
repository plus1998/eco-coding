import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * The desktop suite as a gate, with every known failure named out loud.
 *
 * The suite has failures that predate this script (order-dependent global state, mostly).
 * Ignoring them wholesale is how the Feed shipped broken while the suite looked usable;
 * failing on all of them makes the gate red and therefore dead. So the run is compared
 * against an explicit list: a **new** failure fails the gate, a listed one is printed on
 * every run, and a listed failure that starts passing is reported as a stale entry.
 *
 * Usage:
 *   node scripts/test-gate.mjs            # gate the suite
 *   node scripts/test-gate.mjs --list     # print the known-failure list and exit
 *   node scripts/test-gate.mjs --strict   # also fail when a listed entry now passes
 *
 * The Flutter suite is not run here: it has its own workflow
 * (.github/workflows/mobile-tests.yml).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const baselinePath = join(root, "test-baseline.json");
const junitPath = join(tmpdir(), `eco-test-gate-${process.pid}.xml`);
const args = new Set(process.argv.slice(2));

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const known = baseline.knownFailures ?? {};

if (args.has("--list")) {
  for (const [key, reason] of Object.entries(known)) {
    console.log(`${key}\n    ${reason}`);
  }
  console.log(`\n${Object.keys(known).length} 条已知失败（${baseline.updatedAt}）。`);
  process.exit(0);
}

const exitCode = await runSuite();
const failures = readFailures();
const knownKeys = new Set(Object.keys(known));
const unexpected = [...failures].filter((key) => !knownKeys.has(key)).sort();
const stale = [...knownKeys].filter((key) => !failures.has(key)).sort();

if (failures.size > 0) {
  console.log(
    `\n本次失败 ${failures.size} 条（已知 ${failures.size - unexpected.length}，新增 ${unexpected.length}）。`,
  );
}
if (knownKeys.size > 0) {
  console.log(`\n已知失败清单（${knownKeys.size} 条，全部打印出来可见，不静默）：`);
  for (const key of [...knownKeys].sort()) {
    console.log(`  ${failures.has(key) ? "红" : "绿(已成历史)"} ${key}`);
  }
}
if (stale.length > 0) {
  console.log(`\n有 ${stale.length} 条已知失败这次通过了 —— 请把它们从 test-baseline.json 删掉：`);
  for (const key of stale) console.log(`  ${key}`);
}
if (unexpected.length > 0) {
  console.error(`\n新增失败 ${unexpected.length} 条（本次改动引入，必须先修或显式加入清单并写清原因）：`);
  for (const key of unexpected) console.error(`  ${key}`);
}

const strictStale = args.has("--strict") && stale.length > 0;
rmSync(junitPath, { force: true });
process.exit(unexpected.length > 0 || strictStale ? 1 : exitCode);

function runSuite() {
  const passthrough = process.argv.slice(2).filter((arg) => arg !== "--strict" && arg !== "--list");
  const hasOption = (name) => passthrough.some((arg) => arg === name || arg.startsWith(`${name}=`));
  const argv = [
    "bun",
    "test",
    ...(hasOption("--parallel") ? [] : ["--parallel=2"]),
    ...(hasOption("--max-concurrency") ? [] : ["--max-concurrency=1"]),
    "--path-ignore-patterns=apps/desktop/e2e/**",
    `--reporter=junit`,
    `--reporter-outfile=${junitPath}`,
    ...passthrough,
  ];
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", (error) => {
      console.error(`无法执行 ${argv.join(" ")}：${error.message}`);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

/** `<file>::<test name>` for every failed test case, from the JUnit report. */
function readFailures() {
  const failures = new Set();
  let xml;
  try {
    xml = readFileSync(junitPath, "utf8");
  } catch (error) {
    console.error(`读不到测试报告（${junitPath}）：${error.message}`);
    return failures;
  }
  const suites = xml.split("<testsuite ").slice(1);
  for (const suite of suites) {
    const file = suite.match(/file="([^"]+)"/)?.[1] ?? "";
    for (const testcase of suite.split("<testcase ").slice(1)) {
      const name = testcase.match(/name="([^"]*)"/)?.[1] ?? "";
      const body = testcase.slice(0, testcase.indexOf("</testcase>") + 11);
      if (body.includes("<failure") || body.includes("<error")) {
        failures.add(`${file}::${decodeXml(name)}`);
      }
    }
  }
  return failures;
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
