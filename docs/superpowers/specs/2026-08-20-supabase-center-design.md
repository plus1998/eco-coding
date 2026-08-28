# Supabase Center 设计

**Status:** accepted（2026-08-25 修订：账号密码优先）  
**Date:** 2026-08-20  
**Branch:** `feat/supabase-center`（自 `beta`）

## 背景

用户自建 Supabase（Cloud / 自托管）即可使用；无官方托管节点。同一项目多租户；Mobile 经 Realtime 遥控 Desktop；账号级配置与 API Key 密文同步。

## 目标（账号密码优先）

1. Desktop / Mobile 自填 `supabaseUrl` + `anonKey`，email/password 注册登录。  
2. PC 登录后登记到 `devices`；Mobile 同账号登录后从 `devices_public` **自动发现**已注册 PC，**不强制配对仪式**。  
3. 手机扫码仅方便连接服务器（`eco://center?supabase=...&anon=...`），**仍须账号密码登录**（扫码本身不授予控制权）。  
4. 选中 PC 时经 Edge `binding-ensure` 建立/恢复 `device_bindings`，再进 Realtime `eco:bind:*`。  
5. 配置同步：`vault_key` 用**登录密码** PBKDF2 封装存 `user_vault_wraps`；新设备再输密码即可解包。不再依赖「另一台设备在线 + 6 位码」作为主路径。

## 非目标

- 官方预置 Supabase 节点。  
- 会话正文 / SQLite 权威数据上云。  
- 恢复码 / 离线解密钥。  
- 兼容旧 Bun Center Server `/v1/*`。

## 鉴权分层

1. 项目入口：URL + anon  
2. 用户：Supabase Auth JWT（账号密码）  
3. 设备：`devices` + `deviceSecret`  
4. Binding：同账号 `binding-ensure`（替代主路径 pairing）  
5. 频道：Realtime private + RLS  
6. 密钥：本地 `vault_key`；云端 `user_vault_wraps`（密码封装）

## 主路径用户旅程

```text
Desktop: 填 URL+anon → 登录 → device-register →（可选）显示连接 QR
Mobile:  扫码/手填 URL+anon → 同账号登录 → device-register
         → 列出同账号 desktop → 选中 → binding-ensure → eco:bind RPC
同步:    首台 push 密钥后用登录密码 wrap → 新设备输同一密码 unlock
```

## Realtime

- Presence：`eco:user:{userId}`  
- RPC：`eco:bind:{bindingId}`（仍依赖 binding 行；去掉的是配对仪式，不是 binding 模型）

## Vault（密码封装）

1. 首台：生成 `vault_key`，加密 API Key 写入 `user_secrets`；用登录密码 wrap 上传 `user_vault_wraps`。  
2. 新设备：输入登录密码 → unwrap → 本地存 key → pull 配置。  
3. **改 Auth 密码后**：旧 wrap 仍对应旧密码；须在已持有 `vault_key` 的设备上用**新密码重新 wrap**（不做恢复码）。  
4. 遗留：`vault_claims` / 6 位码 ECDH 路径保留在服务端与部分 API，主 UI 不再引导。

## 数据表（概要）

- `devices` / `devices_public`  
- `device_bindings`  
- `device_sessions`  
- `user_settings` / `user_secrets`  
- `user_vault_wraps` — 密码封装的 vault_key  
- 遗留：`pairing_sessions`、`vault_claims`（旧客户端 / 未删函数）

## 已知缺口

- Realtime 投递弱于原 Redis bus。  
- Free 项目闲置暂停由用户自理。  
- 首台从未成功 sync / wrap → 其他设备无法靠密码拿密钥。  
- Auth 改密后须手动 re-wrap。  
- Mobile 直读 `user_secrets` 尚未接密码 unwrap（配置多经 Desktop RPC）。  
- RPC 仍须选中 PC + binding；未选 PC 不能遥控。
