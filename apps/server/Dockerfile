FROM oven/bun:1

WORKDIR /app

# Install workspace dependencies
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

RUN bun install

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/

ENV ECO_SERVER_HOST=0.0.0.0
EXPOSE 3128

CMD ["bun", "run", "apps/server/src/index.ts"]
