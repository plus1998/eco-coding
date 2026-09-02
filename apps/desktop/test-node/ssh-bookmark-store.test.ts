import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalSecretCodec } from "../src/main/local-secret-codec";
import { createSshBookmarkStore } from "../src/main/ssh-bookmark-store";

async function createTestDirectory(t: test.TestContext, prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") {
        throw error;
      }
    }
  });
  return directory;
}

test("SshBookmarkStore persists bookmarks and encrypted secrets", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-ssh-bookmarks-");
  const store = await createSshBookmarkStore(
    path.join(directory, "eco-coding.sqlite"),
    createLocalSecretCodec(),
  );

  assert.deepEqual(store.list(), []);

  const saved = store.save({
    name: "Prod",
    host: "10.0.0.2",
    port: 2222,
    username: "ubuntu",
    authType: "password",
    password: "secret-pass",
  });
  assert.equal(saved.name, "Prod");
  assert.equal(saved.hasPassword, true);
  assert.equal(saved.hasStoredKey, false);
  assert.equal(store.getPassword(saved.id), "secret-pass");

  const keyBookmark = store.save({
    name: "Key Host",
    host: "example.com",
    username: "root",
    authType: "key",
    keySource: "stored",
    storedKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
  });
  assert.equal(keyBookmark.hasStoredKey, true);
  assert.match(store.getStoredKey(keyBookmark.id) ?? "", /BEGIN PRIVATE KEY/);
  store.close();

  const reopened = await createSshBookmarkStore(
    path.join(directory, "eco-coding.sqlite"),
    createLocalSecretCodec(),
  );
  const list = reopened.list();
  assert.equal(list.length, 2);
  assert.equal(reopened.getPassword(saved.id), "secret-pass");

  const updated = reopened.save({
    id: saved.id,
    name: "Prod Updated",
    host: "10.0.0.2",
    port: 2222,
    username: "ubuntu",
    authType: "password",
  });
  assert.equal(updated.name, "Prod Updated");
  assert.equal(reopened.getPassword(saved.id), "secret-pass");

  const remaining = reopened.delete(saved.id);
  assert.equal(remaining.length, 1);
  assert.equal(reopened.getPassword(saved.id), undefined);
  reopened.close();
});

test("SshBookmarkStore rejects duplicate bookmark names", async (t) => {
  const directory = await createTestDirectory(t, "eco-node-ssh-bookmarks-dup-");
  const store = await createSshBookmarkStore(
    path.join(directory, "eco-coding.sqlite"),
    createLocalSecretCodec(),
  );
  store.save({
    name: "Server A",
    host: "a.example",
    username: "root",
    authType: "password",
    password: "pw",
  });
  assert.throws(
    () =>
      store.save({
        name: "server a",
        host: "b.example",
        username: "root",
        authType: "password",
        password: "pw2",
      }),
    /duplicate_name/,
  );
  store.close();
});
