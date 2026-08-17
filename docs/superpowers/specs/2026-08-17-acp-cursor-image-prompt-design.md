# Cursor ACP 图片发送设计

日期：2026-08-17  
状态：draft  
相关：`docs/superpowers/specs/2026-08-15-acp-host-cursor-design.md`

## 问题

Composer 已允许给 Cursor ACP 线程贴 jpeg/png/gif/webp，用户消息预览也会记下图，但图没有进入 `session/prompt`。

1. **首条**：`threadRuntimeCoordinator` 的 ACP `start` 只把 `prompt` 传给 `startAcpThreadRun`，丢掉 `attachments`。Driver 固定发送 `[{ type: "text", text }]`。
2. **后续**：`resolveAcpFollowUpEnqueuePlan` 在有附件时返回 `reject_attachments`，文案为「Cursor ACP 暂不支持带图后续消息。」`force_queue` 路径用 `!forceQueue && attachments` 写库，即使去掉拒绝也会把图扔掉。
3. **轮次中插入** 仍不支持（ACP 无 steer / escalate）。本次不改。

ACP 标准图块为 `{ type: "image", mimeType, data }`（base64）。Cursor `agent acp` initialize 声明 `promptCapabilities.image: true`。

## 真机依据（本机，2026-08-17）

对 `/Users/plus/.local/bin/agent`（`2026.08.11-e8db854`）实测：

- initialize：`promptCapabilities: { audio: false, embeddedContext: false, image: true }`
- `session/prompt` 发送 text + `{ type: "image", mimeType: "image/png", data: <1×1 PNG> }`
- 未拒收，`stopReason: "end_turn"`
- 模型回复含 `IMAGE_OK`（尺寸描述不准，只证明协议收图，不证明视觉一定准）

官方 ACP 文档示例只有文本；`cursor/generate_image` 是 Agent → 宿主的生成图通知，与用户往 prompt 塞图无关。

## 目标（MVP）

1. 首条带图：attachments 进入 Cursor ACP `session/prompt`。
2. 排队后续带图：本轮结束后 drain 再发，图不丢。
3. 纯图消息：与其它核心一样补默认看图文案，不要求必须有文字。
4. 能力或附件不合法、Cursor 拒收：明确失败，不改成纯文本重试。

## 非目标（MVP）

- 轮次中插入 / escalate / steer 带图。
- 音频、`embeddedContext`、`resource` / `resource_link`。
- 落盘再发 `file://` uri。
- 把图片能力写进 `ACP_CORE_CAPABILITIES` 或 `hostUiFeatures`。
- 为 Cursor 模型做 Eco `supportsImageInput` 目录判断（Cursor 不走 Eco provider）。
- CI 必跑真机 `agent acp`。
- 单独改移动端协议；移动端走同一 Desktop IPC。

## 方案

内联 ACP ImageContent（方案 1）。Eco `PromptImageAttachment` 已是 `{ mediaType, data }`，直接编成 ACP 图块。

```text
Composer 附件
    → IPC PromptImageAttachment[]
    → 首条 startAcpThreadRun / 后续 drain continuation
    → AcpAgentDriver.run({ prompt, attachments })
    → handshake 读 promptCapabilities.image
    → buildAcpPromptBlocks(...)
    → session/prompt
```

## 数据模型

### Runtime 附件

Driver 输入增加可选 `attachments`，形状与 Desktop `PromptImageAttachment` 相同，不从 Desktop 反依赖：

```ts
type AcpPromptImageAttachment = {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string; // base64，无 data: 前缀
};
```

`AcpAgentRunInput.attachments?: readonly AcpPromptImageAttachment[]`

### Prompt 组块

纯函数 `buildAcpPromptBlocks`（新建 `packages/runtime/src/acp-prompt.ts`）：

输入：`{ prompt: string; attachments?: readonly AcpPromptImageAttachment[]; imageSupported: boolean }`

输出：ACP `ContentBlock[]`。

规则（按顺序执行）：

1. 规范化：`text = prompt.trim()`；附件按输入顺序保留，不做路径去重。
2. 无附件：返回 `[{ type: "text", text }]`。若 `text` 为空，抛错 `ACP prompt is empty`（Desktop 应在更早拦掉；Driver 不发空 prompt）。
3. 有附件且 `imageSupported !== true`：抛错，中文：`Cursor ACP 未声明图片输入能力，无法发送附件。` 不调用 `session/prompt`。
4. 有附件：每个附件必须 `data.trim()` 非空，且 `mediaType` 为 jpeg/png/gif/webp 之一。否则抛错：`ACP 图片附件无效：缺少 data 或 mimeType 不受支持。`
5. 有附件且 `text` 为空：使用默认文案 `请查看并分析我附上的图片。`（与 Desktop `app.imagePrompt` / 现有硬编码一致）。
6. 结果：`[{ type: "text", text: 最终文案 }, ...images]`。图块为：

```ts
{ type: "image", mimeType: attachment.mediaType, data: attachment.data.trim() }
```

字段名是 `mimeType`（camelCase），与 ACP TS SDK 及本机实测一致，不用 `mime_type`。

不发空 text block。不把图改写成 markdown / 占位句。不按路径去重（Eco 附件是内存 base64，不是路径）。

### 能力读取

`imageSupported` 仅当 initialize 结果满足：

```ts
agentCapabilities.promptCapabilities.image === true
```

`promptCapabilities` 缺失、非对象、`image` 为 `false` / `undefined` / 其它值，一律视为不支持。Driver 在 `client.initialize()` 的返回值上计算，不缓存跨进程的旧握手。

## 数据流

### 首条

1. `threadStart` 已把 `payload.attachments` 传给 `threadRuntimeCoordinator.start`。
2. ACP adapter 改为把 `input.attachments` 传给 `startAcpThreadRun`。
3. `AcpThreadStartRunInput` 与 `AcpAgentRunInput` 增加 `attachments?`。
4. Driver 组块后发 `session/prompt`。

用户气泡预览继续走现有 `recordUserPrompt`；本次不改 Feed 存图。

### 排队后续

1. 删除 `reject_attachments` 与 `assertAcpFollowUpTextOnly`。
2. `resolveAcpFollowUpEnqueuePlan`：`coreKind === "acp"` 一律 `force_queue`（有无附件都一样）。其它核心仍 `default`。
3. `threadFollowUpEnqueue`：有 attachments 就写入，**包括** `force_queue`。去掉 `!forceQueue && attachments` 条件。
4. `threadFollowUpUpdate`：去掉 `assertAcpFollowUpTextOnly`，允许把排队消息改成带图。
5. `startAcpThreadContinuation`：去掉 text-only 断言；允许 `prompt` 为空但有 attachments（与 Claude/Pi 一样，缺文案时用默认看图句）。无文案且无附件仍报 `Message is required.`
6. Drain 已调用 `collectThreadFollowUpAttachments`；只要排队行上有 attachments，就会进 continuation。

`shouldForceQueuedFollowUp("acp") === true` 不变。escalate 仍抛 `ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED`。

### 纯图默认文案的两层

| 层 | 职责 |
|---|---|
| Desktop IPC / continuation | 与其它核心对齐：空 prompt + 有图 → `请查看并分析我附上的图片。` |
| `buildAcpPromptBlocks` | 最后兜底：空 text + 有合法附件 → 同一句。不是掩盖缺口，是避免只发 image、不发 text。 |

## 错误处理

| 情况 | 行为 |
|---|---|
| 无附件 | 只发 text，与现在相同 |
| 有附件且 `image === true` | text + image blocks |
| 有附件且未声明 image | 本轮 `run.terminal` failed，上述中文错误；不发 prompt；Feed 预览保留 |
| 附件缺 data / mime 非法 | 本轮失败，上述无效附件错误；不发 prompt |
| Cursor `session/prompt` 拒收图块 | 把 RPC `error.message` 抬到 terminal failed，不降级纯文本重试 |
| 排队后续带图 | 与纯文本一样排队，本轮结束后发送 |
| escalate / 轮次中插入 | 仍拒绝，文案不变 |

新增 IPC 错误进 i18n（zh/en 成对，`expectedIpcErrorKey` 映射）：

- `Cursor ACP 未声明图片输入能力，无法发送附件。` → `native.acpImageCapabilityMissing`
- `ACP 图片附件无效：缺少 data 或 mimeType 不受支持。` → `native.acpImageAttachmentInvalid`

删除：

- 常量 `ACP_FOLLOW_UP_ATTACHMENTS_UNSUPPORTED`
- 文案 key `native.acpFollowUpAttachmentsUnsupported`
- `AcpFollowUpEnqueuePlan` 的 `reject_attachments`
- `assertAcpFollowUpTextOnly`

不把「声明了 image」写成「视觉已验证」。尺寸/内容识别不准不是本功能失败条件。

## UI

Composer 贴图入口不按 `coreKind === "acp"` 关闭（现在也没关）。本次不改 Plus 菜单 / 粘贴。

去掉后续带图的拒绝后，ACP 线程在运行中贴图会进入排队面板，而不是 toast 拒绝。排队预览继续用现有 `formatThreadFollowUpPreview` 的「N image(s)」。

## 测试

1. `buildAcpPromptBlocks`：纯文本；text+多图顺序；纯图补默认文案；`imageSupported false` 抛能力错误；空 data / 非法 mime 抛附件错误；空 prompt 且无附件抛 empty。
2. `AcpAgentDriver` mock stdio：有附件时 `session/prompt.prompt` 含 image blocks；`image: false` 的 initialize 不发 prompt 且 terminal failed。
3. Desktop follow-up：ACP + 附件 → `force_queue`（不再 `reject_attachments`）；enqueue 在 force_queue 下仍持久化 attachments。
4. `assertAcpFollowUpEscalateAllowed` 仍对 ACP 抛错。
5. i18n：删除旧 attachments-unsupported 测例；为两条新错误补 en-US 无汉字断言。
6. 真机冒烟：验收清单，非 CI。本机已验证协议收图。

## 预期改动落点

- `packages/runtime/src/acp-prompt.ts`（新）+ 测试
- `packages/runtime/src/acp-agent-driver.ts`：attachments、握手能力、组块
- `packages/runtime/test/acp-agent-driver.test.ts`
- `apps/desktop/src/main/acp-runtime-run.ts`：`attachments` 传入 driver
- `apps/desktop/src/main/index.ts`：ACP start 透传附件；continuation / enqueue / update 去掉 text-only
- `apps/desktop/src/shared/thread-follow-up-core.ts` + 测试
- `apps/desktop/src/shared/i18n-catalogs.ts` + 测试

## 已拍板决策

- 范围 **A**：首条 + 排队后续带图；不做轮次中插入。
- 编码 **方案 1**：内联 `{ type: "image", mimeType, data }`，不落盘。
- 能力门禁：`image === true` 才发图；否则明确失败。
- 失败不降级纯文本。
- 本机 Cursor CLI 已接受该图块形状。
