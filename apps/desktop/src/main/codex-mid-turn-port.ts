import type { CodexAppServerClient } from "@eco/runtime/codex-app-server-client";
import { steerCodexTurn } from "@eco/runtime/codex-turn-steer";

export type CodexMidTurnPortPhase = "accepting" | "closing" | "closed";

export type CodexMidTurnPushResult =
  | { ok: true; turnId: string }
  | { ok: false; reason: string; retriable: boolean; deliveryUnknown: boolean };

export type CodexMidTurnPortHandle = {
  client: Pick<CodexAppServerClient, "request">;
  codexThreadId: string;
  turnId: string;
};

type PortEntry = {
  threadId: string;
  phase: CodexMidTurnPortPhase;
  handle: CodexMidTurnPortHandle;
  inflight: Set<Promise<unknown>>;
};

/**
 * Main-process registry for live Codex turn mid-turn inject via `turn/steer`.
 * One accepting port per Eco thread (main regular turn only).
 */
export class CodexMidTurnPortRegistry {
  private readonly ports = new Map<string, PortEntry>();

  open(threadId: string, handle: CodexMidTurnPortHandle): void {
    const id = threadId.trim();
    if (!id) {
      return;
    }
    this.ports.set(id, {
      threadId: id,
      phase: "accepting",
      handle: {
        client: handle.client,
        codexThreadId: handle.codexThreadId.trim(),
        turnId: handle.turnId.trim(),
      },
      inflight: new Set(),
    });
  }

  getPhase(threadId: string): CodexMidTurnPortPhase | undefined {
    return this.ports.get(threadId.trim())?.phase;
  }

  isAccepting(threadId: string): boolean {
    return this.getPhase(threadId) === "accepting";
  }

  async closeIngress(threadId: string): Promise<void> {
    const port = this.ports.get(threadId.trim());
    if (!port || port.phase === "closed") {
      return;
    }
    port.phase = "closing";
    if (port.inflight.size === 0) {
      return;
    }
    await Promise.allSettled([...port.inflight]);
  }

  close(threadId: string): void {
    const id = threadId.trim();
    const port = this.ports.get(id);
    if (!port) {
      return;
    }
    port.phase = "closed";
    this.ports.delete(id);
  }

  async tryPushUserText(
    threadId: string,
    text: string,
    options?: { clientUserMessageId?: string },
  ): Promise<CodexMidTurnPushResult> {
    const port = this.ports.get(threadId.trim());
    if (!port || port.phase !== "accepting") {
      return {
        ok: false,
        reason: "No live Codex turn is accepting mid-turn input.",
        retriable: true,
        deliveryUnknown: false,
      };
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        ok: false,
        reason: "Mid-turn steer requires non-empty text.",
        retriable: false,
        deliveryUnknown: false,
      };
    }
    const { client, codexThreadId, turnId } = port.handle;
    const work = steerCodexTurn(client, {
      threadId: codexThreadId,
      turnId,
      input: [{ type: "text", text: trimmed }],
      ...(options?.clientUserMessageId?.trim()
        ? { clientUserMessageId: options.clientUserMessageId.trim() }
        : {}),
    }).then(
      (result) => ({ ok: true as const, turnId: result.turnId }),
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        const deliveryUnknown =
          error instanceof Error && "deliveryUnknown" in error && error.deliveryUnknown === true;
        return {
          ok: false as const,
          reason,
          retriable: !deliveryUnknown && !/requires threadId|empty|non-empty/i.test(reason),
          deliveryUnknown,
        };
      },
    );
    port.inflight.add(work);
    try {
      return await work;
    } finally {
      port.inflight.delete(work);
    }
  }
}
