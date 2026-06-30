import { isRemoteCommandChannel, validateRemoteCommandArgs } from "@eco/shared";
import {
  buildEventCenterJsonRpcFailure,
  buildEventCenterJsonRpcNotification,
  buildEventCenterJsonRpcSuccess,
  classifyThreadLiveEventForCenter,
  EVENT_CENTER_JSON_RPC_ERROR,
  EVENT_CENTER_JSON_RPC_METHODS,
  EVENT_CENTER_PROTOCOL_VERSION,
  type EventCenterEnvelope,
  type EventCenterEventKind,
  type EventCenterInvokeResult,
  type EventCenterJsonRpcNotification,
  type EventCenterJsonRpcRequest,
  type EventCenterJsonRpcResponse,
  type EventCenterPackageJsonChangedPayload,
  type EventCenterGitRemoteFetchedPayload,
  type EventCenterGitStatusChangedPayload,
  type EventCenterPayloadMap,
  isEventCenterInvokeParams,
  isEventCenterJsonRpcRequest,
  type ThreadEventCenterEventKind,
} from "../shared/event-center";
import { IPC_CHANNELS, type IpcChannel, isKnownIpcChannel, type ThreadLiveEvent } from "../shared/ipc";

export type EventCenterCommandHandler = (args: readonly unknown[]) => unknown | Promise<unknown>;

export interface DesktopEventCenterSink {
  publish(envelope: EventCenterEnvelope, notification: EventCenterJsonRpcNotification): void;
}

export interface DesktopEventCenterOptions {
  now?: () => Date;
  idPrefix?: string;
  source?: EventCenterEnvelope["source"];
}

export type ThreadLiveEventCenterEnvelope = EventCenterEnvelope<ThreadLiveEvent> & {
  kind: ThreadEventCenterEventKind;
};

export interface EventCenterPublishInput<K extends EventCenterEventKind> {
  kind: K;
  payload: EventCenterPayloadMap[K];
  threadId?: string;
  workspacePath?: string;
  aggregateKey?: string;
  metadata?: Record<string, unknown>;
}

export class DesktopEventCenter {
  private readonly sinks = new Set<DesktopEventCenterSink>();
  private readonly commandHandlers = new Map<IpcChannel, EventCenterCommandHandler>();
  private readonly now: () => Date;
  private readonly idPrefix: string;
  private readonly source: EventCenterEnvelope["source"];
  private sequence = 0;

  constructor(options: DesktopEventCenterOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idPrefix = options.idPrefix ?? "evt";
    this.source = options.source ?? "desktop";
  }

  subscribe(sink: DesktopEventCenterSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  registerCommand(channel: IpcChannel, handler: EventCenterCommandHandler): void {
    if (!isRemoteCommandChannel(channel)) {
      throw new Error(`Event center command is not remote-enabled: ${channel}`);
    }
    if (this.commandHandlers.has(channel)) {
      throw new Error(`Event center command already registered: ${channel}`);
    }
    this.commandHandlers.set(channel, handler);
  }

  listCommandChannels(): IpcChannel[] {
    return [...this.commandHandlers.keys()].sort();
  }

  publish<K extends EventCenterEventKind>(
    input: EventCenterPublishInput<K>,
  ): EventCenterEnvelope<EventCenterPayloadMap[K]> {
    const envelope: EventCenterEnvelope<EventCenterPayloadMap[K]> = {
      protocolVersion: EVENT_CENTER_PROTOCOL_VERSION,
      id: this.nextEventId(input.kind),
      kind: input.kind,
      source: this.source,
      occurredAt: this.now().toISOString(),
      payload: input.payload,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
      ...(input.aggregateKey ? { aggregateKey: input.aggregateKey } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    const notification = buildEventCenterJsonRpcNotification(envelope);
    for (const sink of this.sinks) {
      sink.publish(envelope, notification);
    }
    return envelope;
  }

  publishThreadLiveEvent(payload: ThreadLiveEvent): ThreadLiveEventCenterEnvelope {
    const kind = classifyThreadLiveEventForCenter(payload);
    return this.publish({
      kind,
      payload,
      threadId: payload.threadId,
      aggregateKey: `thread:${payload.threadId}`,
    }) as ThreadLiveEventCenterEnvelope;
  }

  publishSettingsUpdated(
    payload: EventCenterPayloadMap["settings.updated"],
  ): EventCenterEnvelope<EventCenterPayloadMap["settings.updated"]> {
    return this.publish({
      kind: "settings.updated",
      payload,
      aggregateKey: "settings:global",
    });
  }

  publishPackageScriptEvent(payload: EventCenterPayloadMap["workspace.package_script"]): EventCenterEnvelope {
    return this.publish({
      kind: "workspace.package_script",
      payload,
      aggregateKey: `package-script:${payload.runId}`,
    });
  }

  publishTerminalEvent(payload: EventCenterPayloadMap["workspace.terminal"]): EventCenterEnvelope {
    return this.publish({
      kind: "workspace.terminal",
      payload,
      aggregateKey: `terminal:${payload.sessionId}`,
    });
  }

  publishPackageJsonChanged(workspacePath: string): EventCenterEnvelope {
    return this.publish({
      kind: "workspace.package_json_changed",
      payload: { workspacePath },
      workspacePath,
      aggregateKey: `workspace:${workspacePath}:package-json`,
    });
  }

  publishGitRemoteFetched(workspacePath: string): EventCenterEnvelope {
    return this.publish({
      kind: "workspace.git_remote_fetched",
      payload: { workspacePath },
      workspacePath,
      aggregateKey: `workspace:${workspacePath}:git-fetch`,
    });
  }

  publishGitStatusChanged(
    payload: EventCenterGitStatusChangedPayload,
  ): EventCenterEnvelope<EventCenterGitStatusChangedPayload> {
    return this.publish({
      kind: "workspace.git_status_changed",
      payload,
      workspacePath: payload.workspacePath,
      aggregateKey: `workspace:${payload.workspacePath}:git-status`,
    });
  }

  async handleJsonRpcMessage(message: unknown): Promise<EventCenterJsonRpcResponse | undefined> {
    const request = parseJsonRpcRequest(message);
    if (!request.ok) {
      return buildEventCenterJsonRpcFailure(null, request.code, request.message, request.data);
    }

    const id = request.value.id ?? null;
    const shouldRespond = request.value.id !== undefined;
    if (request.value.method !== EVENT_CENTER_JSON_RPC_METHODS.invoke) {
      return shouldRespond
        ? buildEventCenterJsonRpcFailure(
            id,
            EVENT_CENTER_JSON_RPC_ERROR.methodNotFound,
            `Unsupported event center method: ${request.value.method}`,
          )
        : undefined;
    }

    if (!isEventCenterInvokeParams(request.value.params)) {
      return shouldRespond
        ? buildEventCenterJsonRpcFailure(
            id,
            EVENT_CENTER_JSON_RPC_ERROR.invalidParams,
            "eco.invoke params must include a channel and optional args array.",
          )
        : undefined;
    }

    if (!isKnownIpcChannel(request.value.params.channel)) {
      return shouldRespond
        ? buildEventCenterJsonRpcFailure(
            id,
            EVENT_CENTER_JSON_RPC_ERROR.invalidParams,
            `Unknown desktop command channel: ${request.value.params.channel}`,
          )
        : undefined;
    }

    if (!isRemoteCommandChannel(request.value.params.channel)) {
      return shouldRespond
        ? buildEventCenterJsonRpcFailure(
            id,
            EVENT_CENTER_JSON_RPC_ERROR.methodNotFound,
            `Desktop command is not remote-enabled: ${request.value.params.channel}`,
          )
        : undefined;
    }

    const argsValidation = validateRemoteCommandArgs(request.value.params.channel, request.value.params.args);
    if (!argsValidation.ok) {
      return shouldRespond
        ? buildEventCenterJsonRpcFailure(
            id,
            EVENT_CENTER_JSON_RPC_ERROR.invalidParams,
            argsValidation.message ?? "Desktop command args are invalid.",
          )
        : undefined;
    }

    const handler = this.commandHandlers.get(request.value.params.channel);
    if (!handler) {
      return shouldRespond
        ? buildEventCenterJsonRpcFailure(
            id,
            EVENT_CENTER_JSON_RPC_ERROR.methodNotFound,
            `Desktop command is not registered: ${request.value.params.channel}`,
          )
        : undefined;
    }

    try {
      const result = await handler(request.value.params.args ?? []);
      return shouldRespond
        ? buildEventCenterJsonRpcSuccess<EventCenterInvokeResult>(id, {
            channel: request.value.params.channel,
            result,
          })
        : undefined;
    } catch (error) {
      return shouldRespond
        ? buildEventCenterJsonRpcFailure(
            id,
            EVENT_CENTER_JSON_RPC_ERROR.internalError,
            error instanceof Error ? error.message : String(error),
          )
        : undefined;
    }
  }

  private nextEventId(kind: EventCenterEventKind): string {
    this.sequence += 1;
    const slug = kind.replace(/[^a-z0-9]+/gi, "_");
    return `${this.idPrefix}_${this.now().getTime().toString(36)}_${this.sequence}_${slug}`;
  }
}

/** Maps center envelopes onto legacy Electron IPC channels; renderer still receives raw payloads. */
export function createElectronEventSink(
  send: (channel: IpcChannel, payload: unknown) => void,
): DesktopEventCenterSink {
  return {
    publish(envelope, _notification) {
      switch (envelope.kind) {
        case "workspace.package_script":
          send(IPC_CHANNELS.workspacePackageScriptEvent, envelope.payload);
          return;
        case "workspace.terminal":
          send(IPC_CHANNELS.terminalEvent, envelope.payload);
          return;
        case "workspace.package_json_changed":
          send(
            IPC_CHANNELS.workspacePackageJsonChanged,
            (envelope.payload as EventCenterPackageJsonChangedPayload).workspacePath,
          );
          return;
        case "workspace.git_remote_fetched":
          send(
            IPC_CHANNELS.gitRemoteFetched,
            (envelope.payload as EventCenterGitRemoteFetchedPayload).workspacePath,
          );
          return;
        case "settings.updated":
          send(IPC_CHANNELS.threadEventsSubscribe, envelope.payload);
          return;
        default:
          send(IPC_CHANNELS.threadEventsSubscribe, envelope.payload);
      }
    },
  };
}

function parseJsonRpcRequest(
  message: unknown,
):
  | { ok: true; value: EventCenterJsonRpcRequest }
  | { ok: false; code: number; message: string; data?: unknown } {
  if (typeof message === "string") {
    try {
      return normalizeJsonRpcRequest(JSON.parse(message));
    } catch (error) {
      return {
        ok: false,
        code: EVENT_CENTER_JSON_RPC_ERROR.parseError,
        message: "Invalid JSON-RPC JSON payload.",
        data: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return normalizeJsonRpcRequest(message);
}

function normalizeJsonRpcRequest(
  message: unknown,
): { ok: true; value: EventCenterJsonRpcRequest } | { ok: false; code: number; message: string } {
  if (!isEventCenterJsonRpcRequest(message)) {
    return {
      ok: false as const,
      code: EVENT_CENTER_JSON_RPC_ERROR.invalidRequest,
      message: "Invalid JSON-RPC 2.0 request.",
    };
  }
  return { ok: true as const, value: message };
}
