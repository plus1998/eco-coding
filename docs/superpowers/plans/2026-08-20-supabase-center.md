# Supabase Center 实施计划

**Goal:** 用 Supabase 替换 Center Server（本分支不双栈）：Auth、设备/配对、Realtime 遥控、账号级配置与密钥同步。  
**Branch:** `feat/supabase-center`  
**Design:** [2026-08-20-supabase-center-design.md](../specs/2026-08-20-supabase-center-design.md)

## 已完成

- [x] 设计锁定与分支切出
- [x] 核心 migration（profiles / devices / bindings / pairing / vault_claims / settings / secrets / realtime RLS）
- [x] Track A Edge：`device-register` / `device-disable` / `pairing-create` / `pairing-join`
- [x] Track B Shared：realtime topics / envelope / vault-crypto + 单测
- [x] Track C Desktop Auth + 设备登记（`supabaseUrl` + `anonKey`）
- [x] Track D Desktop Realtime RPC（`eco:bind:*` ping/invoke + Presence）
- [x] Track E Desktop vault claim + `user_settings` / `user_secrets` 同步（UI + IPC）
- [x] Track F Mobile foundation（URL+anon+Auth+配对+Realtime bind）
- [x] 删除 `apps/server`；自托管/Cloud 部署文档与 `eco-supabase` Skill
- [x] 本地自托管冒烟 + `packages/shared/test/supabase-selfhost.integration.test.ts`

## 已知残余（非半成品阻塞，但需知晓）

- Mobile 端 Vault 批准/请求 UI 尚未对等 Desktop（Desktop 已可作批准端与请求端）
- Desktop `publish` 事件节流未完全移植 legacy projection throttle
- `center-server-store` sqlite 单测在无 `node:sqlite` 的 bun 环境下 skip（Electron 运行时有 sqlite）
- 双 Desktop 真机 vault claim 端到端需人工点一次（单元/模块测已覆盖 crypto + API 形状）

## 并行工作流（按目录隔离，避免冲突）

### Track A — Edge Functions（`supabase/functions/`）

- `device-register`：验用户 JWT，写 `devices.secret_hash`，返回一次性 `deviceSecret`
- `device-disable` / token 相关（如需）
- `pairing-create` / `pairing-join`（或 claim）：写 `pairing_sessions` + `device_bindings`
- 不在客户端暴露 `service_role`

**完成标准：** 本地/文档中可用 curl 或函数调用说明；secret_hash 不回传客户端。

### Track B — Shared 协议与加密（`packages/shared` 或新建 `packages/supabase-center`）

- Realtime envelope ↔ 现有 `EcoJsonRpcMessage`
- 频道名约定：`eco:user:{id}` / `eco:bind:{id}` / `eco:vault:{id}`
- Vault：6 位码生成/校验辅助、短时包装 `vault_key` 的接口（实现可用 WebCrypto；不落明文 Key）
- 纯函数 + 单测

**完成标准：** 单测覆盖频道解析、envelope 往返、vault wrap/unwrap 形状。

### Track C — Desktop 连接面（`apps/desktop` center-server → supabase）

- 设置：`supabaseUrl` + `anonKey`（替换仅 `serverUrl`）
- Auth signUp/signIn/refresh；设备登记调 Edge
- 本地安全存储 session / deviceSecret / vault_key
- UI：`CenterServerSettingsPanel` 文案与字段改为 Supabase（可暂留组件名，避免大范围改名）
- **本 track 不接完整 RPC**（只做到登录+登记+连接状态）

**完成标准：** 填自建项目 URL+anon 可注册登录并登记 desktop 设备。

### Track D — Desktop Realtime RPC（`apps/desktop` main：event-center / 新 supabase-rpc）

- Presence + `eco:bind:*` private Broadcast
- ping → 一条只读 invoke 通路接到现有 remote command
- pending/超时在客户端
- 依赖 Track B 类型；与 Track C 约定同一 supabase client 单例入口

**完成标准：** 两客户端（或测试双 peer）能 ping；Desktop 能执行一条白名单 invoke。

### Track E — Vault claim + 配置同步（Desktop 优先）

- `user_settings` 上下行（供应商/模型/ASR/生图元数据）
- `user_secrets` 密文读写
- vault claim：先向服务器挂请求（对方不必立刻在线）；已同步设备打开后批准，6 位码临时下发 `vault_key`
- 无已同步设备在线 → 明确失败，不提供恢复码

**完成标准：** 同账号第二台 Desktop 经授权后能解密同步的 Key。

### Track F — Mobile（`apps/mobile`）

- 同样 URL+anon+Auth
- 配对扫码 payload 含 supabaseUrl/anonKey
- Realtime 进 binding 房间；调用现有桌面命令
- Vault：作为可批准端或请求端（至少一端可用）

**完成标准：** Mobile 登录配对后能对 Desktop ping / 基础列表类 invoke。

## 串行收尾（并行结束后）

1. ~~删除/停用本分支内旧 Center Server~~ **已删除 `apps/server`**；部署文档见 `docs/supabase-deploy.md`
2. 文档与 Agent Skill（`eco-supabase`）指导初次/增量部署
3. 集成冒烟：Auth → 配对 → ping → settings 同步 → vault claim

## 约束

- 禁止把 `service_role` 打进 Desktop/Mobile
- API Key 仅密文上云；`vault_key` 仅本地 + claim 短时通道
- 无官方节点；开放 signUp
- 子代理按 track 改各自目录，共享契约以 design + Track B 为准
