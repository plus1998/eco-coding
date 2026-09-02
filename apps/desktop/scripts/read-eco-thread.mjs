import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const tid = process.argv[2] ?? "thr_1788251572291";
const dbs = [
  `${process.env.APPDATA}/@eco/desktopDev/eco-coding.sqlite`,
  `${process.env.APPDATA}/@eco/desktop/eco-coding.sqlite`,
  `${process.env.APPDATA}/@eco/desktopE2E/eco-coding.sqlite`,
];

for (const p of dbs) {
  if (!fs.existsSync(p)) {
    console.log(`[skip] missing ${p}`);
    continue;
  }
  const db = new DatabaseSync(p, { readOnly: true });
  console.log(`\n=== ${p} ===`);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log("tables:", tables.map((t) => t.name).join(", "));

  for (const table of tables.map((t) => t.name)) {
    if (!/thread/i.test(table)) continue;
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      const idCol = cols.some((c) => c.name === "id")
        ? "id"
        : cols.some((c) => c.name === "thread_id")
          ? "thread_id"
          : null;
      if (!idCol) continue;
      const row = db.prepare(`SELECT * FROM ${table} WHERE ${idCol} = ? LIMIT 1`).get(tid);
      if (row) console.log(`FOUND ${table}:`, JSON.stringify(row, null, 2).slice(0, 3000));
    } catch (e) {
      console.log(`err ${table}:`, e instanceof Error ? e.message : e);
    }
  }

  for (const table of ["thread_run_events", "thread_events"]) {
    if (!tables.some((t) => t.name === table)) continue;
    try {
      const rows = db
        .prepare(`SELECT * FROM ${table} WHERE thread_id = ? ORDER BY rowid DESC LIMIT 8`)
        .all(tid);
      if (rows.length) {
        console.log(`\n--- recent ${table} (${rows.length}) ---`);
        for (const row of rows.reverse()) {
          console.log(JSON.stringify(row).slice(0, 500));
        }
      }
      const toolRows = db
        .prepare(
          `SELECT sequence, event_type, message FROM ${table} WHERE thread_id = ? AND message LIKE '%Tool:%' ORDER BY sequence DESC LIMIT 40`,
        )
        .all(tid);
      if (toolRows.length) {
        console.log(`\n--- tool calls in ${table} ---`);
        for (const row of toolRows.reverse()) {
          console.log(`${row.sequence} ${row.event_type}: ${row.message}`);
        }
      }
    } catch {}
  }
}
