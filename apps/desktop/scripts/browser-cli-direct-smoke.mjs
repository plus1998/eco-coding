/**
 * Direct agent-browser CLI smoke against Eco thread CDP — bypasses MCP (Windows hang).
 *
 * Prerequisites:
 *   1. Eco running with an active conversation thread
 *   2. At least one built-in browser tab open (task panel → browser)
 *   3. Thread CDP port from DevTools console:
 *        await eco.getBrowserState()  →  state.cdpPort
 *
 * Usage (PowerShell):
 *   cd apps/desktop
 *   $env:AGENT_BROWSER_CDP="54321"
 *   node scripts/browser-cli-direct-smoke.mjs
 *
 * Optional:
 *   ECO_SMOKE_MARKER=custom   — localStorage key suffix
 *   ECO_SMOKE_TIMEOUT_MS=90000
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentBrowser } from "./agent-browser-cli.mjs";

const cdpPort = Number.parseInt(process.env.AGENT_BROWSER_CDP ?? "", 10);
const marker = process.env.ECO_SMOKE_MARKER ?? `CLI_SMOKE_${Date.now()}`;
const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".smoke-artifacts",
  marker,
);
const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`[PASS] ${name}${detail ? `: ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ""}`);
}

function ab(args) {
  return runAgentBrowser(args, { AGENT_BROWSER_CDP: String(cdpPort) });
}

function main() {
  if (!Number.isFinite(cdpPort) || cdpPort <= 0) {
    console.error(
      "[cli-smoke] Set AGENT_BROWSER_CDP to the thread cdpPort from `await eco.getBrowserState()`.",
    );
    process.exit(2);
  }

  mkdirSync(outDir, { recursive: true });
  console.log(`[cli-smoke] AGENT_BROWSER_CDP=${cdpPort} marker=${marker} out=${outDir}`);
  console.log("[cli-smoke] Tip: MCP tools/call can hang on Windows; this script uses CLI only.\n");

  // tab list (multi-page)
  {
    const r = ab(["tab", "list"]);
    if (r.ok && r.stdout.trim().length > 0) {
      pass("tab list", r.stdout.trim().split("\n")[0] ?? "");
    } else {
      fail("tab list", r.stderr || r.stdout || `exit=${r.status}`);
    }
  }

  // open second page if needed
  {
    const r = ab(["open", `https://example.com/?cli=${marker}`]);
    if (r.ok) pass("open / navigate");
    else fail("open / navigate", r.stderr || r.stdout);
  }

  // session marker
  const sessionKey = `eco_cli_smoke_${marker}`;
  {
    const r = ab([
      "open",
      `data:text/html,<script>localStorage.setItem('${sessionKey}','${marker}')</script><h1>${marker}</h1>`,
    ]);
    if (r.ok) pass("session write (localStorage via data: URL)");
    else fail("session write", r.stderr || r.stdout);
  }

  // snapshot + click
  {
    const snap = ab(["snapshot", "--interactive"]);
    if (!snap.ok) {
      fail("snapshot", snap.stderr || snap.stdout);
    } else {
      pass("snapshot");
      const refMatch = snap.stdout.match(/@e\d+/);
      if (refMatch) {
        const click = ab(["click", refMatch[0]]);
        if (click.ok) pass("click", refMatch[0]);
        else fail("click", click.stderr || click.stdout);
      } else {
        fail("click", "no @e ref in snapshot");
      }
    }
  }

  // scroll
  {
    const r = ab(["scroll", "down", "300"]);
    if (r.ok) pass("scroll");
    else fail("scroll", r.stderr || r.stdout);
  }

  // js eval
  {
    const r = ab(["eval", `document.title='CLI_${marker}'; 'ok-${marker}'`]);
    if (r.ok && (r.stdout.includes(marker) || r.stdout.includes("ok-"))) {
      pass("eval", r.stdout.trim());
    } else {
      fail("eval", r.stderr || r.stdout);
    }
  }

  // screenshot
  {
    const shotPath = path.join(outDir, "screenshot.png");
    const r = ab(["screenshot", shotPath]);
    if (r.ok) pass("screenshot", shotPath);
    else fail("screenshot", r.stderr || r.stdout);
  }

  // page source (html + read)
  {
    const html = ab(["html"]);
    if (html.ok && html.stdout.length > 20) {
      pass("html (page source)", `${html.stdout.length} chars`);
      writeFileSync(path.join(outDir, "page.html"), html.stdout);
    } else {
      fail("html (page source)", html.stderr || html.stdout);
    }
    const read = ab(["read"]);
    if (read.ok && read.stdout.length > 10) {
      pass("read (agent text)", `${read.stdout.length} chars`);
      writeFileSync(path.join(outDir, "page-read.txt"), read.stdout);
    } else {
      fail("read (agent text)", read.stderr || read.stdout);
    }
  }

  // network capture
  {
    ab(["network", "requests", "--clear"]);
    ab(["open", `https://example.com/?net=${marker}`]);
    const reqs = ab(["network", "requests", "--filter", "example.com"]);
    if (reqs.ok && reqs.stdout.includes("example.com")) {
      pass("network requests", reqs.stdout.trim().split("\n")[0] ?? "");
      writeFileSync(path.join(outDir, "network-requests.txt"), reqs.stdout);
    } else {
      fail("network requests", reqs.stderr || reqs.stdout);
    }
  }

  // session persistence read-back
  {
    const r = ab(["eval", `localStorage.getItem('${sessionKey}')`]);
    if (r.ok && r.stdout.includes(marker)) {
      pass("session persistence (localStorage read-back)", r.stdout.trim());
    } else {
      fail("session persistence", r.stderr || r.stdout);
    }
  }

  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((item) => !item.ok).length;
  const passed = results.filter((item) => item.ok).length;
  console.log(`\n[cli-smoke] done: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
