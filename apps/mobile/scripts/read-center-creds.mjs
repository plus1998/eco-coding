import { DatabaseSync } from "node:sqlite";

const dbPath =
  process.env.ECO_DB || "C:\\Users\\admin\\AppData\\Roaming\\@eco\\desktopDev\\eco-coding.sqlite";
const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
  .all()
  .map((r) => r.name);
console.log("tables:", tables.filter((n) => /center|device|auth|supa|config/i.test(n)).join(", "));

for (const table of tables) {
  if (!/center/i.test(table)) continue;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  console.log("\n==", table, "==");
  console.log(cols.map((c) => c.name).join(", "));
  try {
    const rows = db.prepare(`SELECT * FROM ${table} LIMIT 3`).all();
    for (const row of rows) {
      const out = { ...row };
      for (const key of Object.keys(out)) {
        const v = out[key];
        if (typeof v === "string" && v.length > 40) {
          out[key] = `${v.slice(0, 24)}…(len=${v.length}) safe=${v.startsWith("safe:v1:")}`;
        }
      }
      console.log(JSON.stringify(out, null, 2));
    }
  } catch (e) {
    console.log("read failed", e.message);
  }
}
