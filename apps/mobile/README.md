# Eco Mobile

Flutter Android 远程客户端，通过 Center Server 操控已绑定的 Eco Desktop。

## 功能

- 账号注册/登录，注册 `mobile` 设备
- 扫码或手输配对码绑定 PC
- 会话列表、新建/继续对话、图片附件
- 实时事件流（`eco.event`）
- Plan / Bash / Clarification 审批
- Plan Mode、Bash Review、Agent Profile 运行时配置
- Workflow 全局 Plan Mode 开关

## 前置条件

1. 启动 Center Server（见 [`../server/README.md`](../server/README.md)）
2. Redis 运行在 `127.0.0.1:6379`
3. Eco Desktop 已连接同一 Center Server，并生成配对码
4. 真机调试时，Server 需监听局域网地址，例如：

```sh
ECO_SERVER_HOST=0.0.0.0 ECO_SERVER_TOKEN_SECRET="your-secret-at-least-32-chars" bun run dev:server
```

## Android 真机调试

开发与正式版使用不同包名，可**同时安装**在同一台手机上：

| Flavor | 包名 | 桌面显示名 |
|--------|------|------------|
| `prod` | `com.eco.eco_mobile` | Eco Mobile |
| `dev` | `com.eco.eco_mobile.dev` | Eco Mobile Dev |

1. 手机与 PC 处于同一 Wi‑Fi
2. 在 App「PC」页填写 `http://<电脑局域网IP>:3128`
3. `dev` flavor 已启用 `usesCleartextTraffic`（支持本地 HTTP）
4. 运行开发版（不影响已安装的正式版）：

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
  ├─ HTTP  /v1/auth/*, /v1/devices/*, /v1/pairing/claim, /v1/bindings, /v1/presence
  └─ WS    /v1/rpc  → eco.invoke / eco.event
         ↓
Center Server  →  Eco Desktop (IPC)
```

执行仍在 Desktop 本地完成；Mobile 只做远程操控。

## 测试

```sh
cd apps/mobile
flutter test
```
