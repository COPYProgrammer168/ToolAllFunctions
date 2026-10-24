# AI Video Optimizer — Vercel Deployment

The repository deploys as one Vercel project using [Vercel Services](https://vercel.com/docs/services). `vercel.json` defines two services.

## Architecture

| Service | Root | Runtime | Public paths |
| --- | --- | --- | --- |
| `client` | `client/` | Vite static site | `/` and all non-API paths |
| `server` | `server/` | Container (`server/Dockerfile.vercel`) | `/api`, `/api/*`, `/health` |

The API uses the container runtime because its dependency set (ffmpeg/ffprobe, better-sqlite3, Playwright, PDF and Tesseract assets) is larger than the standard 250 MB native Function bundle limit. The image installs system `ffmpeg`/`ffprobe`; the application prefers those over the bundled static binaries.

The root monolith service from the initial auto-detected snippet is intentionally not used. The Vite service already serves the frontend, and the Express service already owns `/api` and `/health`; a third service would duplicate both.

## Routing

`vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": {
    "client": {
      "root": "client",
      "framework": "vite"
    },
    "server": {
      "root": "server",
      "entrypoint": "Dockerfile.vercel"
    }
  },
  "rewrites": [
    {
      "source": "/api",
      "destination": {
        "service": "server"
      }
    },
    {
      "source": "/api/(.*)",
      "destination": {
        "service": "server"
      }
    },
    {
      "source": "/health",
      "destination": {
        "service": "server"
      }
    },
    {
      "source": "/(.*)",
      "destination": {
        "service": "client"
      }
    }
  ]
}
```

Rewrites are evaluated in order:

1. Exact `/api` and `/api/*` go to `server`.
2. `/health` goes to `server`.
3. Everything else goes to `client`.

Vercel preserves the original request path when routing to a service. The Express app therefore still mounts its router at `/api` and exposes `/health` unchanged. The browser uses relative `/api/...` URLs, so no production hostname or port is hardcoded.

## Bindings

No service bindings are declared. Bindings are for **server-side** calls between services. Here the browser calls the public `/api` rewrite directly. The `client` service is a static Vite build and cannot read runtime bindings, and the API does not call another service. Add a binding only if a new server-side service-to-service call is introduced.

## Build

Vercel builds each service independently:

- `client`: installs dependencies and runs `npm run build` (Vite), producing `client/dist`.
- `server`: builds `server/Dockerfile.vercel`. The image compiles TypeScript, prunes dev dependencies, installs system `ffmpeg`, and starts `node dist/server.js` on port 80.

`server/Dockerfile.vercel` sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Playwright Chromium is not installed, so TikTok's headless-browser fallback is unavailable; its HTTP path still runs. Add a browser install step if that fallback is required.

## Environment variables

Set these in **Vercel Project Settings → Environment Variables**. Do not set `PORT` unless you intentionally override the container's port 80.

| Variable | Default | Notes |
| --- | --- | --- |
| `STORAGE_DIR` | `/tmp/ai-video-optimizer` | Set in the image; the code also defaults here when `VERCEL` is set. |
| `JOBS_DB_PATH` | `$STORAGE_DIR/jobs.db` | Optional SQLite override. |
| `MAX_CONCURRENT_TRANSCODES` | auto | Set to `1` to protect memory on small instances. |
| `MEMORY_LIMIT_MB` | auto-detected | Set if cgroup memory detection is wrong. |
| `MEDAL_DOWNLOADER_ENABLED` | `true` | Set `false` to disable Medal downloads. |
| `MEDAL_DOWNLOADER_MAX_FILE_SIZE_MB` | `500` | Reduce if `/tmp` is too small for the clip. |
| `MEDAL_DOWNLOADER_MAX_CONCURRENT_JOBS` | `1` | Keep at `1` on Vercel. |
| `MEDAL_DOWNLOADER_MAX_QUEUE_SIZE` | `10` | Queue length. |
| `MEDAL_DOWNLOADER_JOB_TTL_MINUTES` | `30` | Temporary clip retention. |
| `TT_PROXY` | unset | Optional proxy for TikTok/provider fetches. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | system binaries | Optional overrides. |

## Storage and execution limits (important)

Vercel Functions, including container services, have an **ephemeral filesystem**. `/tmp` is per instance and can disappear when the function scales down, redeploys, or moves to another instance.

Vercel also enforces limits that affect this application:

- **Request body:** 4.5 MB per request. The existing `multer`/FormData upload endpoints will reject typical video files with `413 FUNCTION_PAYLOAD_TOO_LARGE`. Supporting real uploads on Vercel requires Vercel Blob client uploads, presigned S3/R2 URLs, or another direct-to-storage flow.
- **Response body:** 4.5 MB unless the endpoint streams the response. Confirm that each download route streams rather than buffering.
- **Duration:** 300 seconds on Hobby; 300 seconds by default and 800 seconds maximum on Pro (1800 seconds in beta). Long transcodes can be terminated with `504 FUNCTION_INVOCATION_TIMEOUT`.
- **Filesystem:** only `/tmp` is writable. There is no persistent disk, so SQLite job history, uploads, generated files, and Medal clips are not durable.
- **Jobs:** in-memory Medal jobs belong to one instance; a later request may reach another instance.

For production durability and large files, point `STORAGE_DIR` and `JOBS_DB_PATH` at persistent storage and move job state/object files to an external database or bucket. That is an application change, not only a configuration change.

## Deploy

1. From the repository root, run `npx vercel link`.
2. Run `npx vercel` for a preview deployment, then `npx vercel --prod` for production.
3. Keep the Vercel project **Root Directory** at the repository root so `vercel.json` is read.
4. Verify the deployment:
   - `GET /health` returns `{"status":"ok", ...}`.
   - `/` loads the Vite client.
   - Medal inspection and a small download work end to end.
5. `npx vercel dev` runs the services locally. The container service requires Docker Desktop.

## Local development

- `npm run dev` starts the server on port 3001 and Vite on port 5173 (with the `/api` dev proxy).
- `npm run build` builds both applications.
- Server tests: `cd server && npm test` and `npm run test:medal`.
- Client tests: `cd client && npm test`.

## Render files removed

`render.yaml` and `DEPLOY_NOTE.md` were removed as part of this migration. The repository no longer contains Render-specific deployment configuration.
