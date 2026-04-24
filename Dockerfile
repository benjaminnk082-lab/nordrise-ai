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

# Runtime system deps + Claude Code CLI (pinned)
# Bump CLAUDE_CODE_VERSION intentionally; floating "latest" is rejected to
# avoid surprise behavior changes in verify-auth parsing.
ARG CLAUDE_CODE_VERSION=1.0.60
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        openssl \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force

# Non-root user
RUN groupadd --system --gid 1001 sean \
    && useradd --system --uid 1001 --gid sean --home-dir /app --shell /bin/bash sean \
    && mkdir -p /app/.claude /app/workspace \
    && chown -R sean:sean /app

COPY --chown=sean:sean package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=sean:sean --from=builder /build/dist ./dist
COPY --chown=sean:sean --from=builder /build/prisma ./prisma
COPY --chown=sean:sean --from=builder /build/node_modules/.prisma ./node_modules/.prisma
COPY --chown=sean:sean --from=builder /build/node_modules/@prisma ./node_modules/@prisma
COPY --chown=sean:sean docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER sean

# Railway injects PORT; 3000 is the documented default.
EXPOSE 3000

# tini handles PID 1 responsibilities so SIGTERM reaches node cleanly.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
