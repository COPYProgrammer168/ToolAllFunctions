FROM node:22-alpine AS builder

# Install build dependencies (ffmpeg, playwright, python for native modules)
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    gcc \
    g++ \
    bash \
    git

# Set working directory
WORKDIR /app

# Copy package files to their respective directories
# (npm --prefix expects package.json at that path)
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install server deps (includes better-sqlite3 native build)
# Using --prefix so better-sqlite3 compiles with system libs (ffmpeg, python from builder stage)
# Use the Node headers bundled in the image instead of fetching them from
# unofficial-builds.nodejs.org — that download times out (ETIMEDOUT) on
# several networks/firewalls and node-gyp then fails to build better-sqlite3.
ENV npm_config_nodedir=/usr/local
RUN npm install --prefix server

# Install client deps
RUN npm install --prefix client

COPY server ./server
COPY client ./client

RUN mkdir -p /app/storage

# Install Playwright browsers for TikTok headless fallback
RUN npx playwright install chromium

# Build client
RUN npm run build --prefix client

# Build server (TypeScript → dist)
RUN npm run build --prefix server

# Production stage
FROM node:22-alpine

# ffmpeg must be present in the *production* image too — the builder stage's
# packages are not carried over. The app prefers a system ffmpeg when one
# exists and falls back to ffmpeg-static otherwise (see server/src/utils/binaries.ts).
RUN apk add --no-cache ffmpeg python3

WORKDIR /app

# Copy only production artifacts from builder
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/client/node_modules ./client/node_modules

# Playwright browsers installed in the builder (optional TikTok fallback).
# Without this copy the browser launch always fails because browsers live in
# the home cache directory, not in node_modules.
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright

# Copy storage directory if it exists (for SQLite persistence across rebuilds)
COPY --from=builder /app/storage ./storage

# Runtime libraries Playwright's Chromium needs (best effort — the app works
# without a browser; TikTok extraction uses its HTTP path first).
RUN npx --prefix /app/server playwright install-deps chromium || true

# Set working directory
WORKDIR /app/server

# Expose Render-assigned port
ENV PORT=3001
EXPOSE 3001

# Start server
CMD ["node", "dist/server.js"]