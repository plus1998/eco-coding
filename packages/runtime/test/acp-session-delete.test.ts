import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ACP_SESSION_DELETE_FAILED_PREFIX,
  ACP_SESSION_DELETE_FALLBACK_LOG,
  ACP_SESSION_DIR_SYMLINK,
  ACP_SESSION_HOME_MISSING,
  ACP_SESSION_ID_INVALID,
  ACP_SESSION_PATH_NOT_DIR,
  acpSessionIdToDelete,
  agentSupportsSessionDelete,
  deleteCursorAcpSession,
  isAcpSessionDeleteMethodNotFound,
  removeCursorAcpSessionDir,
  resolveCursorAcpSessionDir,
  resolveCursorAcpSessionsDir,
} from "../src/acp-session-delete.js";

test("agentSupportsSessionDelete is true only for delete object", () => {
  expect(
    agentSupportsSessionDelete({ agentCapabilities: { sessionCapabilities: { delete: {} } } }),
  ).toBe(true);
  expect(agentSupportsSessionDelete({ agentCapabilities: { sessionCapabilities: { list: {} } } })).toBe(
    false,
  );
  expect(
    agentSupportsSessionDelete({ agentCapabilities: { sessionCapabilities: { delete: null } } }),
  ).toBe(false);
  expect(
    agentSupportsSessionDelete({ agentCapabilities: { sessionCapabilities: { delete: true } } }),
  ).toBe(false);
  expect(agentSupportsSessionDelete({})).toBe(false);
});

test("acpSessionIdToDelete only returns trimmed ids for acp sessions", () => {
  expect(acpSessionIdToDelete({ coreKind: "acp", externalSessionId: " sess-1 " })).toBe("sess-1");
  expect(acpSessionIdToDelete({ coreKind: "claude", externalSessionId: "sess-1" })).toBeUndefined();
  expect(acpSessionIdToDelete({ coreKind: "acp", externalSessionId: "  " })).toBeUndefined();
  expect(acpSessionIdToDelete(undefined)).toBeUndefined();
});

test("resolveCursorAcpSessionsDir uses HOME on POSIX and USERPROFILE on Windows", () => {
  expect(resolveCursorAcpSessionsDir({ HOME: "/tmp/home" })).toBe(
    path.join("/tmp/home", ".cursor", "acp-sessions"),
  );
  expect(resolveCursorAcpSessionsDir({ USERPROFILE: "C:\\Users\\a", HOME: "" })).toBe(
    path.join("C:\\Users\\a", ".cursor", "acp-sessions"),
  );
  expect(() => resolveCursorAcpSessionsDir({})).toThrow(ACP_SESSION_HOME_MISSING);
});

test("resolveCursorAcpSessionDir rejects path traversal and illegal characters", () => {
  const env = { HOME: "/tmp/home" };
  expect(resolveCursorAcpSessionDir("  abc-123  ", env)).toBe(
    path.join("/tmp/home", ".cursor", "acp-sessions", "abc-123"),
  );
  expect(() => resolveCursorAcpSessionDir("../x", env)).toThrow(ACP_SESSION_ID_INVALID);
  expect(() => resolveCursorAcpSessionDir("a/b", env)).toThrow(ACP_SESSION_ID_INVALID);
  expect(() => resolveCursorAcpSessionDir("a\\b", env)).toThrow(ACP_SESSION_ID_INVALID);
  expect(() => resolveCursorAcpSessionDir(".", env)).toThrow(ACP_SESSION_ID_INVALID);
  expect(() => resolveCursorAcpSessionDir("..", env)).toThrow(ACP_SESSION_ID_INVALID);
});

test("removeCursorAcpSessionDir deletes a real directory and treats missing as success", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "eco-acp-sess-"));
  const env = { HOME: root };
  const sessionId = "11111111-1111-1111-1111-111111111111";
  const dir = resolveCursorAcpSessionDir(sessionId, env);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "meta.json"), "{}");
  await removeCursorAcpSessionDir(sessionId, env);
  expect(await Bun.file(path.join(dir, "meta.json")).exists()).toBe(false);
  await removeCursorAcpSessionDir(sessionId, env);
});

test.skipIf(process.platform === "win32")("removeCursorAcpSessionDir refuses symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "eco-acp-sess-"));
  const env = { HOME: root };
  const sessions = resolveCursorAcpSessionsDir(env);
  await mkdir(sessions, { recursive: true });
  const linkId = "link-session-id";
  await symlink(sessions, path.join(sessions, linkId));
  await expect(removeCursorAcpSessionDir(linkId, env)).rejects.toThrow(ACP_SESSION_DIR_SYMLINK);
});

test("removeCursorAcpSessionDir refuses non-directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "eco-acp-sess-"));
  const env = { HOME: root };
  const sessions = resolveCursorAcpSessionsDir(env);
  await mkdir(sessions, { recursive: true });
  const fileId = "file-session-id";
  await writeFile(path.join(sessions, fileId), "nope");
  await expect(removeCursorAcpSessionDir(fileId, env)).rejects.toThrow(ACP_SESSION_PATH_NOT_DIR);
});

test("isAcpSessionDeleteMethodNotFound detects JSON-RPC method missing", () => {
  expect(isAcpSessionDeleteMethodNotFound(new Error('"Method not found": session/delete'))).toBe(
    true,
  );
  expect(isAcpSessionDeleteMethodNotFound(new Error("Method not found"))).toBe(true);
  expect(isAcpSessionDeleteMethodNotFound(new Error("not authenticated"))).toBe(false);
});

test("deleteCursorAcpSession skips disk after protocol success", async () => {
  const removed: string[] = [];
  const logs: string[] = [];
  await deleteCursorAcpSession({
    sessionId: "sess-ok",
    tryProtocolDelete: async () => "deleted",
    removeLocalSessionDir: async (id) => {
      removed.push(id);
    },
    log: (line) => logs.push(line),
  });
  expect(removed).toEqual([]);
  expect(logs).toEqual([]);
});

test("deleteCursorAcpSession falls back to disk when protocol is unsupported", async () => {
  const removed: string[] = [];
  const logs: string[] = [];
  await deleteCursorAcpSession({
    sessionId: "sess-fb",
    tryProtocolDelete: async () => "unsupported",
    removeLocalSessionDir: async (id) => {
      removed.push(id);
    },
    log: (line) => logs.push(line),
  });
  expect(removed).toEqual(["sess-fb"]);
  expect(logs).toEqual([ACP_SESSION_DELETE_FALLBACK_LOG]);
});

test("deleteCursorAcpSession falls back when protocol throws method not found", async () => {
  const removed: string[] = [];
  await deleteCursorAcpSession({
    sessionId: "sess-32601",
    tryProtocolDelete: async () => {
      throw new Error('"Method not found": session/delete');
    },
    removeLocalSessionDir: async (id) => {
      removed.push(id);
    },
    log: () => {},
  });
  expect(removed).toEqual(["sess-32601"]);
});

test("deleteCursorAcpSession does not touch disk on other protocol errors", async () => {
  const removed: string[] = [];
  await expect(
    deleteCursorAcpSession({
      sessionId: "sess-auth",
      tryProtocolDelete: async () => {
        throw new Error("not authenticated");
      },
      removeLocalSessionDir: async (id) => {
        removed.push(id);
      },
    }),
  ).rejects.toThrow(`${ACP_SESSION_DELETE_FAILED_PREFIX}not authenticated`);
  expect(removed).toEqual([]);
});

test("deleteCursorAcpSession rejects illegal ids before protocol", async () => {
  let protocolCalled = false;
  await expect(
    deleteCursorAcpSession({
      sessionId: "../x",
      tryProtocolDelete: async () => {
        protocolCalled = true;
        return "deleted";
      },
      removeLocalSessionDir: async () => {},
    }),
  ).rejects.toThrow(ACP_SESSION_ID_INVALID);
  expect(protocolCalled).toBe(false);
});

test("deleteCursorAcpSession default spawn ENOENT falls back to disk without throw", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "eco-acp-sess-"));
  const sessionId = "22222222-2222-2222-2222-222222222222";
  const env = {
    ...process.env,
    HOME: root,
    USERPROFILE: "",
    CURSOR_AGENT_EXECUTABLE: path.join(root, "no-such-agent"),
  };
  const dir = resolveCursorAcpSessionDir(sessionId, env);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "meta.json"), "{}");
  const logs: string[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await deleteCursorAcpSession({
      sessionId,
      env,
      log: (line) => logs.push(line),
    });
    await Bun.sleep(50);
    expect(existsSync(dir)).toBe(false);
    expect(logs).toEqual([ACP_SESSION_DELETE_FALLBACK_LOG]);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
