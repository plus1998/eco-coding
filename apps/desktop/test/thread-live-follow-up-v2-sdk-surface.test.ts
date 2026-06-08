import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSdkFile(fileName: string): string {
  return readFileSync(
    new URL(`../../../node_modules/@anthropic-ai/claude-agent-sdk/${fileName}`, import.meta.url),
    "utf8",
  );
}

function expectContainsAll(source: string, expected: string[]) {
  const missing = expected.filter((needle) => !source.includes(needle));
  expect(missing).toEqual([]);
}

test("installed Claude Agent SDK exposes the streaming input control surface Eco needs for V2", () => {
  const packageJson = JSON.parse(readSdkFile("package.json")) as Record<string, unknown>;
  const sdkTypes = readSdkFile("sdk.d.ts");

  expect(packageJson.name).toBe("@anthropic-ai/claude-agent-sdk");
  expect(typeof packageJson.version).toBe("string");
  expect(typeof packageJson.claudeCodeVersion).toBe("string");
  expectContainsAll(sdkTypes, [
    "prompt: string | AsyncIterable<SDKUserMessage>",
    "export declare interface Query extends AsyncGenerator<SDKMessage, void>",
    "interrupt(): Promise<void>",
    "streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>",
    "close(): void",
    "resume?: string;",
    "resumeSessionAt?: string;",
    "forkSession?: boolean;",
    "sessionStore?: SessionStore;",
    "hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;",
    "mcpServers?: Record<string, McpServerConfig>;",
    "systemPrompt?: string | string[] | {",
    "agents?: Record<string, AgentDefinition>;",
    "includePartialMessages?: boolean;",
    "total_cost_usd",
    "modelUsage",
  ]);
});

test("assistant worker surface is alpha remote-control glue, not Eco's default V2 runtime path", () => {
  const assistantTypes = readSdkFile("assistant.d.ts");

  expectContainsAll(assistantTypes, [
    "@alpha",
    "export type AssistantWorkerOptions",
    "bridge: ConnectRemoteControlOptions;",
    "buildQueryOptions: (base: Options) => Options | Promise<Options>;",
    "stateAdapter?: WorkerStateAdapter;",
    "pushPrompt(content: string | SDKUserMessage['message']['content']): void;",
    "interrupt(): Promise<void>;",
    "export declare function runAssistantWorker(opts: AssistantWorkerOptions): Promise<AssistantWorkerResult>;",
  ]);
});
