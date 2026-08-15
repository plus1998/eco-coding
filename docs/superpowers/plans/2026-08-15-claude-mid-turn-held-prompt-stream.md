# Claude mid-turn held prompt stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live Claude Query 只保留一条 streaming 输入；mid-turn 跟进 `push` 进同一 mailbox，teardown 才结束 iterable，避免第二次 `streamInput()` 触发 `endInput()` 把 `can_use_tool` 取消成「用户拒绝」。

**Architecture:** 新增 `createHeldPromptStream`（首条 yield 后阻塞在 FIFO 队列）。`sdk.query({ prompt: stream })` 是唯一的 `streamInput`。`createClaudeQueryHandle.pushUserMessage` 改为 `promptStream.push`（ack = 该条已交给消费者）。Driver `finally` 在 `onClosing`（等 inflight）之后 `promptStream.close()`。

**Tech Stack:** TypeScript, Bun tests, `@anthropic-ai/claude-agent-sdk` 0.3.223（不改 SDK）。

**Spec:** [docs/superpowers/specs/2026-08-15-claude-mid-turn-held-prompt-stream-design.md](../specs/2026-08-15-claude-mid-turn-held-prompt-stream-design.md)

## Global Constraints

- 禁止 thread 主路径再调用 `query.streamInput()`。
- `toStreamingUserPrompt` 只留给 rewind / 一次性 prompt；不删、不改 rewind。
- 不用 J3H 文案推断 `cancelled`；不加 Skill/WebFetch 授权卡。
- 不改 Codex / PI mid-turn。
- `push` 成功 = 消息已被 prompt iterator 交给消费者（`queueMicrotask` ack），不能声称 `transport.write` 已完成。
- probe 名保持 `stream_input_ok` / `stream_input_timeout` / `stream_input_error`。
- 用户未明确要求时不要 git commit。
- TDD：每个行为先失败测试再实现。
- **ack 实现禁止**「generator 里 `yield` 后面再 `resolve`」：那会等到下一次 `next()`（消费者写完之后才 resume）。必须用自定义 async iterator：`next()` 返回该条时调度 ack。

## File map

| File | Responsibility |
|------|----------------|
| Modify `packages/runtime/src/claude-agent-sdk.ts` | `HeldPromptStream` / `createHeldPromptStream`；handle 改走 mailbox；driver 接线与 teardown 顺序 |
| Modify `packages/runtime/test/claude-agent-sdk.test.ts` | mailbox 单测、handle 单测、driver 回归（`streamInput` 调用次数 = 0） |
| Modify `docs/claude-core-baseline.md` | 纠正 mid-turn 输入模型 |
| Modify spec 状态为 accepted（实现完成后） | 与代码一致 |

---

### Task 1: `createHeldPromptStream` mailbox

**Files:**
- Modify: `packages/runtime/src/claude-agent-sdk.ts`（`toStreamingUserPrompt` 之后）
- Test: `packages/runtime/test/claude-agent-sdk.test.ts`

**Interfaces:**

```typescript
export type HeldPromptStream = StreamingUserPrompt & {
  push(text: string, options?: { uuid?: string }): Promise<void>;
  close(): void;
};

export function createHeldPromptStream(
  text: string,
  options?: { uuid?: string },
): HeldPromptStream;
```

- Consumes: 现有 `StreamingUserPrompt`、`SdkUserMessage` 形状（与 `toStreamingUserPrompt` 相同：`type:"user"`, `parent_tool_use_id: null`, 可选 `uuid`）
- Produces: 上列类型与工厂；`ecoPromptText === text`（未 trim 的原始字符串，与 `toStreamingUserPrompt` 一致）

- [ ] **Step 1: Write failing tests**（紧挨现有 `toStreamingUserPrompt` 测试之后；先 import `createHeldPromptStream`）

```typescript
test("createHeldPromptStream yields the initial message then stays open", async () => {
  const stream = createHeldPromptStream("hello", { uuid: "um-1" });
  expect(stream.ecoPromptText).toBe("hello");
  expect(resolveSdkPromptCaptureText(stream)).toBe("hello");

  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  expect(first.done).toBe(false);
  expect(first.value).toMatchObject({
    type: "user",
    parent_tool_use_id: null,
    uuid: "um-1",
    message: { role: "user", content: "hello" },
  });

  const raced = await Promise.race([
    iterator.next().then(() => "completed" as const),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 30)),
  ]);
  expect(raced).toBe("pending");
  stream.close();
});

test("createHeldPromptStream push yields FIFO and acks after the consumer receives the item", async () => {
  const stream = createHeldPromptStream("start");
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();

  const firstPush = stream.push("one", { uuid: "tfu_1" });
  const secondPush = stream.push("two", { uuid: "tfu_2" });

  const second = await iterator.next();
  expect(second.value).toMatchObject({
    uuid: "tfu_1",
    message: { role: "user", content: "one" },
  });
  await firstPush;

  const third = await iterator.next();
  expect(third.value).toMatchObject({
    uuid: "tfu_2",
    message: { role: "user", content: "two" },
  });
  await secondPush;

  stream.close();
  const done = await iterator.next();
  expect(done.done).toBe(true);
});

test("createHeldPromptStream close rejects queued and later pushes", async () => {
  const stream = createHeldPromptStream("start");
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();

  const pending = stream.push("late");
  stream.close();
  await expect(pending).rejects.toThrow(/closed/i);
  await expect(stream.push("after")).rejects.toThrow(/closed/i);
  expect((await iterator.next()).done).toBe(true);
});

test("createHeldPromptStream push rejects empty text", async () => {
  const stream = createHeldPromptStream("start");
  await expect(stream.push("  ")).rejects.toThrow(/non-empty/i);
  stream.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/runtime/test/claude-agent-sdk.test.ts -t "createHeldPromptStream"`

Expected: FAIL（`createHeldPromptStream` is not exported / is not a function）

- [ ] **Step 3: Minimal implementation**

在 `toStreamingUserPrompt` 之后加入（自定义 async iterator，**不要**用 generator `yield` 后再 resolve）：

```typescript
export type HeldPromptStream = StreamingUserPrompt & {
  push(text: string, options?: { uuid?: string }): Promise<void>;
  close(): void;
};

function buildSdkUserMessage(text: string, uuid?: string): SdkUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    ...(uuid?.trim() ? { uuid: uuid.trim() } : {}),
  };
}

export function createHeldPromptStream(
  text: string,
  options?: { uuid?: string },
): HeldPromptStream {
  type Queued = {
    message: SdkUserMessage;
    resolve: () => void;
    reject: (error: Error) => void;
  };
  const queue: Queued[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const closedError = () => new Error("Held prompt stream is closed.");

  const kick = () => {
    wake?.();
    wake = undefined;
  };

  const rejectQueued = () => {
    const pending = queue.splice(0);
    for (const item of pending) {
      item.reject(closedError());
    }
  };

  const stream: HeldPromptStream = {
    ecoPromptText: text,
    push(nextText, pushOptions) {
      const trimmed = nextText.trim();
      if (!trimmed) {
        return Promise.reject(new Error("Mid-turn push requires non-empty text."));
      }
      if (closed) {
        return Promise.reject(closedError());
      }
      return new Promise<void>((resolve, reject) => {
        queue.push({
          message: buildSdkUserMessage(trimmed, pushOptions?.uuid),
          resolve,
          reject,
        });
        kick();
      });
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      rejectQueued();
      kick();
    },
    [Symbol.asyncIterator]() {
      let yieldedInitial = false;
      return {
        async next() {
          if (!yieldedInitial) {
            yieldedInitial = true;
            return {
              value: buildSdkUserMessage(text, options?.uuid),
              done: false,
            };
          }
          while (queue.length === 0 && !closed) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
          if (closed) {
            rejectQueued();
            return { value: undefined, done: true };
          }
          const item = queue.shift();
          if (!item) {
            return { value: undefined, done: true };
          }
          queueMicrotask(() => item.resolve());
          return { value: item.message, done: false };
        },
      };
    },
  };
  return stream;
}
```

把 `toStreamingUserPrompt` 里的用户消息构造抽到 `buildSdkUserMessage`（rewind 路径继续用 `toStreamingUserPrompt`，行为不变）。`holdOpenUntil` 选项保留。

- [ ] **Step 4: Re-run tests**

Run: `bun test packages/runtime/test/claude-agent-sdk.test.ts -t "createHeldPromptStream"`

Expected: PASS。再跑 `bun test packages/runtime/test/claude-agent-sdk.test.ts -t "toStreamingUserPrompt"` 确认 rewind 用的一次性 prompt 未坏。

- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 2: `createClaudeQueryHandle` 改为 `promptStream.push`

**Files:**
- Modify: `packages/runtime/src/claude-agent-sdk.ts`（`ClaudeQueryHandle` 注释、`createClaudeQueryHandle`）
- Test: `packages/runtime/test/claude-agent-sdk.test.ts`（`createClaudeQueryHandle rejects push after phase closes`、`marks streamInput timeout`）

**Interfaces:**
- Consumes: Task 1 `HeldPromptStream`
- Produces:

```typescript
export function createClaudeQueryHandle(
  query: SdkQueryHandle,
  options: {
    promptStream: HeldPromptStream;
    streamInputDeadlineMs?: number;
    onProbe?: (phase: string, detail: Record<string, unknown>) => void;
  },
): ClaudeQueryHandle;
```

`pushUserMessage`：`phase !== "open"` → `Claude query is not accepting mid-turn input.`；否则 `settleWithin(promptStream.push(trimmed, pushOptions), deadlineMs)`。不再读取或调用 `query.streamInput`。

- [ ] **Step 1: Write failing tests** — 改现有两个 handle 测试，并加「不调用 streamInput」：

测试文件顶部加 helper（仅测试用）：

```typescript
function createFakeHeldPromptStream(
  overrides?: Partial<Pick<HeldPromptStream, "push" | "close">>,
): HeldPromptStream {
  return {
    ecoPromptText: "fake",
    async *[Symbol.asyncIterator]() {},
    push: overrides?.push ?? (async () => {}),
    close: overrides?.close ?? (() => {}),
  };
}
```

替换：

```typescript
test("createClaudeQueryHandle rejects push after phase closes", async () => {
  const handle = createClaudeQueryHandle(
    { async *[Symbol.asyncIterator]() {} },
    { promptStream: createFakeHeldPromptStream() },
  );
  await handle.pushUserMessage("ok");
  handle.phase = "closing";
  await expect(handle.pushUserMessage("nope")).rejects.toThrow(/not accepting mid-turn/i);
});

test("createClaudeQueryHandle marks promptStream push timeout as delivery unknown", async () => {
  const handle = createClaudeQueryHandle(
    {
      async *[Symbol.asyncIterator]() {},
      streamInput: async () => {
        throw new Error("query.streamInput must not be called");
      },
    },
    {
      promptStream: createFakeHeldPromptStream({
        push: () => new Promise<void>(() => {}),
      }),
      streamInputDeadlineMs: 5,
    },
  );
  try {
    await handle.pushUserMessage("uncertain");
    expect.unreachable("push should time out");
  } catch (error) {
    expect(error).toMatchObject({
      code: "ClaudeStreamInputFailed",
      deliveryUnknown: true,
    });
  }
});
```

- [ ] **Step 2: Run fail**

Run: `bun test packages/runtime/test/claude-agent-sdk.test.ts -t "createClaudeQueryHandle"`

Expected: FAIL（`promptStream` 不是现有 options 形状 / 仍走 `query.streamInput`）

- [ ] **Step 3: Implement handle**

更新 `ClaudeQueryHandle.pushUserMessage` 注释为 mailbox，不再写「via official streamInput」。

`createClaudeQueryHandle` 核心：

```typescript
async pushUserMessage(text, pushOptions) {
  if (handle.phase !== "open") {
    throw new Error("Claude query is not accepting mid-turn input.");
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Mid-turn push requires non-empty text.");
  }
  const deadlineMs = options.streamInputDeadlineMs ?? CLAUDE_QUERY_STREAM_INPUT_DEADLINE_MS;
  const raced = await settleWithin(options.promptStream.push(trimmed, pushOptions), deadlineMs);
  if (raced.kind === "timeout") {
    options.onProbe?.("stream_input_timeout", {
      deadline_ms: deadlineMs,
      uuid: pushOptions?.uuid?.trim() || null,
    });
    throw new ClaudeStreamInputFailed(
      `streamInput timed out after ${deadlineMs}ms; delivery status is unknown.`,
      true,
    );
  }
  if (raced.kind === "rejected") {
    const message = raced.error instanceof Error ? raced.error.message : String(raced.error);
    options.onProbe?.("stream_input_error", {
      error: message,
      uuid: pushOptions?.uuid?.trim() || null,
    });
    throw new ClaudeStreamInputFailed(message, true, { cause: raced.error });
  }
  options.onProbe?.("stream_input_ok", {
    uuid: pushOptions?.uuid?.trim() || null,
    text_len: trimmed.length,
  });
}
```

超时文案保持 `streamInput timed out after …`（desktop 已按此对账）。

- [ ] **Step 4: Pass**

Run: `bun test packages/runtime/test/claude-agent-sdk.test.ts -t "createClaudeQueryHandle"`

Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 3: Driver 接线 — 唯一 prompt stream + teardown close

**Files:**
- Modify: `packages/runtime/src/claude-agent-sdk.ts`（`run`/`runAsk` 里创建 query 的那段：约 1209–1258、1387–1393）
- Test: `packages/runtime/test/claude-agent-sdk.test.ts`（改 `holds the initial prompt open`、`mid-turn pushUserMessage calls streamInput`；新增 #348 形状回归）

**Interfaces:**
- Consumes: Task 1 stream、Task 2 handle `{ promptStream }`
- Produces: Driver 行为：`sdk.query({ prompt: heldStream })`；`handle.pushUserMessage` → 同一 stream；`query.streamInput` 调用次数 0；`finally` 顺序为 `onClosing` → `promptStream.close()` → `teardownClaudeQueryHandle`

**Teardown 顺序（相对现码必须改）：** 现在 `releasePromptHold()` 在 `onClosing` **之前**。Mailbox 下 inflight `push` 还要等 iterator ack，必须：

```text
onClosing(handle)      // port 拒新 push；await inflight
promptStream.close()   // 未 ack 的队列 reject；iterator done → SDK 才 endInput
teardown / query.close()
onClosed(handle)
```

- [ ] **Step 1: Write failing tests**

改 `ClaudeAgentSdkDriver mid-turn pushUserMessage calls streamInput with uuid` 为「跟进出现在 **query 的 prompt iterable**，且 `streamInput` 不被调用」：

```typescript
test("ClaudeAgentSdkDriver mid-turn pushUserMessage yields on the held prompt stream", async () => {
  let openHandle: import("../src/claude-agent-sdk").ClaudeQueryHandle | undefined;
  const promptMessages: Array<{ text: string; uuid?: string }> = [];
  let streamInputCalls = 0;
  let releaseResult: (() => void) | undefined;
  const resultGate = new Promise<void>((resolve) => {
    releaseResult = resolve;
  });
  const driver = new ClaudeAgentSdkDriver({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:36037",
    queryLifecycle: {
      onOpen: (handle) => {
        openHandle = handle;
      },
    },
    loadSdk: async () => ({
      query: ({ prompt }) => {
        void (async () => {
          for await (const message of prompt as AsyncIterable<{
            uuid?: string;
            message: { content: string };
          }>) {
            promptMessages.push({
              text: message.message.content,
              ...(message.uuid ? { uuid: message.uuid } : {}),
            });
          }
        })();
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "system",
              subtype: "init",
              session_id: "sess-mid-turn",
              uuid: "init-mid-turn",
            };
            await resultGate;
            yield {
              type: "result",
              subtype: "success",
              session_id: "sess-mid-turn",
              uuid: "result-mid-turn",
            };
          },
          streamInput: async () => {
            streamInputCalls += 1;
          },
          close: () => {},
        };
      },
    }),
  });

  const run = (async () => {
    for await (const event of driver.runAsk({
      threadId: "thr_mid_turn",
      prompt: "Start",
      workspacePath: "/tmp/workspace",
      worktreePath: "/tmp/worktree",
      routes,
      signal: new AbortController().signal,
    })) {
      if (event.type === "session.captured" && openHandle) {
        await openHandle.pushUserMessage("Inject mid-turn", { uuid: "tfu_mid_1" });
        releaseResult?.();
      }
    }
  })();

  await run;
  expect(streamInputCalls).toBe(0);
  expect(promptMessages).toEqual([
    { text: "Start" },
    { text: "Inject mid-turn", uuid: "tfu_mid_1" },
  ]);
  expect(openHandle?.phase).toBe("closed");
});
```

新增：首条 `result` 之后 iterable 仍不 `done`，直到 run 结束（#348）：

```typescript
test("ClaudeAgentSdkDriver keeps the prompt iterable open after the first result until teardown", async () => {
  let promptDoneBeforeClose = false;
  let promptDone = false;
  let sawResultWhilePromptHeld = false;
  let openHandle: import("../src/claude-agent-sdk").ClaudeQueryHandle | undefined;

  const driver = new ClaudeAgentSdkDriver({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:36037",
    queryLifecycle: {
      onOpen: (handle) => {
        openHandle = handle;
      },
    },
    loadSdk: async () => ({
      query: ({ prompt }) => {
        void (async () => {
          for await (const _message of prompt as AsyncIterable<unknown>) {
            // drain until close
          }
          promptDone = true;
        })();
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "system",
              subtype: "init",
              session_id: "sess-hold-follow-up",
              uuid: "init-hold-follow-up",
            };
            yield {
              type: "result",
              subtype: "success",
              session_id: "sess-hold-follow-up",
              uuid: "result-hold-follow-up",
            };
            await Promise.resolve();
            await Promise.resolve();
            sawResultWhilePromptHeld = !promptDone;
            if (openHandle) {
              await openHandle.pushUserMessage("after result");
            }
            promptDoneBeforeClose = promptDone;
          },
          streamInput: async () => {
            throw new Error("query.streamInput must not be called");
          },
          close: () => {},
        };
      },
    }),
  });

  for await (const _event of driver.runAsk({
    threadId: "thr_hold_follow_up",
    prompt: "hi",
    workspacePath: "/tmp/workspace",
    worktreePath: "/tmp/worktree",
    routes,
    signal: new AbortController().signal,
  })) {
    // consume
  }

  expect(sawResultWhilePromptHeld).toBe(true);
  expect(promptDoneBeforeClose).toBe(false);
  expect(promptDone).toBe(true);
});
```

把旧测试 `holds the initial prompt open until teardown` 改为消费 `createHeldPromptStream`（不再依赖 `holdOpenUntil`）。断言不变：`result` 时 prompt 未 done；run 结束后 done。

`ClaudeAgentSdkDriver emits incomplete when mid-turn input has no matching result`：mock 的 `streamInput: async () => {}` 可删；push 必须有人在消费 prompt iterable，否则会 timeout。在该测试的 `query({ prompt })` 里同样 `for await` drain prompt，或在 `onOpen` 里不要 push 太早——保持现有「push 后没有对应 result」语义：drain prompt + 只 yield 一个 result（对应初始 prompt），push 第二条后不再 yield result。

- [ ] **Step 2: Run fail**

Run: `bun test packages/runtime/test/claude-agent-sdk.test.ts -t "mid-turn|held prompt|hold_follow"`

Expected: FAIL（driver 仍调用 `streamInput` / 无 `promptStream` 传给 handle）

- [ ] **Step 3: Wire driver**

替换：

```typescript
const promptStream = createHeldPromptStream(phase.prompt);
const query = sdk.query({
  prompt: promptStream,
  options: queryOptions,
});
const handle = createClaudeQueryHandle(query, {
  promptStream,
  ...(this.options.queryStreamInputDeadlineMs !== undefined
    ? { streamInputDeadlineMs: this.options.queryStreamInputDeadlineMs }
    : {}),
  onProbe: (probePhase, detail) => this.options.onContextProbe?.(probePhase, detail),
});
```

删除 `releasePromptHold` / `promptHoldOpenUntil`。

`finally`：

```typescript
} finally {
  input.signal.removeEventListener("abort", onAbort);
  try {
    await this.options.queryLifecycle?.onClosing?.(handle);
  } catch {
    // Port closeIngress must not block teardown / transport release.
  }
  promptStream.close();
  const teardown = await teardownClaudeQueryHandle(handle, { ... });
  ...
}
```

更新文件头 WORKAROUND 注释：hold 的是 **整条 mailbox**，直到 teardown；**禁止** mid-turn 再 `streamInput`。删除「leave mid-turn streamInput injects without it」。

- [ ] **Step 4: Pass**

Run:

```bash
bun test packages/runtime/test/claude-agent-sdk.test.ts -t "createHeldPromptStream|createClaudeQueryHandle|mid-turn|holds the initial|keeps the prompt iterable|incomplete when mid-turn"
```

Expected: PASS

再跑：`bun test packages/runtime/test/claude-agent-sdk.test.ts`

Expected: PASS（全文件）

- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 4: 文档与 spec 状态

**Files:**
- Modify: `docs/claude-core-baseline.md`（会话启动模型、Query 生命周期、`pushUserMessage` 行）
- Modify: `docs/superpowers/specs/2026-08-15-claude-mid-turn-held-prompt-stream-design.md` 状态 → `accepted`

**Interfaces:** 无代码接口。

- [ ] **Step 1: 改 baseline**

「会话启动模型」改为：

```markdown
- Thread 主路径（`run` / `runAsk` / `runPlan` / `runContinuation`）统一为 **streaming input 模式**：
  `sdk.query({ prompt: createHeldPromptStream(text), options })`。
- `createHeldPromptStream` 先 yield 初始用户消息，然后阻塞在队列上，**直到 query teardown `close()`**。
  同 run 内后续用户文本经 `HeldPromptStream.push` 注入同一条 iterable，**禁止**再调 `query.streamInput`。
- `toStreamingUserPrompt` 仅用于 rewind 等一次性 prompt（yield 一条即结束）。
```

生命周期里 `pushUserMessage`：

```markdown
- `ClaudeQueryHandle.pushUserMessage`：仅 `phase === "open"` 时 `promptStream.push`；带截止时间；失败抛错。
- Accept = 该条已被唯一 `streamInput` 的 prompt iterator 取走（非模型答完；非 `streamInput()` 函数返回）。
```

- [ ] **Step 2: spec 状态改为 accepted**
- [ ] **Step 3: 无测试**（文档）
- [ ] **Step 4: Commit**（仅当用户要求）

---

## Spec coverage

| Spec 要求 | Task |
|-----------|------|
| 一条 streaming 输入，禁止第二次 `streamInput` | 3 |
| teardown 前 iterable 不 done | 1 + 3 |
| `pushUserMessage` ack = 已交给消费者；timeout/`deliveryUnknown` | 2 |
| `onClosing` 后再 close mailbox | 3 |
| 修正 baseline / 错误注释 | 3 注释 + 4 |
| rewind `toStreamingUserPrompt` 不动 | 1（保留）+ 约束 |
| 不映射 J3H、不加授权卡、不改 Codex/PI | 约束 |
| 测试：mailbox / driver 同 iterable / #348 / 现有 uuid·phase·timeout | 1–3 |

## 成功标准（实现后）

`hi` → mid-turn「打开 huggingface」→ `Skill` / `WebFetch` 不再出现 `toolDenialKind: "cancelled"`。本计划用 mock 锁住通道形状；真机会话是手工冒烟，不在自动化任务里假装已跑过。
