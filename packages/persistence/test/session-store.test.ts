import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InMemorySessionStore, runSessionStoreConformance } from "../src/session-store";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test("InMemorySessionStore passes conformance", async () => {
  await runSessionStoreConformance(() => new InMemorySessionStore());
});

test.skipIf(!sqliteAvailable)("SqliteSessionStore passes conformance", async () => {
  const { createSqliteSessionStore } = await import("../src/session-store");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-session-store-"));
  const dbPath = path.join(dir, "sessions.sqlite");
  await runSessionStoreConformance(async () => createSqliteSessionStore(dbPath));
});

test.skipIf(!sqliteAvailable)("SqliteSessionStore persists entries across instances", async () => {
  const { createSqliteSessionStore } = await import("../src/session-store");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-session-store-"));
  const dbPath = path.join(dir, "sessions.sqlite");
  const key = { projectKey: "-tmp-proj", sessionId: "sess-persist" };
  const entries = [{ type: "user", message: "persist me" }];

  const writer = await createSqliteSessionStore(dbPath);
  await writer.append(key, entries);

  const reader = await createSqliteSessionStore(dbPath);
  const loaded = await reader.load(key);
  expect(loaded).toEqual(entries);
});
