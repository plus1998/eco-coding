FROM oven/bun:1-slim

WORKDIR /app
COPY dist/index.js ./

ENV ECO_SERVER_HOST=0.0.0.0
EXPOSE 3128

CMD ["bun", "index.js"]
