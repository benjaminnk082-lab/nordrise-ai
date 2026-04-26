# syntax=docker/dockerfile:1.7

# =============================================================================
# Nordrise AI — Sean. Multi-stage Dockerfile.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — build
# -----------------------------------------------------------------------------
FROM node:20-slim AS builder

WORKDIR /build

# System deps for native modules (prisma engines, etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        openssl \
        git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

RUN npx prisma generate --schema=./prisma/schema.prisma \
 && npm run build

# -----------------------------------------------------------------------------
# Stage 2 — runtime
# -----------------------------------------------------------------------------
FROM node:20-slim AS runtime

ENV NODE_ENV=production \
    HOME=/app \
    WORKSPACE_DIR=/app/workspace

WORKDIR /app

# Runtime system deps + Claude Code CLI.
# Pin via build arg so we can bump intentionally. Minimum 1.0.88+ required
# by the OAuth/subscription auth path used here.
ARG CLAUDE_CODE_VERSION=latest
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force

# MCP servers (Sean uses these from claude-code via /app/.claude/settings.json).
# Pin reasonable versions; per-request API keys arrive in env from the desktop
# client (see ClaudeBridge env passthrough), never persisted server-side.
RUN npm install -g --no-audit --no-fund \
      firecrawl-mcp@^1.10.0 \
      @modelcontextprotocol/server-github@^2024.11.25 \
    && npm cache clean --force

# NOTE: Running as root. Railway volumes mount with root ownership and a
# non-root user couldn't write to them without extra init work.
RUN mkdir -p /app/.claude /app/workspace

# claude-code reads ~/.claude/settings.json by default; HOME=/app, so this
# is the path it'll pick up. The file references env vars with ${VAR} which
# claude-code resolves at spawn time from the inherited environment.
COPY mcp-config/claude-settings.json /app/.claude/settings.json

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --from=builder /build/dist ./dist
COPY --from=builder /build/prisma ./prisma
COPY --from=builder /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /build/node_modules/@prisma ./node_modules/@prisma
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Railway injects PORT; 3000 is the documented default.
EXPOSE 3000

# Railway provides a --init flag that wraps the container with an init process,
# so we don't need tini ourselves. startCommand in railway.json runs the
# entrypoint script directly.
CMD ["/app/docker-entrypoint.sh"]
