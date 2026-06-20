#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Eco Server 部署脚本
# 将 apps/server 产物 rsync 到目标服务器
# ============================================================

# ---------- 默认配置 ----------
SERVER=""                           # 必须通过 -s 或位置参数传入
SSH_PORT="22"
REMOTE_DIR="/opt/eco/server"
# --------------------------------

DRY_RUN=false
REBUILD=false

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
  echo "  -b, --build          强制重新构建 server"
  echo "  -h, --help           显示帮助"
  echo ""
  echo "示例:"
  echo "  $0 root@192.168.1.100"
  echo "  $0 -s root@myserver.local -p 2222 -d /srv/eco"
  echo "  bun run deploy:server -- root@192.168.1.100 -b"
  exit 0
}

# 收集位置参数（非选项参数）
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift; POSITIONAL+=("$@"); break ;;
    -n|--dry-run) DRY_RUN=true; shift ;;
    -b|--build)   REBUILD=true; shift ;;
    -s|--server)  SERVER="$2"; shift 2 ;;
    -p|--port)    SSH_PORT="$2"; shift 2 ;;
    -d|--dir)     REMOTE_DIR="$2"; shift 2 ;;
    -h|--help)    usage ;;
    -*)
      # 非标准选项但以 - 开头，当作未知选项
      echo "错误: 未知选项 $1"
      usage
      ;;
    *)
      # 位置参数
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

# 位置参数第一个作为 SERVER
if [[ -z "$SERVER" && ${#POSITIONAL[@]} -gt 0 ]]; then
  SERVER="${POSITIONAL[0]}"
fi

if [[ -z "$SERVER" ]]; then
  echo "错误: 必须指定服务器地址"
  echo "用法: $0 root@host [-p port] [-d dir]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_DIR/apps/server"

# ---- 构建 ----
if $REBUILD || [[ ! -f "$SERVER_DIR/dist/index.js" ]]; then
  echo "==> 构建 server..."
  cd "$PROJECT_DIR"
  bun run build:server
  echo ""
fi

# ---- 传输文件列表 ----
FILES=(
  "dist/index.js"
  "Dockerfile"
  "docker-compose.yml"
  ".dockerignore"
)

RSYNC_OPTS=(
  -avz
  -e "ssh -p $SSH_PORT"
  --progress
  --relative
)

if $DRY_RUN; then
  RSYNC_OPTS+=(--dry-run)
  echo "==> DRY RUN 模式（不会实际传输）"
fi

echo "==> 传输到 $SERVER:$REMOTE_DIR (port $SSH_PORT)"
cd "$SERVER_DIR"

# 确保远程目录存在
if ! $DRY_RUN; then
  ssh -p "$SSH_PORT" "$SERVER" "mkdir -p $REMOTE_DIR" 2>/dev/null || true
fi

for f in "${FILES[@]}"; do
  rsync "${RSYNC_OPTS[@]}" "./$f" "$SERVER:$REMOTE_DIR/"
done

echo ""
echo "==> 部署完成"

if ! $DRY_RUN; then
  echo ""
  echo "在服务器上重建并启动:"
  echo "  ssh -p $SSH_PORT $SERVER 'cd $REMOTE_DIR && docker compose up -d --build'"
  echo ""
  echo "查看日志:"
  echo "  ssh -p $SSH_PORT $SERVER 'cd $REMOTE_DIR && docker compose logs -f server'"
fi
