#!/usr/bin/env node
/**
 * Deploy Eco Supabase Center (migrations + Edge Functions) to a linked project.
 *
 * Usage:
 *   bun run supabase:deploy
 *   bun run supabase:deploy -- --functions-only
 *   bun run supabase:deploy -- --db-only
 *   bun run supabase:deploy -- --project-ref <ref>
 *
 * Prerequisites: `npx supabase login`, then link once (or pass --project-ref).
 * Full guide: docs/supabase-deploy.md
 * Agent skill: .cursor/skills/eco-supabase/SKILL.md
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supabaseDir = path.join(root, "supabase");
const functionsDir = path.join(supabaseDir, "functions");

const args = process.argv.slice(2);
const functionsOnly = args.includes("--functions-only");
const dbOnly = args.includes("--db-only");
const projectRefIdx = args.indexOf("--project-ref");
const projectRef = projectRefIdx >= 0 ? args[projectRefIdx + 1] : undefined;

function run(command, commandArgs, label) {
  console.log(`\n==> ${label}`);
  console.log(`$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label} (exit ${result.status ?? "unknown"})`);
    process.exit(result.status ?? 1);
  }
}

function resolveSupabaseCli() {
  if (process.env.SUPABASE_CLI?.trim()) {
    return { command: process.env.SUPABASE_CLI.trim(), prefixArgs: [] };
  }
  // Prefer a real binary on PATH (Scoop / GitHub release). Avoid bare `npx supabase`
  // on Windows: npm optional deps for win32-x64 are often missing →
  // "No matching Supabase CLI binary package found for win32-x64".
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["supabase"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (which.status === 0 && String(which.stdout || "").trim()) {
    return { command: "supabase", prefixArgs: [] };
  }
  return { command: "npx", prefixArgs: ["supabase"] };
}

function npxSupabase(supabaseArgs, label) {
  const cli = resolveSupabaseCli();
  run(cli.command, [...cli.prefixArgs, ...supabaseArgs], label);
}

if (!existsSync(supabaseDir)) {
  console.error("Missing supabase/ directory. Run from repo root.");
  process.exit(1);
}

if (projectRef) {
  if (!projectRef.trim()) {
    console.error("--project-ref requires a value (Dashboard → Settings → General).");
    process.exit(1);
  }
  npxSupabase(["link", "--project-ref", projectRef.trim()], `Link project ${projectRef.trim()}`);
}

if (!functionsOnly) {
  npxSupabase(["db", "push"], "Push database migrations (incremental)");
}

if (!dbOnly) {
  const entries = existsSync(functionsDir)
    ? readdirSync(functionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
        .map((d) => d.name)
        .sort()
    : [];
  if (entries.length === 0) {
    console.warn("No Edge Functions found under supabase/functions/ (skipped).");
  } else {
    for (const name of entries) {
      npxSupabase(["functions", "deploy", name], `Deploy function: ${name}`);
    }
  }
}

console.log("\nDone. Give Eco clients Project URL + anon key only (never service_role).");
console.log("See docs/supabase-deploy.md");
