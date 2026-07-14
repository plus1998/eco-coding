import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeProvider } from "./provider-config.js";
import type { GatewayConfig, GatewayProvider, GatewayUsageObserver } from "./types.js";
import {
  handleHealth,
  handlePostResponses,
  handlePostResponsesCompact,
} from "./routes/responses.js";

export type GatewayLogFn = (message: string) => void;

export interface EcoGatewayServer {
  port: number;
  stop: () => void;
  getProviders: () => GatewayProvider[];
  setProviders: (providers: GatewayProvider[]) => void;
}

export interface StartEcoGatewayOptions {
  fetchImpl?: typeof fetch;
  onLog?: GatewayLogFn;
  onUsage?: GatewayUsageObserver;
}

export function createGatewayFetchHandler(
  config: GatewayConfig,
  fetchImpl: typeof fetch = fetch,
  onLog: GatewayLogFn = defaultGatewayLog,
  onUsage?: GatewayUsageObserver,
): (request: Request) => Response | Promise<Response> {
  return async (request: Request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const startedAt = Date.now();

    if (request.method === "GET" && (path === "/health" || path === "/v1/health")) {
      return handleHealth(config);
    }

    if (request.method === "PUT" && path === "/v1/providers") {
      const response = await handlePutProviders(request, config);
      onLog(
        `PUT /v1/providers → ${response.status} providers=${config.providers.length} models=${config.providers.flatMap((p) => p.models).join(",")}`,
      );
      return response;
    }

    if (request.method === "POST" && path === "/v1/responses") {
      const response = await handlePostResponses(request, config, fetchImpl, onLog, onUsage);
      onLog(`POST /v1/responses → ${response.status} (${Date.now() - startedAt}ms)`);
      return response;
    }

    if (
      request.method === "POST" &&
      (path === "/v1/responses/compact" || path === "/responses/compact")
    ) {
      const response = await handlePostResponsesCompact(
        request,
        config,
        fetchImpl,
        onLog,
        onUsage,
      );
      onLog(`POST ${path} → ${response.status} (${Date.now() - startedAt}ms)`);
      return response;
    }

    onLog(`${request.method} ${path} → 404`);
    return Response.json({ error: { message: "Not found" } }, { status: 404 });
  };
}

function defaultGatewayLog(message: string): void {
  process.stderr.write(`[eco-gateway] ${message}\n`);
}

async function handlePutProviders(request: Request, config: GatewayConfig): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }
  if (!Array.isArray(body) || body.length === 0) {
    return Response.json(
      { error: { message: "Body must be a non-empty provider array" } },
      { status: 400 },
    );
  }
  try {
    config.providers = body.map((entry) => normalizeProvider(entry as GatewayProvider));
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : String(error) } },
      { status: 400 },
    );
  }
  return Response.json({
    ok: true,
    providers: config.providers.map((provider) => ({
      id: provider.id,
      upstreamKind: provider.upstreamKind,
      models: provider.models,
    })),
  });
}

/** Node http server — runs in Electron main / Node without Bun. */
export async function startEcoGateway(
  config: GatewayConfig,
  options?: StartEcoGatewayOptions,
): Promise<EcoGatewayServer> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const onLog = options?.onLog ?? defaultGatewayLog;
  const handler = createGatewayFetchHandler(config, fetchImpl, onLog, options?.onUsage);

  const server = http.createServer((req, res) => {
    void dispatchNodeRequest(req, res, handler).catch((error) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: { message: error instanceof Error ? error.message : String(error) },
          }),
        );
      } else {
        res.destroy(error instanceof Error ? error : undefined);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });

  const address = server.address();
  const port =
    address && typeof address === "object" && typeof address.port === "number"
      ? address.port
      : config.port;

  return {
    port,
    stop: () => {
      server.close();
    },
    getProviders: () => config.providers,
    setProviders: (providers) => {
      config.providers = providers.map(normalizeProvider);
    },
  };
}

async function dispatchNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (request: Request) => Response | Promise<Response>,
): Promise<void> {
  const webRequest = await nodeRequestToWebRequest(req);
  const webResponse = await handler(webRequest);
  await writeWebResponseToNode(webResponse, res);
}

async function nodeRequestToWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "127.0.0.1";
  const url = `http://${host}${req.url ?? "/"}`;
  const method = (req.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, value);
    }
  }

  const hasBody = method !== "GET" && method !== "HEAD";
  if (!hasBody) {
    return new Request(url, { method, headers });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  if (body.length === 0) {
    return new Request(url, { method, headers });
  }
  return new Request(url, {
    method,
    headers,
    body: new Uint8Array(body),
    // Node fetch requires duplex when a body is present on Request init.
    duplex: "half",
  } as RequestInit);
}

async function writeWebResponseToNode(webResponse: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") {
      return;
    }
    res.setHeader(key, value);
  });

  if (!webResponse.body) {
    res.end();
    return;
  }

  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        const canContinue = res.write(Buffer.from(value));
        if (!canContinue) {
          await onceDrain(res);
        }
      }
    }
    res.end();
  } catch (error) {
    res.destroy(error instanceof Error ? error : undefined);
  } finally {
    reader.releaseLock();
  }
}

function onceDrain(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    res.once("drain", () => resolve());
  });
}
