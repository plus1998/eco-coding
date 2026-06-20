import { MongoStore } from "../src/db/mongo-store";

const DEFAULT_TEST_MONGODB_URI = "mongodb://127.0.0.1:27017";

export async function createTestMongoStore(testName: string): Promise<MongoStore> {
  const databaseName = `eco_test_${sanitizeTestName(testName).slice(0, 16)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const store = await MongoStore.connect({
    uri: Bun.env.ECO_TEST_MONGODB_URI ?? DEFAULT_TEST_MONGODB_URI,
    databaseName,
  });
  await store.dropDatabase();
  await store.ensureIndexes();
  return store;
}

export async function closeTestMongoStore(store: MongoStore): Promise<void> {
  await store.dropDatabase();
  await store.close();
}

function sanitizeTestName(testName: string): string {
  return testName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
}
