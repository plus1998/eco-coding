import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestGatewayFetchHandler } from "../test-bridge-rewrite.js";
import type { GatewayProvider } from "../src/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export interface GatewayHttpExchange {
  seq?: number;
  layer: string;
  profileId: string;
  scenarioId: string;
  ok?: boolean;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    bodyArtifact?: { file: string; kind: string; bytes: number };
  };
}

export interface GatewayHttpRoundFixture {
  dir: string;
  runId: string;
  layer: "gateway" | "upstream";
  summary: Record<string, unknown>;
  exchanges: GatewayHttpExchange[];
  artifactDir: string;
}

function readJsonl(filePath: string): GatewayHttpExchange[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GatewayHttpExchange);
}

export function resolveGatewayHttpRoundFixtureDir(layer: "gateway" | "upstream", configured?: string): string {
  const explicit = configured?.trim() || process.env[`ECO_GATEWAY_HTTP_ROUND_FIXTURE_${layer.toUpperCase()}`]?.trim();
  if (explicit) {
    if (path.isAbsolute(explicit) && fs.existsSync(explicit)) return explicit;
    const resolved = path.resolve(repoRoot, explicit);
    if (fs.existsSync(resolved)) return resolved;
    const under = path.join(repoRoot, "scripts/gateway-http-round/fixtures", explicit);
    if (fs.existsSync(under)) return under;
    throw new Error(`Gateway HTTP fixture not found: ${explicit}`);
  }
  const pointerPath = path.join(
    repoRoot,
    "scripts/gateway-http-round/fixtures",
    layer === "gateway" ? "latest-gateway.json" : "latest-upstream.json",
  );
  if (!fs.existsSync(pointerPath)) {
    throw new Error(`No ${layer} fixture pointer. Run record-${layer}.mts first.`);
  }
  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as { path?: string; runId?: string };
  const dir = pointer.path && fs.existsSync(pointer.path) ? pointer.path : path.join(path.dirname(pointerPath), pointer.runId ?? "");
  if (!fs.existsSync(dir)) {
    throw new Error(`${layer} fixture dir missing: ${dir}`);
  }
  return dir;
}

export function loadGatewayHttpRoundFixture(
  layer: "gateway" | "upstream",
  fixtureDir = resolveGatewayHttpRoundFixtureDir(layer),
): GatewayHttpRoundFixture {
  const logName = layer === "gateway" ? "gateway-http.jsonl" : "upstream-http.jsonl";
  const summary = fs.existsSync(path.join(fixtureDir, "summary.json"))
    ? (JSON.parse(fs.readFileSync(path.join(fixtureDir, "summary.json"), "utf8")) as Record<string, unknown>)
    : {};
  return {
    dir: fixtureDir,
    runId: String(summary.runId ?? path.basename(fixtureDir)),
    layer,
    summary,
    exchanges: readJsonl(path.join(fixtureDir, logName)),
    artifactDir: path.join(fixtureDir, "artifacts"),
  };
}

export function readExchangeBody(fixture: GatewayHttpRoundFixture, exchange: GatewayHttpExchange): string {
  const artifact = exchange.response.bodyArtifact?.file;
  if (!artifact) return "";
  return fs.readFileSync(path.join(fixture.artifactDir, artifact), "utf8");
}

export function buildProviderFromProfileId(profileId: string, apiKey = "fixture-key"): GatewayProvider {
  const models: Record<string, GatewayProvider> = {
    packy_responses: {
      id: "packy_responses",
      name: "Luna Responses (Pomener)",
      upstreamKind: "responses",
      baseUrl: "https://gpt.pomener.ru",
      apiKey,
      upstreamModelId: "gpt-5.6-luna",
      models: ["gpt-5.6-luna"],
    },
    packy_anthropic: {
      id: "packy_anthropic",
      name: "Packy Anthropic",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://www.packyapi.ai",
      apiKey,
      upstreamModelId: "claude-sonnet-5",
      models: ["claude-sonnet-5"],
    },
    longcat_chat: {
      id: "longcat_chat",
      name: "LongCat Chat",
      upstreamKind: "openai-chat",
      baseUrl: "https://api.longcat.chat/openai",
      apiKey,
      upstreamModelId: "LongCat-2.0",
      models: ["LongCat-2.0"],
    },
    longcat_responses: {
      id: "longcat_responses",
      name: "LongCat Responses",
      upstreamKind: "responses",
      baseUrl: "https://api.longcat.chat/openai",
      apiKey,
      upstreamModelId: "LongCat-2.0",
      models: ["LongCat-2.0"],
    },
  };
  const provider = models[profileId];
  if (!provider) {
    throw new Error(`Unknown profile id: ${profileId}`);
  }
  return provider;
}

export function replayGatewayClientExchange(input: {
  provider: GatewayProvider;
  clientExchange: GatewayHttpExchange;
  upstreamExchange: GatewayHttpExchange;
  fixture: GatewayHttpRoundFixture;
}) {
  const upstreamBody = readExchangeBody(input.fixture, input.upstreamExchange);
  const upstreamContentType = input.upstreamExchange.response.headers["content-type"] ?? "application/json";
  const handler = createTestGatewayFetchHandler({ host: "127.0.0.1", port: 0, providers: [input.provider] }, async () => {
    return new Response(upstreamBody, {
      status: input.upstreamExchange.response.status,
      headers: { "content-type": upstreamContentType },
    });
  });
  return handler(
    new Request(input.clientExchange.request.url, {
      method: input.clientExchange.request.method,
      headers: input.clientExchange.request.headers,
      body: input.clientExchange.request.body ?? undefined,
    }),
  );
}
