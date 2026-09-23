import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCodexAppServerEnv,
  CodexRuntimeLifecycle,
  setCodexAccountProxyUrlGetter,
} from "../src/main/codex-runtime-lifecycle";

describe("Codex app-server environment", () => {
  test("bypasses proxies for the local Eco gateway", () => {
    const env = buildCodexAppServerEnv(
      {
        HTTP_PROXY: "http://proxy.example.test:8080",
        HTTPS_PROXY: "http://proxy.example.test:8080",
      },
      "C:\\eco\\codex",
    );

    expect(env.CODEX_HOME).toBe("C:\\eco\\codex");
    expect(env.NO_PROXY).toBe("127.0.0.1,localhost,::1");
    expect(env.no_proxy).toBe(env.NO_PROXY);
    expect(env.HTTP_PROXY).toBe("http://proxy.example.test:8080");
  });

  test("preserves and deduplicates existing proxy bypass entries", () => {
    const env = buildCodexAppServerEnv(
      {
        NO_PROXY: "internal.example.test,LOCALHOST",
        no_proxy: "metadata.google.internal,127.0.0.1",
      },
      "/tmp/eco/codex",
    );

    expect(env.NO_PROXY).toBe("internal.example.test,LOCALHOST,metadata.google.internal,127.0.0.1,::1");
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });

  test("fails closed when the configured account proxy is invalid", async () => {
    const ecoDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-codex-proxy-"));
    setCodexAccountProxyUrlGetter(() => "ftp://user:secret@proxy.example.test:21");
    try {
      const lifecycle = new CodexRuntimeLifecycle({ ecoDataDir, codexExecutable: "unused" });
      await expect(lifecycle.start()).rejects.toThrow(
        "Configured OpenAI account proxy could not be initialized",
      );
    } finally {
      setCodexAccountProxyUrlGetter(undefined);
      await fs.rm(ecoDataDir, { recursive: true, force: true });
    }
  });
});
