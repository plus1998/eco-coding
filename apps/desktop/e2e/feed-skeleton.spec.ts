import { expect, test } from "./fixtures/electron-app";
import {
  readFeedSkeletonRow,
  readMaxRunEventSequence,
  resolveE2eDatabasePath,
} from "./helpers/feed-skeleton";
import { E2E_FEED_SKELETON_THREAD_ID, seedFeedSkeletonE2eData } from "./helpers/seed-feed-skeleton";

test.beforeAll(async () => {
  await seedFeedSkeletonE2eData(resolveE2eDatabasePath());
});

test("materialized feed skeleton serves getThreadRunProjection(feed) from SQLite", async ({
  ecoPage: page,
}) => {
  const databasePath = resolveE2eDatabasePath();
  const threadId = E2E_FEED_SKELETON_THREAD_ID;

  const first = await page.evaluate(async (id) => {
    return window.eco.getThreadRunProjection({ threadId: id, mode: "feed" });
  }, threadId);
  expect(first).toBeTruthy();
  const firstIds = (first?.timeline ?? []).map((item) => item.id);
  expect(firstIds.length).toBeGreaterThan(0);

  const materialized = readFeedSkeletonRow(databasePath, threadId);
  expect(materialized, `missing thread_feed_skeleton row for ${threadId} at ${databasePath}`).toBeTruthy();
  expect(materialized?.timelineIds).toEqual(firstIds);
  expect(materialized?.hasAuxiliary).toBe(true);

  const maxSequence = readMaxRunEventSequence(databasePath, threadId);
  expect(materialized?.maxEventSequence).toBe(maxSequence);

  const second = await page.evaluate(async (id) => {
    return window.eco.getThreadRunProjection({ threadId: id, mode: "feed" });
  }, threadId);
  const secondIds = (second?.timeline ?? []).map((item) => item.id);
  expect(secondIds).toEqual(firstIds);

  console.log(
    JSON.stringify(
      {
        ok: true,
        threadId,
        databasePath,
        timelineIds: firstIds,
        maxEventSequence: materialized?.maxEventSequence,
        historyRevision: materialized?.historyRevision,
      },
      null,
      2,
    ),
  );
});
