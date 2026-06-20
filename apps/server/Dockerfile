FROM oven/bun:1-slim AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install

COPY packages/shared packages/shared
COPY apps/server apps/server

RUN bun run --cwd apps/server build

FROM oven/bun:1-slim

WORKDIR /app
COPY --from=builder /app/apps/server/dist/index.js ./

ENV ECO_SERVER_HOST=0.0.0.0
EXPOSE 3128

CMD ["bun", "index.js"]
