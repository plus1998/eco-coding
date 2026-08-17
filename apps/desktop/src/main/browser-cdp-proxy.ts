import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { WebContents } from "electron";
import { browserTrace } from "./browser-trace";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Dev smoke uses 9222; product guest CDP must never bind that port. */
export const FORBIDDEN_CDP_PORT = 9222;

export interface BrowserCdpProxy {
  port: number;
  close: () => Promise<void>;
  /**
   * Broadcast Target.targetDestroyed / detatched to connected CDP clients.
   * Required when Eco UI closes a page outside of Target.closeTarget.
   */
  notifyTargetDestroyed: (targetId: string) => void;
  /** Eco-minted page (window.open / open new origin) outside Target.createTarget. */
  notifyTargetCreated: (targetId: string) => void;
  /** Keep agent-browser tab_list URLs/titles in sync after navigations. */
  notifyTargetInfoChanged: (targetId: string) => void;
}

export interface BrowserCdpTarget {
  /** Stable Eco browser id (used as CDP targetId + sessionId). */
  id: string;
  webContents: WebContents;
}

export interface MultiBrowserCdpProxyOptions {
  getTargets: () => BrowserCdpTarget[];
  onCreateTarget?: (url?: string) => BrowserCdpTarget | Promise<BrowserCdpTarget>;
  onActivateTarget?: (targetId: string) => void;
  onCloseTarget?: (targetId: string) => void | Promise<void>;
  onClientActivity?: (detail: {
    kind: "ws-connect" | "cdp-method";
    method?: string;
    targetId?: string;
  }) => void;
}

/** Per CDP WebSocket client: auto-attach flag + sessions already announced. */
type ClientAutoAttachState = {
  autoAttach: boolean;
  /** targetIds / sessionIds already sent as Target.attachedToTarget to this client. */
  attachedSessionIds: Set<string>;
};

function getOrCreateClientAutoAttachState(
  map: Map<Socket, ClientAutoAttachState>,
  socket: Socket,
): ClientAutoAttachState {
  let state = map.get(socket);
  if (!state) {
    state = { autoAttach: false, attachedSessionIds: new Set() };
    map.set(socket, state);
  }
  return state;
}

/**
 * Only first attach for a (client, target) pair should emit attachedToTarget.
 * Re-emitting on every setAutoAttach makes agent-browser reconnect in a tight loop.
 */
export function selectTargetsNeedingAutoAttach(
  targets: ReadonlyArray<{ id: string }>,
  alreadyAttached: ReadonlySet<string>,
): string[] {
  const needed: string[] = [];
  for (const target of targets) {
    if (!alreadyAttached.has(target.id)) {
      needed.push(target.id);
    }
  }
  return needed;
}

function emitAttachedToTarget(
  socket: Socket,
  target: BrowserCdpTarget,
  state?: ClientAutoAttachState,
): void {
  if (socket.destroyed) {
    return;
  }
  if (state?.attachedSessionIds.has(target.id)) {
    return;
  }
  ensureDebuggerAttached(target.webContents);
  writeJsonFrame(socket, {
    method: "Target.attachedToTarget",
    params: {
      sessionId: target.id,
      targetInfo: pageTargetInfo(target),
      waitingForDebugger: false,
    },
  });
  state?.attachedSessionIds.add(target.id);
}

/**
 * When agent-browser (and Chromium clients) enable auto-attach, they expect
 * attachedToTarget for every existing page — otherwise tab_list stays empty
 * even though Target.getTargets /json/list already list human-opened guests.
 */
export function shouldEmitAutoAttachForExistingTargets(params: {
  autoAttach?: unknown;
}): boolean {
  return params.autoAttach === true;
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

function ensureDebuggerAttached(wc: WebContents): DebuggerLike {
  const dbg = getDebugger(wc);
  if (!dbg.isAttached()) {
    dbg.attach("1.3");
  }
  return dbg;
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

function writeJsonFrame(socket: Socket, body: Record<string, unknown>): void {
  if (socket.destroyed) {
    return;
  }
  socket.write(encodeTextFrame(JSON.stringify(body)));
}

function broadcastJsonFrame(clients: Set<Socket>, body: Record<string, unknown>): void {
  const frame = encodeTextFrame(JSON.stringify(body));
  for (const client of clients) {
    if (!client.destroyed) {
      client.write(frame);
    }
  }
}

function pageTargetInfo(target: BrowserCdpTarget): Record<string, unknown> {
  const wc = target.webContents;
  const alive = wc && !wc.isDestroyed();
  return {
    targetId: target.id,
    type: "page",
    title: alive ? wc.getTitle() || "Eco Browser" : "Eco Browser",
    url: alive ? wc.getURL() || "about:blank" : "about:blank",
    attached: true,
    canAccessOpener: false,
  };
}

function listJsonPages(targets: BrowserCdpTarget[], port: number): unknown[] {
  return targets.map((target) => {
    const info = pageTargetInfo(target);
    const alive = target.webContents && !target.webContents.isDestroyed();
    return {
      description: "",
      devtoolsFrontendUrl: "",
      id: target.id,
      title: info.title,
      type: "page",
      url: info.url,
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${target.id}`,
      ...(alive
        ? {}
        : {
            /* keep keys stable */
          }),
    };
  });
}

/**
 * Session-scoped multi-page CDP proxy over multiple Electron webContents.debugger instances.
 * Binds 127.0.0.1 with an ephemeral port (never 9222). Only exposes targets from `getTargets`.
 */
export async function startMultiBrowserCdpProxy(
  options: MultiBrowserCdpProxyOptions,
): Promise<BrowserCdpProxy> {
  const clients = new Set<Socket>();
  const autoAttachByClient = new Map<Socket, ClientAutoAttachState>();
  const debuggerListeners = new Map<
    string,
    { wc: WebContents; listener: (event: unknown, method: string, params: unknown) => void }
  >();

  const syncDebuggerListeners = () => {
    const targets = options.getTargets().filter((t) => t.webContents && !t.webContents.isDestroyed());
    const liveIds = new Set(targets.map((t) => t.id));
    for (const [id, entry] of debuggerListeners) {
      if (!liveIds.has(id)) {
        try {
          const dbg = getDebugger(entry.wc);
          dbg.off("message", entry.listener);
        } catch {
          // ignore
        }
        debuggerListeners.delete(id);
      }
    }
    for (const target of targets) {
      if (debuggerListeners.has(target.id)) {
        continue;
      }
      try {
        const dbg = ensureDebuggerAttached(target.webContents);
        const listener = (_event: unknown, method: string, params: unknown) => {
          const message = JSON.stringify({
            method,
            params,
            sessionId: target.id,
          });
          const frame = encodeTextFrame(message);
          for (const client of clients) {
            if (!client.destroyed) {
              client.write(frame);
            }
          }
        };
        dbg.on("message", listener);
        debuggerListeners.set(target.id, { wc: target.webContents, listener });
      } catch (error) {
        process.stderr.write(
          `[eco-browser-cdp] attach debugger failed for ${target.id}: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
    }
  };

  // Initial attach for existing targets.
  syncDebuggerListeners();

  const notifyTargetDestroyed = (targetId: string) => {
    const id = targetId.trim();
    if (!id) {
      return;
    }
    for (const state of autoAttachByClient.values()) {
      state.attachedSessionIds.delete(id);
    }
    broadcastJsonFrame(clients, {
      method: "Target.targetDestroyed",
      params: { targetId: id },
    });
    // Drop session-scoped attaches keyed by our target id.
    broadcastJsonFrame(clients, {
      method: "Target.detachedFromTarget",
      params: { sessionId: id, targetId: id },
    });
    syncDebuggerListeners();
  };

  const notifyTargetCreated = (targetId: string) => {
    const id = targetId.trim();
    if (!id) {
      return;
    }
    const target = options
      .getTargets()
      .find((t) => t.id === id && t.webContents && !t.webContents.isDestroyed());
    if (!target) {
      return;
    }
    syncDebuggerListeners();
    broadcastJsonFrame(clients, {
      method: "Target.targetCreated",
      params: { targetInfo: pageTargetInfo(target) },
    });
    for (const client of clients) {
      const state = autoAttachByClient.get(client);
      if (state?.autoAttach) {
        emitAttachedToTarget(client, target, state);
      }
    }
  };

  const notifyTargetInfoChanged = (targetId: string) => {
    const id = targetId.trim();
    if (!id) {
      return;
    }
    const target = options
      .getTargets()
      .find((t) => t.id === id && t.webContents && !t.webContents.isDestroyed());
    if (!target) {
      return;
    }
    const info = pageTargetInfo(target);
    broadcastJsonFrame(clients, {
      method: "Target.targetInfoChanged",
      params: { targetInfo: info },
    });
  };

  const server = http.createServer((req, res) => {
    void handleHttp(req, res, options);
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      syncDebuggerListeners();
      handleUpgrade(
        req,
        socket as Socket,
        head,
        clients,
        autoAttachByClient,
        options,
        syncDebuggerListeners,
        notifyTargetDestroyed,
        notifyTargetCreated,
      );
    } catch {
      socket.destroy();
    }
  });

  const port = await listenEphemeral(server);
  if (port === FORBIDDEN_CDP_PORT) {
    await closeServer(server);
    throw new Error("CDP proxy refused to bind forbidden port 9222");
  }

  return {
    port,
    notifyTargetDestroyed,
    notifyTargetCreated,
    notifyTargetInfoChanged,
    close: async () => {
      for (const client of clients) {
        client.destroy();
      }
      clients.clear();
      autoAttachByClient.clear();
      for (const [id, entry] of debuggerListeners) {
        try {
          const dbg = getDebugger(entry.wc);
          dbg.off("message", entry.listener);
          if (dbg.isAttached()) {
            dbg.detach();
          }
        } catch {
          // ignore
        }
        debuggerListeners.delete(id);
      }
      await closeServer(server);
    },
  };
}

/** @deprecated Use startMultiBrowserCdpProxy — kept for smoke tests that pass a single WebContents. */
export async function startBrowserCdpProxy(
  webContents: WebContents,
  options: {
    onClientActivity?: MultiBrowserCdpProxyOptions["onClientActivity"];
  } = {},
): Promise<BrowserCdpProxy> {
  const id = "eco-guest";
  return startMultiBrowserCdpProxy({
    getTargets: () =>
      webContents && !webContents.isDestroyed() ? [{ id, webContents }] : [],
    ...(options.onClientActivity ? { onClientActivity: options.onClientActivity } : {}),
  });
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  options: MultiBrowserCdpProxyOptions,
): Promise<void> {
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const port = Number((req.socket.address() as AddressInfo | null)?.port ?? 0);
  const targets = options.getTargets().filter((t) => t.webContents && !t.webContents.isDestroyed());
  const first = targets[0];
  const wsUrl = first
    ? `ws://127.0.0.1:${port}/devtools/page/${first.id}`
    : `ws://127.0.0.1:${port}/devtools/browser`;

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
    writeJson(res, 200, listJsonPages(targets, port));
    return;
  }

  writeJson(res, 404, { error: "not found" });
}

function resolveTarget(
  options: MultiBrowserCdpProxyOptions,
  targetId?: string,
  sessionId?: string,
): BrowserCdpTarget | undefined {
  const targets = options.getTargets().filter((t) => t.webContents && !t.webContents.isDestroyed());
  if (targetId) {
    return targets.find((t) => t.id === targetId);
  }
  if (sessionId) {
    return targets.find((t) => t.id === sessionId);
  }
  return targets[0];
}

async function tryHandleTargetDomain(
  method: string,
  params: Record<string, unknown> | undefined,
  socket: Socket,
  options: MultiBrowserCdpProxyOptions,
  syncDebuggerListeners: () => void,
  notifyTargetDestroyed: (targetId: string) => void,
  _notifyTargetCreated: (targetId: string) => void,
  autoAttachByClient: Map<Socket, ClientAutoAttachState>,
): Promise<
  | { handled: true; result: unknown; afterResponse?: () => void }
  | { handled: false }
> {
  if (method === "Target.getTargets") {
    const targets = options.getTargets().filter((t) => t.webContents && !t.webContents.isDestroyed());
    return {
      handled: true,
      result: { targetInfos: targets.map((t) => pageTargetInfo(t)) },
    };
  }
  if (method === "Target.getTargetInfo") {
    const targetId = typeof params?.targetId === "string" ? params.targetId : undefined;
    const target = resolveTarget(options, targetId);
    if (!target) {
      throw new Error("Target not found");
    }
    return { handled: true, result: { targetInfo: pageTargetInfo(target) } };
  }
  if (method === "Target.setDiscoverTargets") {
    if (params?.discover !== false) {
      for (const target of options.getTargets()) {
        if (target.webContents && !target.webContents.isDestroyed()) {
          writeJsonFrame(socket, {
            method: "Target.targetCreated",
            params: { targetInfo: pageTargetInfo(target) },
          });
        }
      }
    }
    return { handled: true, result: {} };
  }
  if (method === "Target.setAutoAttach") {
    const enabled = shouldEmitAutoAttachForExistingTargets(params ?? {});
    const state = getOrCreateClientAutoAttachState(autoAttachByClient, socket);
    state.autoAttach = enabled;
    if (!enabled) {
      browserTrace("cdp", "Target.setAutoAttach", { enabled: false, attachCount: 0 });
      return { handled: true, result: {} };
    }
    const liveTargets = options
      .getTargets()
      .filter((t) => t.webContents && !t.webContents.isDestroyed());
    const neededIds = new Set(
      selectTargetsNeedingAutoAttach(liveTargets, state.attachedSessionIds),
    );
    const targetsToAttach = liveTargets.filter((t) => neededIds.has(t.id));
    if (targetsToAttach.length === 0) {
      // Idempotent: agent-browser often re-calls setAutoAttach; do not re-emit or spam logs.
      return { handled: true, result: {} };
    }
    browserTrace("cdp", "Target.setAutoAttach", {
      enabled: true,
      attachCount: targetsToAttach.length,
      alreadyAttached: state.attachedSessionIds.size,
      targetIds: targetsToAttach.map((t) => t.id),
    });
    // Defer attachedToTarget until after the setAutoAttach response is written.
    return {
      handled: true,
      result: {},
      afterResponse: () => {
        const started = Date.now();
        syncDebuggerListeners();
        for (const target of targetsToAttach) {
          if (!target.webContents.isDestroyed()) {
            try {
              emitAttachedToTarget(socket, target, state);
            } catch (error) {
              browserTrace("cdp", "autoAttach emit failed", {
                targetId: target.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
        browserTrace("cdp", "autoAttach afterResponse done", {
          attachCount: targetsToAttach.length,
          elapsedMs: Date.now() - started,
        });
      },
    };
  }
  if (method === "Target.setRemoteLocations") {
    return { handled: true, result: {} };
  }
  if (method === "Target.detachFromTarget") {
    const state = autoAttachByClient.get(socket);
    const sessionId =
      typeof params?.sessionId === "string"
        ? params.sessionId
        : typeof params?.targetId === "string"
          ? params.targetId
          : undefined;
    if (state && sessionId) {
      state.attachedSessionIds.delete(sessionId);
    }
    return { handled: true, result: {} };
  }
  if (method === "Target.activateTarget") {
    const targetId = typeof params?.targetId === "string" ? params.targetId : undefined;
    if (targetId) {
      options.onActivateTarget?.(targetId);
      options.onClientActivity?.({
        kind: "cdp-method",
        method,
        targetId,
      });
    }
    return { handled: true, result: {} };
  }
  if (method === "Target.closeTarget") {
    const targetId = typeof params?.targetId === "string" ? params.targetId : undefined;
    if (targetId && options.onCloseTarget) {
      await options.onCloseTarget(targetId);
      // Only notify clients if Eco actually removed the target (UI × / dispose).
      const stillThere = options
        .getTargets()
        .some((t) => t.id === targetId && t.webContents && !t.webContents.isDestroyed());
      if (!stillThere) {
        notifyTargetDestroyed(targetId);
      }
    }
    return { handled: true, result: { success: true } };
  }
  if (method === "Target.createTarget") {
    if (!options.onCreateTarget) {
      throw new Error("Target.createTarget is not supported");
    }
    const url = typeof params?.url === "string" ? params.url : undefined;
    const created = await options.onCreateTarget(url);
    syncDebuggerListeners();
    options.onClientActivity?.({
      kind: "cdp-method",
      method,
      targetId: created.id,
    });
    // New pages already broadcast Target.targetCreated from BrowserHost.createBrowserInScope.
    // Blank reuse keeps the same targetId — clients get fresh URL via targetInfoChanged on navigate.
    return { handled: true, result: { targetId: created.id } };
  }
  if (method === "Target.attachToTarget") {
    const targetId = typeof params?.targetId === "string" ? params.targetId : undefined;
    const target = resolveTarget(options, targetId);
    if (!target) {
      throw new Error("Target not found");
    }
    const state = getOrCreateClientAutoAttachState(autoAttachByClient, socket);
    ensureDebuggerAttached(target.webContents);
    syncDebuggerListeners();
    const targetInfo = pageTargetInfo(target);
    if (!state.attachedSessionIds.has(target.id)) {
      writeJsonFrame(socket, {
        method: "Target.attachedToTarget",
        params: {
          sessionId: target.id,
          targetInfo,
          waitingForDebugger: false,
        },
      });
      state.attachedSessionIds.add(target.id);
    }
    return { handled: true, result: { sessionId: target.id } };
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
  clients: Set<Socket>,
  autoAttachByClient: Map<Socket, ClientAutoAttachState>,
  options: MultiBrowserCdpProxyOptions,
  syncDebuggerListeners: () => void,
  notifyTargetDestroyed: (targetId: string) => void,
  notifyTargetCreated: (targetId: string) => void,
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
  let buffer: Buffer = Buffer.alloc(0);
  let closed = false;
  let messageChain: Promise<void> = Promise.resolve();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clients.delete(socket);
    autoAttachByClient.delete(socket);
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
        const text = payload.toString("utf8");
        // Serialize CDP requests per socket — auto-attach floods must not interleave.
        messageChain = messageChain
          .then(() =>
            handleClientMessage(
              text,
              socket,
              options,
              syncDebuggerListeners,
              notifyTargetDestroyed,
              notifyTargetCreated,
              autoAttachByClient,
            ),
          )
          .catch(() => {
            // errors already framed to client inside handleClientMessage
          });
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
  options: MultiBrowserCdpProxyOptions,
  syncDebuggerListeners: () => void,
  notifyTargetDestroyed: (targetId: string) => void,
  notifyTargetCreated: (targetId: string) => void,
  autoAttachByClient: Map<Socket, ClientAutoAttachState>,
): Promise<void> {
  let message: {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    sessionId?: string;
  };
  try {
    message = JSON.parse(text) as typeof message;
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
    const shim = await tryHandleTargetDomain(
      method,
      params,
      socket,
      options,
      syncDebuggerListeners,
      notifyTargetDestroyed,
      notifyTargetCreated,
      autoAttachByClient,
    );
    let result: unknown;
    let afterResponse: (() => void) | undefined;
    if (shim.handled) {
      result = shim.result;
      afterResponse = shim.afterResponse;
    } else {
      const target = resolveTarget(options, undefined, clientSessionId);
      if (!target) {
        throw new Error("No browser target available in this session CDP");
      }
      const dbg = ensureDebuggerAttached(target.webContents);
      const started = Date.now();
      result = await dbg.sendCommand(method, params);
      const elapsedMs = Date.now() - started;
      if (elapsedMs >= 1000) {
        browserTrace("cdp", "slow sendCommand", {
          method,
          targetId: target.id,
          elapsedMs,
        });
      }

      if (
        method === "Page.navigate" ||
        method === "Page.navigateToHistoryEntry" ||
        method === "Page.reload"
      ) {
        options.onClientActivity?.({
          kind: "cdp-method",
          method,
          targetId: target.id,
        });
      }
    }

    if (id === undefined) {
      afterResponse?.();
      return;
    }
    writeJsonFrame(socket, {
      id,
      ...(clientSessionId ? { sessionId: clientSessionId } : {}),
      result: result ?? {},
    });
    afterResponse?.();
  } catch (error) {
    browserTrace("cdp", "client message error", {
      method,
      error: error instanceof Error ? error.message : String(error),
    });
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
