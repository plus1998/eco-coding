# 1Panel / 单目录部署：先在本地执行 `bun run build:server` 生成 dist/index.js
FROM oven/bun:1-slim

WORKDIR /app
COPY dist/index.js ./

ENV ECO_SERVER_HOST=0.0.0.0
EXPOSE 3128

CMD ["bun", "index.js"]
