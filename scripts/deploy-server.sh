#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Eco Server 部署脚本
# 支持两种模式：
#   默认     — 上传 dist/index.js + Docker 编排（docker compose up --build）
#   --binary — 交叉编译 Linux amd64 二进制 + systemd 原生部署
# ============================================================

SERVER=""
SSH_PORT="22"
REMOTE_DIR="/opt/eco/server"

DRY_RUN=false
REBUILD=false
BINARY=false
INSTALL_SERVICE=false
RESTART=false

usage() {
  echo "用法: $0 [-s] root@host [选项]"
  echo ""
  echo "参数:"
  echo "  <server>             用户名@服务器地址（第一个非选项参数）"
  echo ""
  echo "选项:"
  echo "  -s, --server HOST    用户名@服务器地址（等价于位置参数）"
  echo "  -p, --port PORT      SSH 端口 (默认: 22)"
  echo "  -d, --dir PATH       远程目标路径 (默认: /opt/eco/server)"
  echo "  -n, --dry-run        只显示会传输哪些文件，不实际传输"
  echo "  -b, --build          强制重新构建"
  echo "  -B, --binary         打包 Linux amd64 二进制并上传（原生部署）"
  echo "      --install-service  安装/更新 systemd 服务 (需配合 --binary)"
  echo "      --restart        部署后重启远程服务"
  echo "  -h, --help           显示帮助"
  echo ""
  echo "示例:"
  echo "  $0 root@192.168.1.100                    # Docker 模式"
  echo "  $0 root@192.168.1.100 -B --restart       # 二进制模式，部署后重启"
  echo "  $0 -s root@myserver.local -B --install-service --restart"
  echo "  bun run deploy:server -- root@192.168.1.100 -B --restart"
  exit 0
}

POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift; POSITIONAL+=("$@"); break ;;
    -n|--dry-run) DRY_RUN=true; shift ;;
    -b|--build) REBUILD=true; shift ;;
    -B|--binary) BINARY=true; shift ;;
    --install-service) INSTALL_SERVICE=true; shift ;;
    --restart) RESTART=true; shift ;;
    -s|--server) SERVER="$2"; shift 2 ;;
    -p|--port) SSH_PORT="$2"; shift 2 ;;
    -d|--dir) REMOTE_DIR="$2"; shift 2 ;;
    -h|--help) usage ;;
    -*)
      echo "错误: 未知选项 $1"
      usage
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$SERVER" && ${#POSITIONAL[@]} -gt 0 ]]; then
  SERVER="${POSITIONAL[0]}"
fi

if [[ -z "$SERVER" ]]; then
  echo "错误: 必须指定服务器地址"
  echo "用法: $0 root@host [-B] [-p port] [-d dir]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_DIR/apps/server"
BINARY_NAME="eco-server-linux-amd64"
REMOTE_BINARY="eco-server"

ssh_cmd() {
  ssh -p "$SSH_PORT" "$SERVER" "$@"
}

# ---- 构建 ----
if $BINARY; then
  BINARY_PATH="$SERVER_DIR/dist/$BINARY_NAME"
  if $REBUILD || [[ ! -f "$BINARY_PATH" ]]; then
    echo "==> 交叉编译 Linux amd64 二进制..."
    cd "$PROJECT_DIR"
    bun run build:server:linux-amd64
    echo ""
  fi
  if [[ ! -f "$BINARY_PATH" ]]; then
    echo "错误: 未找到 $BINARY_PATH"
    exit 1
  fi
  echo "==> 二进制: $(file -b "$BINARY_PATH")"
  echo "    大小: $(du -h "$BINARY_PATH" | cut -f1)"
  echo ""
else
  if $REBUILD || [[ ! -f "$SERVER_DIR/dist/index.js" ]]; then
    echo "==> 构建 server (JS bundle)..."
    cd "$PROJECT_DIR"
    bun run build:server
    echo ""
  fi
fi

if [[ ! -f "$SERVER_DIR/.env" ]]; then
  echo "错误: 未找到 $SERVER_DIR/.env"
  echo "请从 .env.example 复制并设置 ECO_SERVER_TOKEN_SECRET（至少 32 字符）"
  exit 1
fi

if $BINARY; then
  # 二进制模式：Mongo/Redis 走 docker-compose.deps，进程走 systemd
  if grep -q 'mongodb://mongo:' "$SERVER_DIR/.env" 2>/dev/null; then
    echo "警告: .env 中 MongoDB 地址为 Docker 内部主机名 (mongo)。"
    echo "      二进制模式请改用 mongodb://127.0.0.1:27017/eco-coding"
    echo ""
  fi
  if grep -q 'redis://redis:' "$SERVER_DIR/.env" 2>/dev/null; then
    echo "警告: .env 中 Redis 地址为 Docker 内部主机名 (redis)。"
    echo "      二进制模式请改用 redis://127.0.0.1:6379"
    echo ""
  fi
fi

RSYNC_OPTS=(
  -avz
  -e "ssh -p $SSH_PORT"
  --progress
)

if $DRY_RUN; then
  RSYNC_OPTS+=(--dry-run)
  echo "==> DRY RUN 模式（不会实际传输）"
fi

echo "==> 传输到 $SERVER:$REMOTE_DIR (port $SSH_PORT)"
if $BINARY; then
  echo "    模式: Linux amd64 二进制"
else
  echo "    模式: Docker (dist/index.js)"
fi

if ! $DRY_RUN; then
  ssh_cmd "mkdir -p $REMOTE_DIR" 2>/dev/null || true
fi

cd "$SERVER_DIR"

if $BINARY; then
  rsync "${RSYNC_OPTS[@]}" "./dist/$BINARY_NAME" "$SERVER:$REMOTE_DIR/$REMOTE_BINARY"
  rsync "${RSYNC_OPTS[@]}" "./docker-compose.deps.yml" "$SERVER:$REMOTE_DIR/"
  rsync "${RSYNC_OPTS[@]}" "./eco-server.service" "$SERVER:$REMOTE_DIR/"
  rsync "${RSYNC_OPTS[@]}" "./.env" "$SERVER:$REMOTE_DIR/"
else
  FILES=(
    "dist/index.js"
    "Dockerfile"
    "docker-compose.yml"
    ".dockerignore"
    ".env"
  )
  for f in "${FILES[@]}"; do
    rsync "${RSYNC_OPTS[@]}" "./$f" "$SERVER:$REMOTE_DIR/"
  done
fi

echo ""
echo "==> 文件上传完成"

if $DRY_RUN; then
  exit 0
fi

ssh_cmd "chmod +x $REMOTE_DIR/$REMOTE_BINARY"

if $BINARY; then
  echo "==> 启动 MongoDB + Redis (docker-compose.deps.yml)..."
  ssh_cmd "cd $REMOTE_DIR && docker compose -f docker-compose.deps.yml up -d"

  if $INSTALL_SERVICE; then
    echo "==> 安装 systemd 服务..."
    ssh_cmd "cp $REMOTE_DIR/eco-server.service /etc/systemd/system/eco-server.service && systemctl daemon-reload && systemctl enable eco-server"
  fi

  if $RESTART || $INSTALL_SERVICE; then
    if ssh_cmd "systemctl is-enabled eco-server >/dev/null 2>&1"; then
      echo "==> 重启 eco-server (systemd)..."
      ssh_cmd "systemctl restart eco-server"
    else
      echo ""
      echo "systemd 服务未安装。首次部署请执行:"
      echo "  ssh -p $SSH_PORT $SERVER 'cp $REMOTE_DIR/eco-server.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now eco-server'"
      echo ""
      echo "或临时前台运行:"
      echo "  ssh -p $SSH_PORT $SERVER 'cd $REMOTE_DIR && ./eco-server'"
    fi
  fi

  echo ""
  echo "==> 二进制部署完成"
  echo ""
  echo "查看状态:"
  echo "  ssh -p $SSH_PORT $SERVER 'systemctl status eco-server'"
  echo "查看日志:"
  echo "  ssh -p $SSH_PORT $SERVER 'journalctl -u eco-server -f'"
  echo "依赖服务:"
  echo "  ssh -p $SSH_PORT $SERVER 'cd $REMOTE_DIR && docker compose -f docker-compose.deps.yml ps'"
else
  echo ""
  echo "在服务器上重建并启动:"
  echo "  ssh -p $SSH_PORT $SERVER 'cd $REMOTE_DIR && docker compose up -d --build'"
  echo ""
  echo "查看日志:"
  echo "  ssh -p $SSH_PORT $SERVER 'cd $REMOTE_DIR && docker compose logs -f server'"

  if $RESTART; then
    echo "==> 重建 Docker 服务..."
    ssh_cmd "cd $REMOTE_DIR && docker compose up -d --build"
  fi
fi
