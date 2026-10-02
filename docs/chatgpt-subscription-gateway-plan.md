# Eco Coding 接入 ChatGPT 订阅额度计划

> 实施状态（2026-10-02）：Phase 0、Phase 1、Phase 2 已完成；Provider 预设、账号管理页、Gateway 凭据解析、内置 OAuth 窗口、全局 HTTP/HTTPS/SOCKS 代理和账号级代理已接入。OAuth 模型目录会在授权后自动同步到 Agent 模型候选，并注册内置“ChatGPT 订阅”Agent 配置，不再要求手动创建服务商。真实 OAuth 和 OpenAI 上游验收仍需要用户在本机完成授权。

## 1. 目标与边界

目标是把 ChatGPT 订阅授权接入 Eco Coding 的本地客户端。三个 Agent 只认 Eco Provider `eco-coding-chatgpt`，由本地 Eco Gateway 统一负责与 OpenAI 服务器通信。

目标链路：

```text
Agent 1/2/3
    │ providerId = eco-coding-chatgpt
    ▼
本地 Eco Gateway
    │ 账号池、OAuth token、刷新、切换、请求约束
    ▼
https://api.openai.com/v1/responses
    │ Authorization: Bearer <OAuth access token>
    ▼
ChatGPT 订阅共享额度
```

本计划明确排除以下方向：

- 不复用内置 `openai` provider。内置 `openai` 仍属于 Codex `auth.json` 路径，本方案新增独立的 `eco-coding-chatgpt` provider。
- 不让 Agent 直接访问 OpenAI，也不把 OAuth token 注入 Agent。
- 不建设集中式云网关。所有授权、token、账号池和请求转发都留在用户本机。
- 不依赖 `chatgpt.com/backend-api` 作为正式调用或额度接口。
- 不承诺展示官方没有提供的“精确剩余额度”。客户端展示可观测状态、最近错误、请求统计和官方 Usage 入口。

## 2. 可行性结论

方案可行，但必须按 OpenAI Sign in with ChatGPT（SIWC）和 Token Sharing 的约束实现。

官方文档确认：

- 符合条件的开源、本地应用可以通过 OAuth 获取 ChatGPT 订阅共享资格，并使用 Responses API。
- Responses 请求使用 OAuth access token 调用 `POST https://api.openai.com/v1/responses`。
- 访问 token 有效期约 1 小时；refresh token 有效期约 30 天，并且刷新时会轮换，必须原子保存新 refresh token。
- ChatGPT Plus 的使用额度在 ChatGPT 与接入应用之间共享，不会为每个 Agent 或每个本地客户端生成独立额度。
- 官方没有为本地应用提供可依赖的实时剩余额度推送接口，因此只能做状态和历史统计，不能伪造精确余额。

官方依据：

- [Token Sharing for Open-Source Projects](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registering Your App and Signing Users In](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Profiles and Sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Token Reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Models and Inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Errors and Recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Preview Limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## 3. 现有代码基线与缺口

当前代码以静态 API key 为中心，不能直接承载 SIWC 账号池：

- Gateway Provider 要求静态 `apiKey`：[`apps/gateway/src/types.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/gateway/src/types.ts:5)。
- Responses 转发层直接拼接 `Authorization: Bearer ${providerApiKey}`：[`apps/gateway/src/upstream/responses-passthrough.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/gateway/src/upstream/responses-passthrough.ts:34)，并在后续逻辑中使用静态 key：[`apps/gateway/src/upstream/responses-passthrough.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/gateway/src/upstream/responses-passthrough.ts:216)。
- Desktop Gateway 生命周期把 Provider 的 `apiKey` 注入 Gateway：[`apps/desktop/src/main/eco-gateway-lifecycle.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/eco-gateway-lifecycle.ts:380)、[`apps/desktop/src/main/eco-gateway-lifecycle.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/eco-gateway-lifecycle.ts:422)。
- Codex runtime 对 `openai` 有单独的内置认证分支：[`apps/desktop/src/main/codex-runtime-run.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/codex-runtime-run.ts:1078)。这条路径不参与本方案。
- 现有 `openai-account-service` 管理的是 Codex `auth.json` 账号：[`apps/desktop/src/main/openai-account-service.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/openai-account-service.ts:12)，不能直接当作 SIWC 账号池。
- Provider SQLite 配置包含明文 `api_key`：[`apps/desktop/src/main/provider-store.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/main/provider-store.ts:123)。SIWC refresh token 不应放入该表。
- Provider IPC 的 `authMethod` 目前只有 `api_key | oauth | auth_json`：[`apps/desktop/src/shared/ipc.ts`](/Users/plus/Desktop/workspace/ai/eco-coding/apps/desktop/src/shared/ipc.ts:1223)，需要增加独立认证类型或独立系统 Provider 配置。

## 4. 目标架构

### 4.1 组件职责

| 组件 | 职责 |
| --- | --- |
| Agent | 仅发送标准请求给 Eco Gateway；不知道 OAuth token 和账号池 |
| `eco-coding-chatgpt` Provider | 表达“使用 ChatGPT 订阅”的 Eco Provider 身份和能力约束 |
| Eco Gateway | 账号选择、token 刷新、请求转发、Responses 流处理、错误分类和重试边界 |
| SIWC Account Store | 保存多个独立 ChatGPT 授权档案及加密 token |
| Account Pool Manager | 按状态和策略选择账号，维护冷却、失败和最近使用信息 |
| Desktop UI/IPC | 登录、重新授权、注销、启用/禁用账号、查看状态和统计 |

### 4.2 数据流

1. 用户在本地 UI 点击“添加 ChatGPT 账号”。
2. Desktop 生成一次性 `state`、`nonce`、PKCE 参数和稳定的 `ext_agent_host_id`。
3. 首次授权使用 `dynamic_agent_client` 注册；保存 OpenAI 返回的 `client_id`，后续授权复用它。
4. 通过 `127.0.0.1` loopback 回调接收授权码，交换 access token、refresh token 和 ID token。
5. Gateway 收到 Agent 请求后，从账号池选择一个可用账号。
6. Gateway 在锁内刷新即将过期的 access token，然后向 `/v1/responses` 发起符合限制的请求。
7. 流结束时处理 `response.completed`；如果收到 `response.failed`，按错误码记录失败，不在已经输出内容后切换账号重放。

## 5. SIWC OAuth 实现计划

### 5.1 客户端身份和主机标识

- 使用 OpenAI 文档要求的 `dynamic_agent_client` 完成首次客户端注册。
- 将返回的 `client_id` 保存到本机应用配置；不得把 client secret 当作可长期保存的安全凭据，因为该流程按公开客户端设计。
- 为 Eco Coding 生成并持久化稳定的 `ext_agent_host_id`，同一安装实例保持不变。
- OAuth 请求使用 PKCE、`state` 和 `nonce`；回调只绑定 `127.0.0.1`，避免监听外部网卡。
- 请求最小必要 scopes：`openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`。

### 5.2 Token 校验和刷新

- 授权码交换后验证 ID token 的签名、`iss`、`aud`、`exp`、`nonce` 和必要 claims。
- 保存授予的 scope，并在每次调用前确认包含 Responses 所需 scope。
- access token 过期前刷新；刷新请求串行化，同一账号不能并发刷新。
- 刷新成功后必须原子替换 access token、过期时间和旋转后的 refresh token，防止并发请求覆盖新 token。
- refresh token 无效或被撤销时，将账号置为 `reauthorization_required`，只提示重新授权，不无限重试。
- 注销账号时调用官方撤销流程（如果当前文档支持对应 endpoint），随后删除本地密钥和非必要用户资料。

代理行为：OAuth 授权页使用 Electron 内置 BrowserWindow 打开，不再调用系统默认浏览器；每个 ChatGPT 账号可配置独立代理，授权页、授权码交换、刷新、撤销以及该账号的 Gateway 上游请求都使用账号代理。账号未配置时继承“设置 → 代理”的全局出站代理。HTTP/HTTPS 代理直接交给 Chromium/undici，SOCKS5 通过本地 HTTP CONNECT bridge 接入。

### 5.3 账号数据模型

建议新增独立的本地 SIWC 存储，不复用 `provider_configs.api_key`：

```ts
type ChatGptSubscriptionAccount = {
  accountId: string;
  displayName?: string;
  subject?: string;             // ID token 的 sub，用于区分账号
  email?: string;
  clientId: string;
  extAgentHostId: string;
  scopes: string[];
  accessToken: string;           // OS secure storage
  refreshToken: string;          // OS secure storage
  accessTokenExpiresAt: number;
  status:
    | 'needs_login'
    | 'ready'
    | 'refreshing'
    | 'rate_limited'
    | 'temporarily_unavailable'
    | 'reauthorization_required'
    | 'disabled';
  cooldownUntil?: number;
  lastUsedAt?: number;
  lastSuccessAt?: number;
  lastErrorCode?: string;
  lastErrorAt?: number;
  createdAt: number;
  updatedAt: number;
};
```

安全要求：

- refresh token、access token、ID token 优先放系统 Keychain/Secret Service/Windows Credential Manager 等安全存储；数据库只保存引用和非敏感元数据。
- 日志、错误上报、崩溃转储、诊断导出不得包含 token、授权码或完整 Authorization header。
- 修改账号状态和 token 时使用原子写入；应用异常退出后不能留下半写入 refresh token。
- 迁移和备份流程默认不导出密钥；用户主动导出时必须明确提示风险。

## 6. 新增 Eco Provider

### 6.1 Provider 契约

新增固定 Provider ID：`eco-coding-chatgpt`。

建议配置形态：

```ts
{
  id: 'eco-coding-chatgpt',
  authMethod: 'chatgpt_subscription',
  gatewayMode: 'local',
  credentialPoolId: 'chatgpt-default',
  baseUrl: 'http://127.0.0.1:<local-gateway-port>'
}
```

- `authMethod` 新增 `chatgpt_subscription`，不要把它伪装成普通 `oauth` 或静态 `api_key`。
- Provider 配置只保存 `credentialPoolId` 和非敏感路由信息；不保存 refresh token。
- 三个 Agent 的角色配置统一引用 `eco-coding-chatgpt`。
- Provider 的模型列表和能力声明必须来自 Gateway 的 ChatGPT 订阅适配层，避免 Agent 误用不支持的参数。

### 6.2 Gateway 适配层

将当前 `providerApiKey` 解析逻辑抽象为凭据解析器：

```ts
type UpstreamCredential = {
  authorization: string;
  accountId: string;
  expiresAt: number;
};

interface CredentialResolver {
  resolve(providerId: string, request: Request): Promise<UpstreamCredential>;
  reportResult(accountId: string, result: UpstreamResult): Promise<void>;
}
```

对 `eco-coding-chatgpt`：

1. 从 `credentialPoolId` 取候选账号。
2. 跳过禁用、需要重新授权和冷却中的账号。
3. 刷新临近过期的 token。
4. 生成 `Authorization: Bearer <access_token>`。
5. 只向 OpenAI 的 `/v1/responses` 发起请求。
6. 为每个请求记录 `requestId`、账号 ID、模型、开始时间、完成状态、错误码和输入/输出 token（若官方返回），不记录完整 prompt。

### 6.3 Responses 请求约束

ChatGPT 订阅共享预览要求在适配层强制执行：

- `store: false`
- `stream: true`
- `input` 使用数组格式
- 不发送 `previous_response_id`
- 不发送官方列出的暂不支持字段，例如 `background`、`conversation`、`max_output_tokens`、`metadata`、`temperature`、`top_p`、`truncation`、`user` 等
- 不使用 hosted image generation、file search、code interpreter、computer use、hosted MCP/connectors、Responses `tool_search` 等不支持能力
- Eco 本地工具和 function/custom tools 只有在请求格式及模型能力允许时才透传

建议默认策略是“严格拒绝并返回可读错误”，不要静默删除用户字段后继续执行，以免 Agent 误以为参数已生效。若产品确认需要兼容，可在独立的请求规范化层提供明确的降级日志。

## 7. 多账号管理和自动切换

### 7.1 选择策略

- 只从 `ready` 且不在冷却期的账号中选择。
- 默认使用加权轮询：优先最近成功、失败少、冷却结束的账号。
- 单个 Agent 请求绑定一个账号直到响应结束；不能在流式输出中途切换。
- 只有在请求尚未向上游发送，或明确收到可安全重试的 admission 错误时，才允许换账号重新发送。
- 使用幂等请求 ID 和内部重试上限，避免重复扣除或重复执行本地工具。

### 7.2 错误到账号状态的映射

| 错误 | 账号处理 | 请求处理 |
| --- | --- | --- |
| 401 / `invalid_user` | 标记 `reauthorization_required` | 停止该账号重试，提示重新授权 |
| 403 / `subscription_sharing_user_not_eligible` | 标记不可用或 `disabled` | 不进入无限授权循环 |
| 403 route not supported | 保持账号可用 | 修正路由/能力，不切换账号掩盖请求错误 |
| 429 / `subscription_sharing_usage_limit_exceeded` | 进入 `rate_limited`，按文档不推断具体重置时间 | 新请求可尝试其他可用账号；向用户显示该账号受限 |
| 503 / `subscription_sharing_usage_unavailable` | 短暂冷却并指数退避 | 仅有限次重试，不把暂时不可用误判为额度耗尽 |
| 400 unsupported capability | 不改变账号状态 | 返回字段或能力不支持错误 |
| 网络超时/连接失败 | 短暂冷却并记录 | 仅在未产生上游输出且请求可安全重试时重试 |

### 7.3 额度和状态展示

客户端展示：

- 账号授权状态、最近成功时间、最近错误和冷却状态。
- 本地统计的请求数、成功数、失败数、流量和 token 使用量（以 API 返回为准）。
- 当前账号池可用数和被限流数。
- “查看 ChatGPT Usage”跳转入口。

客户端不展示未经官方接口确认的精确“剩余额度”或倒计时。对于 429，显示“已达到共享使用限制，等待官方恢复或切换其他已授权账号”。

## 8. 模型和能力发现

- Gateway 使用同一 OAuth access token 调用 `GET /v1/models`（若该路径和 scope 对当前预览可用）。
- 模型列表按账号和短 TTL 缓存；不同账号返回差异时取交集或在请求时重新校验。
- Eco Provider 对外暴露的模型必须附带能力元数据：是否支持流式、函数工具、视觉输入和上下文上限。
- 当模型或能力被上游拒绝时，保留原始结构化错误，同时映射成 Agent 可读错误。

## 9. UI、IPC 和配置变更

需要新增的本地能力：

1. “添加 ChatGPT 账号”：启动 OAuth、显示浏览器授权状态、完成回调。
2. “账号列表”：显示邮箱/显示名、状态、最近使用、最近错误和启用开关。
3. “重新授权”：复用已保存 `client_id` 和 `ext_agent_host_id`。
4. “删除账号”：撤销并清理本地 token。
5. “测试账号”：只执行轻量鉴权/能力检查，不发送用户 prompt。
6. “账号池策略”：轮询、失败冷却时长、最大重试次数。
7. “额度与使用”：本地统计和官方 Usage 链接。

IPC 类型建议：

- 将 `ProviderConfigInput.authMethod` 扩展为包含 `chatgpt_subscription`，或为系统 Provider 增加专用配置类型。
- 新增 `chatgptSubscriptionAccounts:list/add/reauthorize/remove/setEnabled`。
- 新增 `chatgptSubscriptionPool:getStatus/updatePolicy`。
- IPC 返回值只包含脱敏元数据，不返回 refresh token 和 access token。

## 10. 测试计划

### 10.1 单元测试

- OAuth state、nonce、PKCE 校验。
- ID token 校验失败场景。
- access token 临期判断和 refresh token 轮换。
- 并发刷新锁、原子保存和崩溃恢复。
- 账号状态机和冷却时间。
- 账号选择、重试边界和错误映射。
- Responses 请求规范化与不支持字段拒绝。

### 10.2 Gateway 集成测试

使用本地 mock upstream 覆盖：

- 正常流式响应和 `response.completed`。
- `response.failed`、401、403、429、503、400。
- 两个账号轮询、一个账号限流后的切换。
- access token 过期时只刷新一次。
- 流已经开始输出后禁止自动切换和重放。
- 三个 Agent 同时请求时账号池和刷新锁不发生竞态。

### 10.3 手工验收

- 使用两个独立 ChatGPT 账号完成授权、注销和重新授权。
- 三个 Agent 都通过 `eco-coding-chatgpt` 发起 `/responses` 请求。
- 关闭并重启桌面端后账号状态和 refresh token 仍可用。
- 在一个账号触发限制后，另一个账号仍可处理新请求。
- 验证日志、诊断包和数据库中不存在明文 token。

## 11. 分阶段实施

### Phase 0：契约冻结

- 固定 Provider ID：`eco-coding-chatgpt`。
- 固定 `chatgpt_subscription` 认证类型和本地 Gateway 路由。
- 固定账号状态机、错误映射和“不在流中切换”原则。
- 明确第一期支持的模型、参数和工具能力。

### Phase 1：OAuth 与账号存储

- 实现动态客户端注册、PKCE loopback 登录、ID token 校验。
- 接入系统安全存储。
- 实现多账号 CRUD、重新授权、注销和 token 刷新。
- 完成 OAuth 和存储单元测试。

### Phase 2：单账号 Gateway

- 将静态 API key 解析重构为凭据解析器。
- 实现一个 SIWC 账号调用 `/v1/responses`。
- 强制 `store:false`、`stream:true` 和能力限制。
- 完成结构化错误和流式终态处理。

### Phase 3：Provider 与三个 Agent

- 注册 `eco-coding-chatgpt` Provider。
- 更新 Agent provider 配置和 Gateway 路由。
- 授权后同步官方模型目录，自动提供内置“ChatGPT 订阅”Agent 配置；用户只需在对话的 Agent 选择器中选择该配置。
- 验证三个 Agent 同时请求、流式输出和本地工具调用。

### Phase 4：账号池和自动切换

- 实现账号选择、冷却、限流状态和有限重试。
- 覆盖 401/403/429/503 场景。
- 增加并发刷新锁和跨 Agent 压力测试。

### Phase 5：状态、统计和运营体验

- 增加账号管理 UI、使用统计和官方 Usage 入口。
- 增加脱敏日志、诊断信息和迁移脚本。
- 补齐升级、卸载和异常退出后的恢复逻辑。

### Phase 6：灰度发布

- 先在开发构建中开放手动启用。
- 观察授权成功率、刷新失败率、429/503 比例和 Gateway 延迟。
- 通过 feature flag 控制默认关闭、单账号启用、多账号启用三个阶段。
- 收集真实兼容性问题后再扩大默认开放范围。

## 12. 完成标准

以下条件全部满足后，才认为方案完成：

- 三个 Agent 的 provider 均为 `eco-coding-chatgpt`，请求全部经过本地 Gateway。
- Gateway 能完成首次 OAuth、重启后刷新和 refresh token 轮换。
- 至少两个 ChatGPT 账号可以独立授权、启用、禁用、重新授权和删除。
- 新请求在账号限流或暂时不可用时能按策略选择其他账号；流式响应开始后不切换。
- `/v1/responses` 请求满足 SIWC 预览限制，unsupported 字段和 hosted tools 有明确错误。
- 401/403/429/503 均能映射到可操作的账号状态，不使用无限重试掩盖问题。
- 日志、数据库、诊断包和 IPC 返回值不泄露 token。
- UI 不虚构官方没有提供的精确剩余额度，使用官方 Usage 链接和本地可观测统计表达状态。
- OAuth、刷新、账号池、Gateway 流式处理和三 Agent 并发集成测试通过。
