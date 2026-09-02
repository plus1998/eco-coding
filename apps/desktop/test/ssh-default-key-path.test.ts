import path from "node:path";
import { expect, test } from "bun:test";
import {
  listDefaultSshPrivateKeyPaths,
  resolveDefaultSshPrivateKeyPath,
} from "../src/shared/ssh-bookmarks";

test("listDefaultSshPrivateKeyPaths returns OpenSSH candidate order", () => {
  const homeDir = "/Users/demo";
  expect(listDefaultSshPrivateKeyPaths(homeDir)).toEqual([
    path.join(homeDir, ".ssh", "id_ed25519"),
    path.join(homeDir, ".ssh", "id_rsa"),
    path.join(homeDir, ".ssh", "id_ecdsa"),
  ]);
});

test("listDefaultSshPrivateKeyPaths supports Windows home directories", () => {
  const homeDir = "C:\\Users\\demo";
  expect(listDefaultSshPrivateKeyPaths(homeDir)).toEqual([
    path.join(homeDir, ".ssh", "id_ed25519"),
    path.join(homeDir, ".ssh", "id_rsa"),
    path.join(homeDir, ".ssh", "id_ecdsa"),
  ]);
});

test("resolveDefaultSshPrivateKeyPath returns undefined when no candidates exist", () => {
  const homeDir = "/Users/demo";
  const resolved = resolveDefaultSshPrivateKeyPath(homeDir, () => false);
  expect(resolved).toBeUndefined();
});

test("resolveDefaultSshPrivateKeyPath returns id_rsa when only rsa exists", () => {
  const homeDir = "/Users/demo";
  const rsaPath = path.join(homeDir, ".ssh", "id_rsa");
  const resolved = resolveDefaultSshPrivateKeyPath(homeDir, (candidate) => candidate === rsaPath);
  expect(resolved).toBe(rsaPath);
});

test("resolveDefaultSshPrivateKeyPath prefers id_ed25519 over id_rsa", () => {
  const homeDir = "/Users/demo";
  const ed25519Path = path.join(homeDir, ".ssh", "id_ed25519");
  const rsaPath = path.join(homeDir, ".ssh", "id_rsa");
  const resolved = resolveDefaultSshPrivateKeyPath(
    homeDir,
    (candidate) => candidate === ed25519Path || candidate === rsaPath,
  );
  expect(resolved).toBe(ed25519Path);
});
