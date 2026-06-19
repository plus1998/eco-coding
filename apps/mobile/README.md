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

1. 手机与 PC 处于同一 Wi‑Fi
2. 在 App「PC」页填写 `http://<电脑局域网IP>:3128`
3. Debug 构建已启用 `usesCleartextTraffic`（仅 debug）
4. 运行：

```sh
cd apps/mobile
flutter pub get
flutter devices
flutter run -d <android-device-id>
```

或从仓库根目录：

```sh
bun run dev:mobile
```

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
