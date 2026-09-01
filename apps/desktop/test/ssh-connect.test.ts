import { expect, test } from "bun:test";
import { buildSshArgv } from "../src/main/ssh-connect";
import type { SshBookmarkPublic } from "../src/shared/ssh-bookmarks";

test("buildSshArgv includes identity file, port, and target", () => {
  const bookmark: SshBookmarkPublic = {
    id: "b1",
    name: "Prod",
    host: "example.com",
    port: 2222,
    username: "ubuntu",
    authType: "key",
    keySource: "path",
    keyPath: "/home/user/.ssh/id_rsa",
    order: 0,
  };
  const argv = buildSshArgv(bookmark, "/home/user/.ssh/id_rsa");
  expect(argv.some((part) => part.includes("ssh"))).toBe(true);
  expect(argv).toContain("-p");
  expect(argv).toContain("2222");
  expect(argv).toContain("-i");
  expect(argv).toContain("/home/user/.ssh/id_rsa");
  expect(argv.at(-1)).toBe("ubuntu@example.com");
});

test("buildSshArgv appends extra args before target", () => {
  const bookmark: SshBookmarkPublic = {
    id: "b2",
    name: "Extra",
    host: "host.local",
    port: 22,
    username: "root",
    authType: "password",
    extraArgs: "-o ServerAliveInterval=30",
    order: 0,
  };
  const argv = buildSshArgv(bookmark);
  expect(argv).toContain("-o");
  expect(argv).toContain("ServerAliveInterval=30");
  expect(argv.at(-1)).toBe("root@host.local");
});
