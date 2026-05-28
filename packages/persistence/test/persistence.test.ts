import { expect, test } from "bun:test";
import { createAgentEvent } from "../../shared/src";
import { DATABASE_SCHEMA_SQL, InMemoryEventStore, InMemorySecretStore, redactSecrets } from "../src";

test("defines durable tables for thread event state", () => {
  expect(DATABASE_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS agent_events");
  expect(DATABASE_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS approvals");
  expect(DATABASE_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS changesets");
});

test("stores thread events in timestamp order", async () => {
  const store = new InMemoryEventStore();
  await store.appendEvent(
    createAgentEvent({
      id: "evt_2",
      threadId: "thr_1",
      agentId: "agt_1",
      role: "coder",
      type: "tool.completed",
      timestamp: "2026-01-01T00:00:02.000Z",
      payload: {},
    }),
  );
  await store.appendEvent(
    createAgentEvent({
      id: "evt_1",
      threadId: "thr_1",
      agentId: "agt_1",
      role: "coder",
      type: "tool.started",
      timestamp: "2026-01-01T00:00:01.000Z",
      payload: {},
    }),
  );

  const events = await store.listEvents("thr_1");
  expect(events.map((event) => event.id)).toEqual(["evt_1", "evt_2"]);
});

test("keeps secrets behind a secret store boundary", async () => {
  const store = new InMemorySecretStore();
  await store.setSecret("eco", "anthropic", "sk-ant-test");

  expect(await store.getSecret("eco", "anthropic")).toBe("sk-ant-test");
  expect(redactSecrets("token=sk-ant-test", ["sk-ant-test"])).toBe("token=[REDACTED]");
});
