# @eco/openai-anthropic-bridge

Protocol conversion between **Anthropic Messages**, **OpenAI Responses**, and **OpenAI Chat Completions**, with optional upstream request retry helpers for gateways.

Responses API is the hub format: Anthropic and Chat Completions clients can be served through the same upstream.

## Install (monorepo)

```bash
bun install
```

Workspace package: `@eco/openai-anthropic-bridge` (private in v1; structured for future npm publish).

## Usage

### Anthropic → Responses (request)

```typescript
import { anthropicToResponses } from "@eco/openai-anthropic-bridge";

const responsesReq = anthropicToResponses(anthropicBody);
await fetch(`${upstream}/v1/responses`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(responsesReq),
});
```

### Chat Completions → Responses → upstream → Chat Completions (streaming)

```typescript
import {
  chatCompletionsToResponses,
  newResponsesEventToChatState,
  responsesEventToChatChunks,
  chatChunkToSse,
  newChatCompletionsToResponsesStreamState,
  chatCompletionsChunkToResponsesEvents,
  responsesEventToSse,
} from "@eco/openai-anthropic-bridge";
```

### Upstream retry

```typescript
import { runWithUpstreamRetry, shouldFailoverUpstreamError } from "@eco/openai-anthropic-bridge";

const { value: res } = await runWithUpstreamRetry(
  () => fetch(url, { method: "POST", body }),
  {
    canRetry: () => !headersSentToClient,
    shouldRetry: (err) => /* custom */,
  },
);
```

Defaults: 5 attempts, 300ms–3s exponential backoff, 10s total budget.

**Streaming:** do not retry after bytes have been flushed to the client; pass `canRetry: () => false` once streaming starts.

## Public API surface

| Direction | Functions |
|-----------|-----------|
| Anthropic → Responses | `anthropicToResponses`, `anthropicToResponsesResponse`, stream: `anthropicEventToResponsesEvents` |
| Responses → Anthropic | `responsesToAnthropicRequest`, `responsesToAnthropic`, stream: `responsesEventToAnthropicEvents` |
| Chat → Responses | `chatCompletionsToResponses`, `chatCompletionsResponseToResponses`, stream: `chatCompletionsChunkToResponsesEvents` |
| Responses → Chat | `responsesToChatCompletionsRequest`, `responsesToChatCompletions`, stream: `responsesEventToChatChunks` |
| SSE | `responsesEventToSse`, `responsesAnthropicEventToSse`, `chatChunkToSse` |
| Wire JSON | `responsesStreamEventToJSON` (required zero fields for Codex CLI) |
| Retry | `runWithUpstreamRetry`, `shouldFailoverUpstreamError`, `retryBackoffDelay` |

## Development

```bash
bun test packages/openai-anthropic-bridge
bun run typecheck
```

## Future npm SDK

v1 ships TypeScript sources via `exports: "./src/index.ts"`. Publishing only needs a `dist/` build, `LICENSE`, and removing `private: true` — no API redesign.

## Note on behavior reference

Development used local exploration of gateway protocol behavior (tool-call ordering, cache token semantics, Responses SSE wire shape). This package is an independent TypeScript implementation for eco-coding.
