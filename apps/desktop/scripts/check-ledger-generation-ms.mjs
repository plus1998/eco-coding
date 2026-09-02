import { Database } from "bun:sqlite";
import path from "node:path";
import os from "node:os";

const db = new Database(
  path.join(os.homedir(), "AppData/Roaming/@eco/desktopDev/eco-coding.sqlite"),
);

const threads = db
  .prepare(
    `SELECT thread_id, COUNT(*) as n, MAX(observed_at) as last_at
     FROM thread_usage_ledger_events
     GROUP BY thread_id
     ORDER BY last_at DESC
     LIMIT 5`,
  )
  .all();

for (const t of threads) {
  const rows = db
    .prepare(
      `SELECT output_tokens, provider_request_id, request_key, source, metadata_json
       FROM thread_usage_ledger_events WHERE thread_id = ? ORDER BY observed_at`,
    )
    .all(t.thread_id);
  let withGen = 0;
  let withLogical = 0;
  let sumGen = 0;
  const samplePids = [];
  for (const row of rows) {
    const m = row.metadata_json ? JSON.parse(row.metadata_json) : {};
    if (m.generationMs > 0) {
      withGen++;
      sumGen += m.generationMs;
    }
    if (m.logicalRequestId) withLogical++;
    if (samplePids.length < 4 && row.provider_request_id) {
      samplePids.push(row.provider_request_id.slice(-24));
    }
  }
  console.log(
    JSON.stringify({
      threadId: t.thread_id,
      rows: rows.length,
      withGen,
      withLogical,
      sumGen,
      samplePids,
      sources: [...new Set(rows.map((r) => r.source))],
      lastAt: t.last_at,
    }),
  );
}
