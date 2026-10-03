import type {
  ResponsesError,
  ResponsesOutput,
  ResponsesResponse,
  ResponsesStreamEvent,
} from "@eco/openai-anthropic-bridge";
import {
  appendStreamUtf8Chunk,
  createStreamUtf8Decoder,
  finalizeStreamUtf8Decoder,
  parseResponsesStreamEventBlock,
  splitSseBlocks,
} from "../sse.js";

export class ResponsesStreamError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ResponsesStreamError";
  }
}

/** Collect the terminal response for clients requesting JSON from a streaming upstream. */
export async function collectResponsesStream(
  body: ReadableStream<Uint8Array>,
  options: { signal?: AbortSignal; idleTimeoutMs?: number } = {},
): Promise<ResponsesResponse> {
  const reader = body.getReader();
  const decoder = createStreamUtf8Decoder();
  let buffer = "";
  const completedItems = new Map<number, ResponsesOutput>();
  const pendingItems = new Set<number>();
  let sawOutput = false;

  const readChunk = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(options.signal?.reason ?? new Error("Request aborted"));
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      timer = setTimeout(
        () =>
          reject(
            new ResponsesStreamError("Timed out waiting for upstream Responses stream", "stream_timeout"),
          ),
        options.idleTimeoutMs ?? 45_000,
      );
    });
    try {
      return await Promise.race([reader.read(), stopped]);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  };

  const terminalResponse = (blocks: readonly string[]): ResponsesResponse | undefined => {
    for (const block of blocks) {
      const event = parseResponsesStreamEventBlock(block) as
        | (ResponsesStreamEvent & { error?: ResponsesError; message?: string })
        | null;
      if (!event) {
        if (
          block
            .split(/\r?\n/)
            .some(
              (line) => line.startsWith("data:") && line.slice(5).trim() && line.slice(5).trim() !== "[DONE]",
            )
        ) {
          throw new ResponsesStreamError("Invalid JSON in upstream Responses stream", "invalid_stream");
        }
        continue;
      }
      if (event.type === "response.failed" || event.type === "error") {
        const error = event.response?.error ?? event.error;
        const code = error?.code ?? event.code;
        throw new ResponsesStreamError(
          error?.message ?? event.message ?? "Upstream Responses stream failed",
          typeof code === "string" ? code : undefined,
        );
      }
      if (
        event.type.startsWith("response.output_") ||
        event.type === "response.function_call_arguments.delta"
      ) {
        sawOutput = true;
      }
      if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
        const index = event.output_index;
        if (index === undefined || !Number.isInteger(index) || index < 0 || !event.item?.type) {
          throw new ResponsesStreamError(
            "Invalid output item in upstream Responses stream",
            "invalid_stream",
          );
        }
        if (event.type === "response.output_item.done") {
          completedItems.set(index, event.item);
          pendingItems.delete(index);
        } else {
          pendingItems.add(index);
        }
      }
      if (event.type === "response.completed" || event.type === "response.incomplete") {
        const response = event.response;
        const expectedStatus = event.type === "response.completed" ? "completed" : "incomplete";
        if (!response?.id || !Array.isArray(response.output) || response.status !== expectedStatus) {
          throw new ResponsesStreamError(
            "Invalid terminal response in upstream Responses stream",
            "invalid_stream",
          );
        }
        if (response.output.length > 0) return response;
        // ChatGPT sends the full items in output_item.done, while the terminal
        // response.output can be empty. Collect those real items in wire order.
        if (pendingItems.size > 0 || (sawOutput && completedItems.size === 0)) {
          throw new ResponsesStreamError(
            "Upstream terminal response is missing completed output items",
            "incomplete_stream",
          );
        }
        const items = [...completedItems.entries()].sort(([a], [b]) => a - b);
        if (items.some(([index], position) => index !== position)) {
          throw new ResponsesStreamError(
            "Upstream terminal response is missing an output item",
            "incomplete_stream",
          );
        }
        return { ...response, output: items.map(([, item]) => item) };
      }
    }
    return undefined;
  };

  try {
    options.signal?.throwIfAborted();
    while (true) {
      const { done, value } = await readChunk();
      buffer = done
        ? finalizeStreamUtf8Decoder(decoder, buffer)
        : appendStreamUtf8Chunk(decoder, buffer, value);
      const { blocks, remainder } = splitSseBlocks(done && buffer.trim() ? `${buffer}\n\n` : buffer);
      buffer = remainder;
      const response = terminalResponse(blocks);
      if (response) return response;
      if (done)
        throw new ResponsesStreamError(
          "Upstream Responses stream ended before a terminal response",
          "incomplete_stream",
        );
    }
  } finally {
    // Stop immediately at the terminal event; upstream need not close its socket.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
