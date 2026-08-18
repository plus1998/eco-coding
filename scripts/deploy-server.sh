#!/usr/bin/env bash
set -euo pipefail

# 部署 Eco Server 到 Linux 服务器
# 默认：交叉编译 amd64 二进制 → 上传 → systemd 安装/重启 → 使用 .env 里的 Mongo/Redis

SERVER=""
SSH_PORT="22"
REMOTE_DIR="/opt/eco/server"

DOCKER=false
WITH_DEPS=false
REBUILD=false
DRY_RUN=false

usage() {
  cat <<'EOF'
用法: bun run deploy:server -- root@host [选项]

默认行为:
  - 编译 Linux amd64 二进制并上传
  - 使用 apps/server/.env 里的 MongoDB / Redis（不启动容器）
  - 不再上传 .env（仅在远程缺少 .env 时上传一次）
  - 安装/更新 systemd 并重启 eco-server

选项:
  -p, --port PORT    SSH 端口 (默认 22)
  -d, --dir PATH     远程目录 (默认 /opt/eco/server)
  -b, --build        强制重新编译
  -n, --dry-run      预览，不实际上传
      --docker       旧模式：上传 JS bundle + Docker 编排
      --with-deps    同时启动 MongoDB/Redis 容器（仅无外部实例时用）
  -h, --help         显示帮助

示例:
  bun run deploy:server -- root@192.168.31.204
  bun run deploy:server -- root@192.168.31.204 -b
EOF
  exit 0
}

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift; POSITIONAL+=("$@"); break ;;
    -n|--dry-run) DRY_RUN=true; shift ;;
    -b|--build) REBUILD=true; shift ;;
    --docker) DOCKER=true; shift ;;
    --with-deps) WITH_DEPS=true; shift ;;
    -p|--port) SSH_PORT="$2"; shift 2 ;;
    -d|--dir) REMOTE_DIR="$2"; shift 2 ;;
    -s|--server) SERVER="$2"; shift 2 ;;
    -h|--help) usage ;;
    -B|--binary|--no-deps|--install-service|--restart)
      echo "提示: 以上选项已内置为默认，无需再传。"
      shift ;;
    -*)
      echo "错误: 未知选项 $1（运行 -h 查看帮助）"
      exit 1
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

[[ -z "$SERVER" && ${#POSITIONAL[@]} -gt 0 ]] && SERVER="${POSITIONAL[0]}"
[[ -z "$SERVER" ]] && { echo "错误: 请指定服务器，例如 root@192.168.31.204"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_DIR/apps/server"
BINARY_NAME="eco-server-linux-amd64"

ssh_cmd() { ssh -p "$SSH_PORT" "$SERVER" "$@"; }

# 外部 Mongo/Redis → 不启动容器
uses_external_deps() {
  ! grep -qE 'ECO_SERVER_MONGODB_URI=mongodb://mongo:' "$SERVER_DIR/.env" 2>/dev/null &&
    ! grep -qE 'ECO_SERVER_REDIS_URL=redis://redis:' "$SERVER_DIR/.env" 2>/dev/null
}

skip_deps() {
  $WITH_DEPS && return 1
  uses_external_deps
}

[[ -f "$SERVER_DIR/.env" ]] || {
  echo "错误: 未找到 apps/server/.env"
  exit 1
}

# ---- 构建 ----
if $DOCKER; then
  if $REBUILD || [[ ! -f "$SERVER_DIR/dist/index.js" ]]; then
    echo "==> 构建 JS bundle..."
    (cd "$PROJECT_DIR" && bun run build:server)
  fi
else
  if $REBUILD || [[ ! -f "$SERVER_DIR/dist/$BINARY_NAME" ]]; then
    echo "==> 编译 Linux amd64 二进制..."
    (cd "$PROJECT_DIR" && bun run --cwd apps/server build:linux-amd64)
  fi
  echo "==> $(file -b "$SERVER_DIR/dist/$BINARY_NAME") ($(du -h "$SERVER_DIR/dist/$BINARY_NAME" | cut -f1))"
fi

RSYNC=(rsync -avz -e "ssh -p $SSH_PORT" --progress)
$DRY_RUN && RSYNC+=(--dry-run) && echo "==> DRY RUN"

echo "==> 部署到 $SERVER:$REMOTE_DIR"
if $DOCKER; then
  echo "    模式: Docker"
else
  echo "    模式: 二进制 + systemd"
  if skip_deps; then
    echo "    依赖: .env 中的 MongoDB / Redis"
  else
    echo "    依赖: docker-compose.deps.yml"
  fi
fi

$DRY_RUN || ssh_cmd "mkdir -p $REMOTE_DIR"
cd "$SERVER_DIR"

# .env 只在远程不存在时上传一次，避免每次发布覆盖服务器上的配置
if $DRY_RUN; then
  "${RSYNC[@]}" "./.env" "$SERVER:$REMOTE_DIR/" || true
else
  if ! ssh_cmd "test -f $REMOTE_DIR/.env"; then
    echo "==> 远程缺少 .env，首次上传..."
    "${RSYNC[@]}" "./.env" "$SERVER:$REMOTE_DIR/"
  else
    echo "==> 远程已有 .env，跳过上传（如需更新请手动 scp）"
  fi
fi

if $DOCKER; then
  for f in dist/index.js Dockerfile docker-compose.yml .dockerignore; do
    "${RSYNC[@]}" "./$f" "$SERVER:$REMOTE_DIR/"
  done
else
  "${RSYNC[@]}" "./dist/$BINARY_NAME" "$SERVER:$REMOTE_DIR/eco-server"
  "${RSYNC[@]}" "./eco-server.service" "$SERVER:$REMOTE_DIR/"
  skip_deps || "${RSYNC[@]}" "./docker-compose.deps.yml" "$SERVER:$REMOTE_DIR/"
fi

echo "==> 上传完成"
$DRY_RUN && exit 0

if $DOCKER; then
  echo "==> 启动 Docker 编排..."
  ssh_cmd "cd $REMOTE_DIR && docker compose up -d --build"
  echo "==> 完成。日志: ssh $SERVER 'cd $REMOTE_DIR && docker compose logs -f server'"
  exit 0
fi

ssh_cmd "chmod +x $REMOTE_DIR/eco-server"

if skip_deps; then
  echo "==> 跳过 MongoDB/Redis 容器"
else
  echo "==> 启动 MongoDB + Redis..."
  ssh_cmd "cd $REMOTE_DIR && docker compose -f docker-compose.deps.yml up -d"
fi

if ssh_cmd "systemctl is-enabled eco-server >/dev/null 2>&1"; then
  echo "==> 重启 eco-server..."
  ssh_cmd "systemctl restart eco-server"
else
  echo "==> 首次安装 systemd 服务..."
  ssh_cmd "cp $REMOTE_DIR/eco-server.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now eco-server"
fi

echo "==> 部署完成"
echo "    状态: ssh $SERVER 'systemctl status eco-server'"
echo "    日志: ssh $SERVER 'journalctl -u eco-server -f'"
