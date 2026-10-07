# Deploy on Render — File Root Directory & Persistence Note

## 1. Set Storage Root (SQLite + Uploads)

- **Default** (local): `./storage` folder next to built server
- **Render**: set env var `STORAGE_DIR=/mnt/data` to use a Render Disk (persists across restarts/redeploys)
- Without `STORAGE_DIR`: jobs and uploads are ephemeral (cleared on restart)
- `JOBS_DB_PATH` auto-resolves to `STORAGE_ROOT/jobs.db`

## 2. Render Dashboard Setup

1. Create Web Service, connect repo
2. **Build command:**
   ```
   npm install && npm install --prefix server && npm install --prefix client && npm run build --prefix client && npm run build --prefix server
   ```
3. **Start command:**
   ```
   npm run start --prefix server
   ```
4. **Environment Variables:**
   - `PORT` ← auto-injected
   - `STORAGE_DIR=/mnt/data` ← for persistence
   - `JOBS_DB_PATH` ← optional
5. **(Optional) Persistent Disk:**
   - In Render dashboard: add Persistent Disk, size 10GB+, mountPath `/mnt/data`
   - This keeps `jobs.db` and `uploads` persistent

## 3. TikTok + ffmpeg

- Dockerfile included installs ffmpeg + playwright chromium for TikTok headless fallback
- On native Node: ensure ffmpeg in system PATH, or use Dockerfile
- On Render native Node: set `STORAGE_DIR=/mnt/data` for SQLite persistence

## 4. File Structure After Deploy

```
[app root]
│
├─ server/
│   ├─ dist/            ← built server
│   ├─ storage/         ← jobs.db, uploads, media-tools
│   │   └─ (persisted if STORAGE_DIR=/mnt/data)
│   └─ server.js        ← entry point
│
└─ client/
    └─ dist/            ← built client (HTML + JS/CSS)
```

## 5. Quick Checklist

- [ ] Push code to GitHub
- [ ] Create Render Web Service, connect repo
- [ ] Set build/start commands
- [ ] Add `STORAGE_DIR=/mntdata` env var
- [ ] (Optional) Add Persistent Disk 10GB+ at `/mnt/data`
- [ ] Deploy
- [ ] Visit `https://your-service.onrender.com/health` → `{"status":"ok"}`

## 6. Key Files Modified

1. `server/src/utils/paths.ts` — `STORAGE_ROOT` / `JOBS_DB_PATH` env-driven
2. `server/src/services/JobDatabase.ts` — SQLite persistence (`better-sqlite3`)
3. `server/src/services/MediaJobManager.ts` — save on progress/terminal; restore on restart; delete→SQLite
3. `server/src/server.ts` — client serving + SPA fallback
4. `server/Dockerfile` — ffmpeg + playwright for TikTok
5. `render.yaml` — two service definitions + env vars

## 7. Verified

- Server TS: OK
- Client TS: OK
- `server.js` built (2.2KB)
- `client/dist` has `index.html` + assets

## 8. Deployment Steps

1. Push code to GitHub
2. Create Render Web Service, connect repo
3. Set build/start commands from render.yaml
4. Add `STORAGE_DIR=/mntdata` env var
5. (Optional) Add Persistent Disk 10GB+ at `/mnt/data`
6. Deploy
7. Visit `/health` → `{"status":"ok"}`

TikTok + ffmpeg: Dockerfile installs ffmpeg + playwright chromium. On native Node, ensure ffmpeg in PATH or use Dockerfile.

---
All TypeScript checks pass. Push code, deploy, and you're live.