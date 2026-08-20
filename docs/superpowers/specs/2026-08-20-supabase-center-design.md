# Supabase Center 设计

**Status:** accepted  
**Date:** 2026-08-20  
**Branch:** `feat/supabase-center`（自 `beta`）

## 背景

现有 Center Server（Bun + MongoDB + Redis）负责账号、设备、配对、Presence 与 Mobile↔Desktop RPC 路由。产品希望：

1. 用户自建 Supabase（Free/Pro/自托管）即可使用，开源工具不提供官方托管节点（运营资质）。
2. 同一 Supabase 项目多用户；配置与密钥按账号同步。
3. Mobile 经 Supabase Realtime 与 Desktop 长连遥控。

本分支 **只做 Supabase**，不与旧 Center Server 双栈并存。

## 目标

1. Desktop / Mobile 自填 `supabaseUrl` + `anonKey`，email/password 注册登录（开放 signUp）。
2. 设备登记、配对、Presence、`eco.invoke` / response / `eco.event` 经 Realtime 私有频道。
3. 账号级配置同步：供应商/模型/ASR/生图等元数据 + API Key 密文。
4. 密钥：本地 `vault_key`；新设备须由 **任意一台已同步且在线** 的设备用 6 位码授权，临时加密下发 `vault_key`。无已同步设备在线则无法同步密钥（不做恢复码）。

## 非目标

- 官方预置 Supabase 节点。
- 会话正文 / SQLite 权威数据上云。
- 用 Queues 或 HTTP/2 双向流替代 Realtime 遥控。
- 恢复码 / 离线解密钥。
- 保留或兼容旧 `/v1/*` Center Server 客户端路径（本分支删除/替换，不双栈）。

## 多租户与配置归属

```text
一个 Supabase 项目
  └─ user A (auth.uid) ── 配置 + 密文 + devices/bindings
  └─ user B (auth.uid) ── 互不可见（RLS）
        └─ Desktop / Mobile 同账号共享配置
```

## 客户端配置

| 字段 | 说明 |
|---|---|
| `supabaseUrl` | Project URL（Cloud 或自托管网关） |
| `anonKey` | 公开 anon key（禁止下发 service_role） |

登录后本地再存 session、`deviceId`、`deviceSecret`、`vault_key`（Keychain）。

## 鉴权分层

1. 项目入口：URL + anon  
2. 用户：Supabase Auth JWT  
3. 设备：`devices` 行 + `deviceSecret`（登记/注销）  
4. 频道：Realtime `private` + `realtime.messages` RLS  
5. 命令：Desktop 收包后再验 `remote-command-registry`  
6. 密钥：`vault_key` 仅在已同步设备；新设备经 vault claim

## Realtime 交互

- Presence：`eco:user:{userId}`  
- RPC：`eco:bind:{bindingId}`（同一绑定两端进同一私有房间）  
- 运输层复用 shared JSON-RPC（`eco.ping` / `eco.invoke` / `eco.event`）  
- pending / 超时在客户端（无服务端 Redis bus）

## Vault 动态授权

1. 首台设备：生成 `vault_key`，加密 API Key 上传。  
2. 新设备 Auth 登录后发起 `vault_claim`。  
3. **任意**已持有 `vault_key` 且在线的设备可批准：显示 6 位码，新设备输入。  
4. 6 位仅绑定短 TTL claim；`vault_key` 用短时会话密钥（ECDH 等）加密下发后销毁临时材料。  
5. 无已同步设备在线 → 无法同步密钥（只能新机手填 Key，或等设备上线再授权）。

## 数据表（概要）

- `profiles` — `id → auth.users`  
- `devices` — kind、name、secret_hash、metadata、disabled  
- `device_bindings` — desktop/mobile、capabilities  
- `pairing_sessions` — code_hash、TTL、claimed  
- `vault_claims` — 短 TTL、code_hash、状态  
- `user_settings` — 非机密 JSON（供应商元数据、模型、ASR、生图等）  
- `user_secrets` — 密文字段（nonce + ciphertext），无明文 Key  
- `audit_logs` — 可选元数据  

配对 / 验 device secret / 写 secret_hash：Edge Functions + service role；客户端不持有 service_role。

## 落地顺序

1. `supabase/migrations` + RLS + Realtime 策略  
2. Desktop：连接设置、Auth、设备登记  
3. Realtime：Presence + ping + 一条 invoke  
4. 配对与 Mobile 对齐  
5. 配置同步 + vault claim  
6. 移除本分支内旧 Center Server 客户端依赖；文档改为 Supabase  

## 已知缺口

- Realtime 投递语义弱于原 Redis bus；弱网超时/重试在客户端重做。  
- Free 项目闲置暂停由用户自理。  
- 无已同步设备在线时密钥不可同步（产品接受）。
