import type {
  EcoForwardedInvokeParams,
  EcoJsonRpcNotification,
  EcoJsonRpcRequest,
  EcoJsonRpcResponse,
} from "@eco/shared";
import Redis from "ioredis";
import { buildRedisConnectionUrl } from "../presence/presence-store";

export type RpcBusMessage =
  | {
      type: "invoke";
      serverId: string;
      originInstanceId: string;
      desktopDeviceId: string;
      desktopSessionId: string;
      request: EcoJsonRpcRequest<EcoForwardedInvokeParams>;
      deadlineMs: number;
    }
  | {
      type: "response";
      serverId: string;
      response: EcoJsonRpcResponse;
    }
  | {
      type: "event";
      mobileDeviceId: string;
      mobileSessionId: string;
      notification: EcoJsonRpcNotification;
    }
  | {
      type: "disconnect-device";
      deviceId: string;
      sessionId: string;
      reason: string;
    };

export type RpcBusMessageHandler = (message: RpcBusMessage) => void | Promise<void>;

export interface RpcBus {
  readonly instanceId: string;
  start(handler: RpcBusMessageHandler): Promise<void>;
  publish(targetInstanceId: string, message: RpcBusMessage): Promise<void>;
  close(): Promise<void>;
}

export class MemoryRpcBus implements RpcBus {
  private readonly hub: MemoryRpcBusHub;
  readonly instanceId: string;
  private handler: RpcBusMessageHandler | undefined;

  constructor(instanceId: string, hub = new MemoryRpcBusHub()) {
    this.instanceId = instanceId;
    this.hub = hub;
  }

  async start(handler: RpcBusMessageHandler): Promise<void> {
    this.handler = handler;
    this.hub.register(this.instanceId, this);
  }

  async publish(targetInstanceId: string, message: RpcBusMessage): Promise<void> {
    await this.hub.publish(targetInstanceId, message);
  }

  async close(): Promise<void> {
    this.hub.unregister(this.instanceId, this);
    this.handler = undefined;
  }

  async receive(message: RpcBusMessage): Promise<void> {
    await this.handler?.(message);
  }
}

export class MemoryRpcBusHub {
  private readonly buses = new Map<string, MemoryRpcBus>();

  register(instanceId: string, bus: MemoryRpcBus): void {
    this.buses.set(instanceId, bus);
  }

  unregister(instanceId: string, bus: MemoryRpcBus): void {
    if (this.buses.get(instanceId) === bus) {
      this.buses.delete(instanceId);
    }
  }

  async publish(targetInstanceId: string, message: RpcBusMessage): Promise<void> {
    await this.buses.get(targetInstanceId)?.receive(message);
  }
}

export class RedisRpcBus implements RpcBus {
  readonly instanceId: string;
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly channelPrefix: string;
  private handler: RpcBusMessageHandler | undefined;

  constructor(input: {
    instanceId: string;
    redisUrl: string;
    redisPassword?: string;
    channelPrefix?: string;
  }) {
    this.instanceId = input.instanceId;
    const url = buildRedisConnectionUrl(input.redisPassword, input.redisUrl);
    this.publisher = new Redis(url);
    this.subscriber = new Redis(url);
    this.channelPrefix = input.channelPrefix ?? "eco:rpc-bus:";
  }

  async start(handler: RpcBusMessageHandler): Promise<void> {
    this.handler = handler;
    await this.subscriber.subscribe(this.channel(this.instanceId));
    this.subscriber.on("message", (_channel, payload) => {
      void this.handlePayload(payload);
    });
  }

  async publish(targetInstanceId: string, message: RpcBusMessage): Promise<void> {
    await this.publisher.publish(this.channel(targetInstanceId), JSON.stringify(message));
  }

  async close(): Promise<void> {
    await this.subscriber.unsubscribe(this.channel(this.instanceId));
    this.subscriber.disconnect();
    this.publisher.disconnect();
  }

  private async handlePayload(payload: string): Promise<void> {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRpcBusMessage(parsed)) {
      return;
    }
    await this.handler?.(parsed);
  }

  private channel(instanceId: string): string {
    return `${this.channelPrefix}${instanceId}`;
  }
}

function isRpcBusMessage(value: unknown): value is RpcBusMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as RpcBusMessage;
  return (
    message.type === "invoke" ||
    message.type === "response" ||
    message.type === "event" ||
    message.type === "disconnect-device"
  );
}
