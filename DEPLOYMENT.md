# AI Video Optimizer — Render Deployment

## Build & Start

- **Build:** `npm install && npm install --prefix server && npm install --prefix client && npm run build --prefix client && npm run build --prefix server`
- **Start:** `npm run start --prefix server`

## Environment Variables (Render Dashboard)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Auto-injected |
| `STORAGE_DIR` | *(set by you)* | Path for SQLite + uploads persistence; set to `/mnt/data` to use Render Disk |
| `JOBS_DB_PATH` | *(auto)* | Overrides SQLite file path; resolves to `STORAGE_ROOT/jobs.db` |

## Persistent Jobs (optional)

- Set `STORAGE_DIR=/mntdata` in Render env vars
- Uncomment `persistentDisk` in `render.yaml` (size: 10GB+, mountPath: `/mnt/data`)
- Jobs survive server restarts & redeploys

## TikTok + ffmpeg

- **Dockerfile** installs ffmpeg + playwright chromium for TikTok headless fallback
- On native Node: ensure `ffmpeg` in system PATH, or use Dockerfile

## Files Modified

1. `server/src/utils/paths.ts` — `STORAGE_ROOT` / `JOBS_DB_PATH` env-driven
2. `server/src/services/JobDatabase.ts` — SQLite persistence (`better-sqlite3`)
3. `server/src/services/MediaJobManager.ts` — save on progress/terminal; restore on restart; delete→SQLite
4. `server/src/server.ts` — client serving + SPA fallback
5. `server/Dockerfile` — ffmpeg + playwright for TikTok
6. `render.yaml` — two service definitions + env vars

## Verified

- Server TS: OK
- Client TS: OK
- `server.js` built (2.2KB)
- `client/dist` has `index.html` + assets

## Deployment Steps

1. Push code to GitHub
2. Create Render Web Service, connect repo
3. Use the build/start commands from `render.yaml`
4. **(Optional)** Set `STORAGE_DIR=/mntdata` and uncomment `persistentDisk` in `render.yaml` for persistent jobs/uploads across restarts

## TikTok + ffmpeg

- **Dockerfile** installs ffmpeg + playwright chromium for TikTok headless fallback
- On native Node: ensure `ffmpeg` in system PATH, or use Dockerfile

---

*All TypeScript checks pass. Push code, deploy, and you're live.*