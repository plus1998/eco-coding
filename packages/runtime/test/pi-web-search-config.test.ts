import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PI_WEB_SEARCH_CONFIG_ENV,
  pinnedPiWebSearchConfigPath,
  pinPiWebSearchToSessionModel,
} from "../src/pi-web-search-config.js";
import { createPiWebSearchExtensionFactory } from "../src/pi-web-search-factory.js";
import piWebSearch, { type PiWebSearchExtensionFactory } from "../src/pi-web-search-loader.js";

type RegisteredTool = {
  name: string;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: Record<string, unknown> }>;
};

const temporaryDirectories: string[] = [];
const previousEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const name of Object.keys(previousEnv)) delete previousEnv[name];
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  globalThis.fetch = originalFetch;
});

function rememberEnv(name: string): void {
  if (!(name in previousEnv)) previousEnv[name] = process.env[name];
}

function setEnv(name: string, value: string | undefined): void {
  rememberEnv(name);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** The PI agent dir upstream falls back to: `PI_CODING_AGENT_DIR || ~/.pi/agent`. */
function writeGlobalWebSearchConfig(config: Record<string, string>): string {
  const agentDir = mkdtempSync(path.join(tmpdir(), "eco-pi-agent-"));
  temporaryDirectories.push(agentDir);
  writeFileSync(path.join(agentDir, "web-search.json"), JSON.stringify(config));
  return agentDir;
}

/** Mount the real upstream extension and hand back the tools it registered. */
async function mountWebSearch(factory: PiWebSearchExtensionFactory): Promise<Map<string, RegisteredTool>> {
  const tools = new Map<string, RegisteredTool>();
  await factory({
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
    getActiveTools: () => [],
    setActiveTools: () => {},
    getThinkingLevel: () => "off",
    on: () => () => {},
  });
  return tools;
}

/**
 * A PI session context whose model is the Eco-registered one (Gateway base URL
 * + attempt credential). `find` never resolves anything: the only model in the
 * registry is the Eco session model, which callers reach through `ctx.model`.
 */
function ecoSessionContext() {
  const keyRequests: string[] = [];
  return {
    keyRequests,
    ctx: {
      model: {
        id: "eco-gateway-model",
        provider: "xai",
        api: "openai-responses",
        baseUrl: "https://eco-gateway.test/v1",
        headers: {},
      },
      modelRegistry: {
        getApiKeyAndHeaders: async (model: { id: string }) => {
          keyRequests.push(model.id);
          return { ok: true, apiKey: "eco-attempt-key", headers: { "x-eco-binding": "b-1" } };
        },
        getAvailable: () => [],
        find: () => undefined,
      },
    },
  };
}

function captureFetch(): Array<{ url: string; headers: Headers }> {
  const calls: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return calls;
}

test("native web search reads the global PI web-search.json until it is pinned", async () => {
  // Reproduce the real leak: Eco never exports PI_CODING_AGENT_DIR, so upstream
  // resolves the user's global web-search.json.
  setEnv(PI_WEB_SEARCH_CONFIG_ENV, undefined);
  setEnv("PI_CODING_AGENT_DIR", writeGlobalWebSearchConfig({ provider: "xai", model: "some-other-model" }));
  const calls = captureFetch();
  const tools = await mountWebSearch(piWebSearch);
  const tool = tools.get("web_search");
  expect(tool).toBeDefined();
  const session = ecoSessionContext();

  const leaked = await tool?.execute(
    "call-1",
    { query: "hello" },
    new AbortController().signal,
    undefined,
    session.ctx,
  );
  expect(leaked?.details?.error).toBe("configured_model_not_found");
  expect(calls).toEqual([]);
  expect(session.keyRequests).toEqual([]);
});

test("creating the native extension factory pins search to the Eco session model", async () => {
  setEnv(PI_WEB_SEARCH_CONFIG_ENV, undefined);
  setEnv(
    "PI_CODING_AGENT_DIR",
    writeGlobalWebSearchConfig({ provider: "google-generative-ai", model: "gemini-2.5-pro" }),
  );
  const calls = captureFetch();
  const tools = await mountWebSearch(piWebSearch);
  const tool = tools.get("web_search");
  const session = ecoSessionContext();

  // Production wiring. This is what `appendPiWebSearchSessionParts` installs for
  // the "native" backend.
  await createPiWebSearchExtensionFactory();

  const result = await tool?.execute(
    "call-2",
    { query: "hello" },
    new AbortController().signal,
    undefined,
    session.ctx,
  );
  expect(result?.details?.error).not.toBe("configured_model_not_found");
  expect(calls).toHaveLength(1);
  // The Eco session model's Gateway, not the global config's provider.
  expect(calls[0]?.url).toBe("https://eco-gateway.test/v1/responses");
  expect(calls[0]?.headers.get("authorization")).toBe("Bearer eco-attempt-key");
  expect(calls[0]?.headers.get("x-eco-binding")).toBe("b-1");
  expect(session.keyRequests).toEqual(["eco-gateway-model"]);
});

test("the pin overrides an inherited PI_WEB_SEARCH_CONFIG", () => {
  const agentDir = writeGlobalWebSearchConfig({ provider: "xai", model: "inherited" });
  const inherited = path.join(agentDir, "web-search.json");
  setEnv(PI_WEB_SEARCH_CONFIG_ENV, inherited);

  const pinned = pinPiWebSearchToSessionModel();
  expect(pinned).toBe(pinnedPiWebSearchConfigPath());
  expect(process.env[PI_WEB_SEARCH_CONFIG_ENV]).toBe(pinned);
  expect(process.env[PI_WEB_SEARCH_CONFIG_ENV]).not.toBe(inherited);
  expect(existsSync(pinned)).toBe(false);
});

test("the pin drops a leftover file at the pinned path", () => {
  const pinned = pinnedPiWebSearchConfigPath();
  writeFileSync(pinned, JSON.stringify({ provider: "xai", model: "leftover" }));
  expect(existsSync(pinned)).toBe(true);

  pinPiWebSearchToSessionModel();
  expect(existsSync(pinned)).toBe(false);
});
