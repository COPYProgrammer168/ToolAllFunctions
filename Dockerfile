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

# Copy package files
COPY server/package*.json ./
COPY client/package*.json ./client/

# Install root dependencies first (so better-sqlite3 compiles with system libs)
RUN npm install

# Install server deps (includes better-sqlite3 native build)
RUN npm install --prefix server

# Install client deps
RUN npm install --prefix client

# Install Playwright browsers for TikTok headless fallback
RUN npx playwright install chromium --quiet

# Build client
RUN npm run build --prefix client

# Build server (TypeScript → dist)
RUN npm run build --prefix server

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy only production artifacts from builder
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/client/node_modules ./client/node_modules

# Copy storage directory if it exists (for SQLite persistence across rebuilds)
COPY --from=builder /app/storage ./storage

# Set working directory
WORKDIR /app/server

# Expose Render-assigned port
ENV PORT=3001
EXPOSE 3001

# Start server
CMD ["node", "dist/server.js"]