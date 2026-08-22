# Eco Mobile

Flutter 远程客户端，通过用户自建的 **Supabase Center** 操控已绑定的 Eco Desktop。

## 功能

- 账号注册/登录，注册 `mobile` 设备
- 扫码或手输配对码绑定 PC
- 会话列表、新建/继续对话、图片附件
- 实时事件流（`eco.event`）
- Plan / Bash / Clarification 审批
- Plan Mode、Bash Review、Agent Profile 运行时配置
- Workflow 全局 Plan Mode 开关

## 前置条件

1. 按 [docs/supabase-deploy.md](../../docs/supabase-deploy.md)（Cloud）或 [docs/supabase-self-host.md](../../docs/supabase-self-host.md)（自托管）部署自己的 Supabase
2. Eco Desktop 已填写同一项目的 **Project URL + anon key**，并完成登录与设备登记
3. Desktop 生成配对码后，Mobile 扫码或手输（QR 可携带 supabaseUrl / anonKey）

本地开发可用：

```sh
npx supabase start
npx supabase functions serve
```

用 `npx supabase status` 查看本地 URL / anon，填入 Desktop 与 Mobile。

## Android 真机调试

开发与正式版使用不同包名，可**同时安装**在同一台手机上：

| Flavor | 包名 | 桌面显示名 |
|--------|------|------------|
| `prod` | `com.eco.eco_mobile` | Eco Mobile |
| `dev` | `com.eco.eco_mobile.dev` | Eco Mobile Dev |

1. 手机可访问你的 Supabase 项目（Cloud 或可达的自托管 URL）
2. 在 App 中填写 Project URL 与 anon key（或扫码带入）
3. 运行开发版：

```sh
cd apps/mobile
flutter pub get
flutter devices
flutter run --flavor dev -d <android-device-id>
```

或从仓库根目录：

```sh
bun run dev:mobile
```

正式版 Release 构建：

```sh
bun run build:apk
# 或 flutter build apk --flavor prod
```

## iOS 真机调试

iOS 开发版 Bundle ID 为 `com.plus.ecoding.dev`（显示名 Eco Mobile Dev），与正式版 `com.plus.ecoding` 可并存。

```sh
cd apps/mobile
flutter run --flavor dev -d <ios-device-id>
```

首次在真机安装 `dev` 版前，需在 Apple Developer / Xcode 中为 `com.plus.ecoding.dev` 配置签名。

## 架构

```
Mobile App
  ├─ Supabase Auth + Edge (device-register, pairing-*)
  └─ Realtime private channels  → eco.invoke / eco.event
         ↓
Supabase  →  Eco Desktop (local execution)
```

执行仍在 Desktop 本地完成；Mobile 只做远程操控。

## 测试

```sh
cd apps/mobile
flutter test
```
