/**
 * Thin Supabase Realtime Broadcast envelope around EcoJsonRpcMessage.
 *
 * Clients send/receive Broadcast payloads with event name `eco.rpc`;
 * the envelope body carries the existing JSON-RPC message unchanged.
 */

import {
  isEcoJsonRpcNotification,
  isEcoJsonRpcRequest,
  isEcoJsonRpcResponse,
  type EcoJsonRpcMessage,
} from "./event-rpc";

export const ECO_REALTIME_BROADCAST_EVENT = "eco.rpc" as const;
export const ECO_REALTIME_ENVELOPE_VERSION = 1 as const;

export interface EcoRealtimeRpcEnvelope<TMessage extends EcoJsonRpcMessage = EcoJsonRpcMessage> {
  v: typeof ECO_REALTIME_ENVELOPE_VERSION;
  event: typeof ECO_REALTIME_BROADCAST_EVENT;
  message: TMessage;
}

export function wrapEcoRpcForBroadcast<TMessage extends EcoJsonRpcMessage>(
  message: TMessage,
): EcoRealtimeRpcEnvelope<TMessage> {
  return {
    v: ECO_REALTIME_ENVELOPE_VERSION,
    event: ECO_REALTIME_BROADCAST_EVENT,
    message,
  };
}

export function unwrapEcoRpcFromBroadcast(value: unknown): EcoJsonRpcMessage | null {
  if (!isEcoRealtimeRpcEnvelope(value)) {
    return null;
  }
  return value.message;
}

export function isEcoRealtimeRpcEnvelope(value: unknown): value is EcoRealtimeRpcEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const envelope = value as EcoRealtimeRpcEnvelope;
  return (
    envelope.v === ECO_REALTIME_ENVELOPE_VERSION &&
    envelope.event === ECO_REALTIME_BROADCAST_EVENT &&
    isEcoJsonRpcMessage(envelope.message)
  );
}

export function isEcoJsonRpcMessage(value: unknown): value is EcoJsonRpcMessage {
  return isEcoJsonRpcRequest(value) || isEcoJsonRpcResponse(value) || isEcoJsonRpcNotification(value);
}
