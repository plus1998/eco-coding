import { expect, test } from "bun:test";
import { ThreadFollowUpDrainScheduler } from "../src/main/thread-follow-up-drain-scheduler";

test("edit release/Resume retries a drain that was already waiting on a queue claim", async () => {
  const scheduler = new ThreadFollowUpDrainScheduler();
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  let editing = true;
  let delivered = false;
  const drain = async () => {
    calls += 1;
    const blocked = editing;
    if (calls === 1) {
      started();
      await waiting;
    }
    if (!blocked) delivered = true;
  };
  const first = scheduler.drain("thread", drain);
  await entered;
  editing = false;
  const resumed = scheduler.drain("thread", drain);
  release();
  await Promise.all([first, resumed]);
  expect(calls).toBe(2);
  expect(delivered).toBe(true);
});

test("drains for independent threads progress independently, and errors release the scheduler", async () => {
  const scheduler = new ThreadFollowUpDrainScheduler();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = scheduler.drain("first", () => waiting);
  let second = false;
  await scheduler.drain("second", async () => {
    second = true;
  });
  expect(second).toBe(true);
  release();
  await first;
  await expect(
    scheduler.drain("first", async () => {
      throw new Error("claim failed");
    }),
  ).rejects.toThrow("claim failed");
  await scheduler.drain("first", async () => {});
});
