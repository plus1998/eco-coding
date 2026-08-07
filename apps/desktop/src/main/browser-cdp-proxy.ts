import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { WebContents } from "electron";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Dev smoke uses 9222; product guest CDP must never bind that port. */
export const FORBIDDEN_CDP_PORT = 9222;
/** Flat page-target session id for agent-browser Target.attachToTarget flow. */
const ECO_GUEST_SESSION_ID = "eco-guest";

export interface BrowserCdpProxy {
  port: number;
  close: () => Promise<void>;
}

export interface BrowserCdpProxyOptions {
  /** Fired when agent-browser connects or issues CDP commands (e.g. navigate). */
  onClientActivity?: (detail: { kind: "ws-connect" | "cdp-method"; method?: string }) => void;
}

interface DebuggerLike {
  isAttached: () => boolean;
  attach: (protocolVersion?: string) => void;
  detach: () => void;
  sendCommand: (method: string, commandParams?: Record<string, unknown>) => Promise<unknown>;
  on: (event: "message", listener: (event: unknown, method: string, params: unknown) => void) => void;
  off: (event: "message", listener: (event: unknown, method: string, params: unknown) => void) => void;
}

function getDebugger(webContents: WebContents): DebuggerLike {
  return webContents.debugger as unknown as DebuggerLike;
}

function readFrames(
  buffer: Buffer,
  onFrame: (payload: Buffer, opcode: number) => void,
): Buffer {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const b0 = buffer[offset]!;
    const b1 = buffer[offset + 1]!;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let headerLen = 2;
    if (payloadLen === 126) {
      if (buffer.length - offset < 4) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (buffer.length - offset < 10) break;
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      if (high !== 0) {
        throw new Error("CDP WebSocket frame too large");
      }
      payloadLen = low;
      headerLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    const total = headerLen + maskLen + payloadLen;
    if (buffer.length - offset < total) break;
    let payload = buffer.subarray(offset + headerLen + maskLen, offset + total);
    if (masked) {
      const mask = buffer.subarray(offset + headerLen, offset + headerLen + 4);
      const decoded = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i += 1) {
        decoded[i] = payload[i]! ^ mask[i % 4]!;
      }
      payload = decoded;
    }
    onFrame(payload, opcode);
    offset += total;
  }
  return buffer.subarray(offset);
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  if (len < 126) {
    const frame = Buffer.alloc(2 + len);
    frame[0] = 0x81;
    frame[1] = len;
    payload.copy(frame, 2);
    return frame;
  }
  if (len < 65536) {
    const frame = Buffer.alloc(4 + len);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    payload.copy(frame, 4);
    return frame;
  }
  const frame = Buffer.alloc(10 + len);
  frame[0] = 0x81;
  frame[1] = 127;
  frame.writeUInt32BE(0, 2);
  frame.writeUInt32BE(len, 6);
  payload.copy(frame, 10);
  return frame;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Minimal localhost CDP HTTP+WS proxy over Electron webContents.debugger.
 * Binds 127.0.0.1 with an ephemeral port (never 9222).
 */
export async function startBrowserCdpProxy(
  webContents: WebContents,
  options: BrowserCdpProxyOptions = {},
): Promise<BrowserCdpProxy> {
  const dbg = getDebugger(webContents);
  if (!dbg.isAttached()) {
    dbg.attach("1.3");
  }

  const clients = new Set<Socket>();
  const onDebuggerMessage = (_event: unknown, method: string, params: unknown) => {
    // Session-scoped clients (post Target.attachToTarget) expect sessionId on events.
    const message = JSON.stringify({
      method,
      params,
      sessionId: ECO_GUEST_SESSION_ID,
    });
    const frame = encodeTextFrame(message);
    for (const client of clients) {
      if (!client.destroyed) {
        client.write(frame);
      }
    }
  };
  dbg.on("message", onDebuggerMessage);

  const server = http.createServer((req, res) => {
    void handleHttp(req, res, webContents);
  });

  // Only notify real agent attach/commands that should surface the panel.
  // ws-connect alone must NOT reveal (agent-browser connects when MCP tool session starts).
  server.on("upgrade", (req, socket, head) => {
    try {
      handleUpgrade(req, socket as Socket, head, webContents, clients, dbg, options);
    } catch {
      socket.destroy();
    }
  });

  const port = await listenEphemeral(server);
  if (port === FORBIDDEN_CDP_PORT) {
    await closeServer(server);
    // Extremely unlikely with port 0; rebind once more.
    const retryServer = http.createServer((req, res) => {
      void handleHttp(req, res, webContents);
    });
    retryServer.on("upgrade", (req, socket, head) => {
      try {
        handleUpgrade(req, socket as Socket, head, webContents, clients, dbg, options);
      } catch {
        socket.destroy();
      }
    });
    const retryPort = await listenEphemeral(retryServer);
    if (retryPort === FORBIDDEN_CDP_PORT) {
      await closeServer(retryServer);
      dbg.off("message", onDebuggerMessage);
      try {
        if (dbg.isAttached()) dbg.detach();
      } catch {
        // ignore
      }
      throw new Error("CDP proxy refused to bind forbidden port 9222");
    }
    return {
      port: retryPort,
      close: async () => {
        for (const client of clients) {
          client.destroy();
        }
        clients.clear();
        dbg.off("message", onDebuggerMessage);
        await closeServer(retryServer);
        try {
          if (dbg.isAttached()) dbg.detach();
        } catch {
          // ignore
        }
      },
    };
  }

  return {
    port,
    close: async () => {
      for (const client of clients) {
        client.destroy();
      }
      clients.clear();
      dbg.off("message", onDebuggerMessage);
      await closeServer(server);
      try {
        if (dbg.isAttached()) dbg.detach();
      } catch {
        // ignore
      }
    },
  };
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  webContents: WebContents,
): Promise<void> {
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const port = Number((req.socket.address() as AddressInfo | null)?.port ?? 0);
  const targetId = String(webContents.id);
  const wsUrl = `ws://127.0.0.1:${port}/devtools/page/${targetId}`;
  const title = webContents.getTitle() || "Eco Browser";
  const pageUrl = webContents.getURL() || "about:blank";

  if (url.pathname === "/json/version" || url.pathname === "/json/version/") {
    writeJson(res, 200, {
      Browser: "Eco-Browser/1.0",
      "Protocol-Version": "1.3",
      "User-Agent": "Eco Coding Built-in Browser",
      "V8-Version": process.versions.v8,
      "WebKit-Version": process.versions.chrome,
      webSocketDebuggerUrl: wsUrl,
    });
    return;
  }

  if (
    url.pathname === "/json" ||
    url.pathname === "/json/" ||
    url.pathname === "/json/list" ||
    url.pathname === "/json/list/"
  ) {
    writeJson(res, 200, [
      {
        description: "",
        devtoolsFrontendUrl: "",
        id: targetId,
        title,
        type: "page",
        url: pageUrl,
        webSocketDebuggerUrl: wsUrl,
      },
    ]);
    return;
  }

  writeJson(res, 404, { error: "not found" });
}

/** Flat page-target session id — same value as ECO_GUEST_SESSION_ID at module top. */
function pageTargetInfo(webContents: WebContents): Record<string, unknown> {
  return {
    targetId: String(webContents.id),
    type: "page",
    title: webContents.getTitle() || "Eco Browser",
    url: webContents.getURL() || "about:blank",
    attached: true,
    canAccessOpener: false,
  };
}

function writeJsonFrame(
  socket: Socket,
  body: Record<string, unknown>,
): void {
  if (socket.destroyed) {
    return;
  }
  socket.write(encodeTextFrame(JSON.stringify(body)));
}

/**
 * agent-browser with `--cdp` often:
 * 1) Target.attachToTarget → expects { sessionId }
 * 2) { sessionId, method: "Page.navigate", ... } against that session
 * Electron webContents.debugger is already the page target; we shim Target.* and strip sessionId.
 */
function tryHandleTargetDomain(
  method: string,
  params: Record<string, unknown> | undefined,
  webContents: WebContents,
  socket: Socket,
): { handled: true; result: unknown } | { handled: false } {
  if (method === "Target.getTargets") {
    return { handled: true, result: { targetInfos: [pageTargetInfo(webContents)] } };
  }
  if (method === "Target.getTargetInfo") {
    return { handled: true, result: { targetInfo: pageTargetInfo(webContents) } };
  }
  if (method === "Target.setDiscoverTargets") {
    // Discover-mode clients wait for targetCreated after enable; reply alone is not enough.
    if (params?.discover !== false) {
      writeJsonFrame(socket, {
        method: "Target.targetCreated",
        params: { targetInfo: pageTargetInfo(webContents) },
      });
    }
    return { handled: true, result: {} };
  }
  if (
    method === "Target.setAutoAttach" ||
    method === "Target.setRemoteLocations" ||
    method === "Target.detachFromTarget" ||
    method === "Target.activateTarget"
  ) {
    return { handled: true, result: {} };
  }
  if (method === "Target.attachToTarget") {
    const targetInfo = pageTargetInfo(webContents);
    // Some clients also listen for the attached event before sending Page.* commands.
    writeJsonFrame(socket, {
      method: "Target.attachedToTarget",
      params: {
        sessionId: ECO_GUEST_SESSION_ID,
        targetInfo,
        waitingForDebugger: false,
      },
    });
    return { handled: true, result: { sessionId: ECO_GUEST_SESSION_ID } };
  }
  if (method === "Browser.getVersion") {
    return {
      handled: true,
      result: {
        protocolVersion: "1.3",
        product: "Eco-Browser/1.0",
        revision: process.versions.electron ?? "",
        userAgent: "Eco Coding Built-in Browser",
        jsVersion: process.versions.v8 ?? "",
      },
    };
  }
  return { handled: false };
}

function handleUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  webContents: WebContents,
  clients: Set<Socket>,
  dbg: DebuggerLike,
  options: BrowserCdpProxyOptions = {},
): void {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || !key) {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n",
  );
  if (head.length > 0) {
    socket.unshift(head);
  }

  clients.add(socket);
  let buffer = Buffer.alloc(0);
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clients.delete(socket);
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    try {
      buffer = readFrames(buffer, (payload, opcode) => {
        if (opcode === 0x8) {
          socket.end();
          cleanup();
          return;
        }
        if (opcode === 0x9) {
          // ping -> pong
          const pong = Buffer.alloc(2 + payload.length);
          pong[0] = 0x8a;
          pong[1] = payload.length;
          payload.copy(pong, 2);
          socket.write(pong);
          return;
        }
        if (opcode !== 0x1 && opcode !== 0x2) {
          return;
        }
        void handleClientMessage(payload.toString("utf8"), socket, webContents, dbg, options);
      });
    } catch {
      socket.destroy();
      cleanup();
    }
  });
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

async function handleClientMessage(
  text: string,
  socket: Socket,
  webContents: WebContents,
  dbg: DebuggerLike,
  options: BrowserCdpProxyOptions = {},
): Promise<void> {
  let message: {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    sessionId?: string;
  };
  try {
    message = JSON.parse(text) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      sessionId?: string;
    };
  } catch {
    return;
  }
  if (typeof message.method !== "string") {
    return;
  }
  const id = message.id;
  const method = message.method;
  const params = message.params ?? {};
  const clientSessionId =
    typeof message.sessionId === "string" && message.sessionId.trim()
      ? message.sessionId
      : undefined;

  try {
    if (!dbg.isAttached()) {
      dbg.attach("1.3");
    }

    const shim = tryHandleTargetDomain(method, params, webContents, socket);
    const result = shim.handled
      ? shim.result
      : await dbg.sendCommand(method, params);

    // agent_browser_open → Page.navigate (flat or session-scoped)
    if (
      method === "Page.navigate" ||
      method === "Page.navigateToHistoryEntry" ||
      method === "Page.reload"
    ) {
      options.onClientActivity?.({ kind: "cdp-method", method });
    }

    if (id === undefined) {
      return;
    }
    writeJsonFrame(socket, {
      id,
      ...(clientSessionId ? { sessionId: clientSessionId } : {}),
      result: result ?? {},
    });
  } catch (error) {
    if (id === undefined) {
      return;
    }
    writeJsonFrame(socket, {
      id,
      ...(clientSessionId ? { sessionId: clientSessionId } : {}),
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function listenEphemeral(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("CDP proxy failed to bind"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
