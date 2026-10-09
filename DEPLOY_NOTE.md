# Deploy on Render — Native Node (via `render.yaml`)

Target: **Render Native Environment (Node)**, defined in `render.yaml` at the repo root.
No Docker required.

---

## 1. What `render.yaml` does

```yaml
services:
  - type: web
    name: ai-video-optimizer
    env: node
    plan: free
    buildCommand:
      pip3 install --user yt-dlp            # optional extraction fallback (non-fatal)
      npm install
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix server
      npm install --prefix client
      npm run build --prefix client
      npm run build --prefix server
    startCommand: 'export PATH="$HOME/.local/bin:$PATH"; npm run start --prefix server'
```

- **Single service definition.** The file previously contained two duplicate
  top-level `services:` keys (invalid YAML — Render ignored/failed the blueprint)
  and a `PORT: fromService: ""` entry that referenced nothing.
- `PORT` is set explicitly to `10000` (Render's default ingress port).
- `NODE_VERSION=22`.

---

## 2. ffmpeg / ffprobe — no system install needed

Render's native Node environment does **not** ship ffmpeg.

`server/src/utils/binaries.ts` resolves the binaries in this order:

1. `FFMPEG_PATH` / `FFPROBE_PATH` env overrides
2. whatever is on `PATH` (local dev, Docker image)
3. the `ffmpeg-static` / `ffprobe-static` npm packages (installed as regular
   dependencies, so they are present in every environment)

On import it prepends the resolved directory to `PATH`, so every existing
`exec('ffmpeg ...')` / `exec('ffprobe ...')` call site keeps working unchanged.

> On Alpine/Docker images, `apk add ffmpeg` is used in **both** stages — the
> production stage used to miss it (builder packages are not carried over).

---

## 3. yt-dlp — optional fallback only

`pip3 install --user yt-dlp || echo "yt-dlp install skipped"` runs at build time.
Nothing depends on it: YouTube/TikTok extraction is pure HTTP first, Playwright
second, yt-dlp last.

---

## 4. Playwright browsers

Browsers are **not** downloaded on Render (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`)
because a native Node instance cannot install the system libraries Chromium
needs. TikTok extraction therefore uses its HTTP chain:

1. desktop UA page fetch
2. mobile UA page fetch
3. `https://m.tiktok.com/v/{id}.html` (the request that reliably returns
   `__UNIVERSAL_DATA_FOR_REHYDRATION__` with `playAddr`)

Playwright is attempted only when `playwrightAvailable()` returns true and
fails silently otherwise. In the Dockerfile the browsers are installed in the
builder **and copied** to the production stage (they live in
`/root/.cache/ms-playwright`, not in `node_modules` — they were previously
never copied).

---

## 5. Stream credentials & preview proxy

- TikTok signs `playAddr` against the `tt_chain_token` cookie issued with the
  page. `server/src/services/StreamCredentials.ts` caches those headers/cookies
  (45 min TTL) during analysis so the download worker and preview proxy can
  replay them.
- YouTube `googlevideo.com` URLs are IP-bound to the server, so a browser
  loading them directly receives **403**. The client routes every remote
  stream through `GET /api/media/stream?url=...`, which forwards the correct
  headers and supports HTTP Range. Separate adaptive tracks go through
  `GET /api/media/merge-preview`.
- Remote downloads use `server/src/utils/httpDownload.ts` (`fetch` + streams) —
  the old `curl.exe` calls do not exist on Linux and were shell-injection risks.
- **Every** remote request sends a `Range` header (`bytes=0-` at minimum):
  Google's `googlevideo` *audio* endpoints answer a Range-less request with
  `200` + `Content-Length` and then never send a body, which previously looked
  like a permanent hang on every muxed (adaptive) download and preview.
- yt-dlp (when present) runs with a temporary cookie jar; the jar is replayed
  with the URLs it returns, because TikTok signs them against that session.

---

## 6. Persistence

| Env var       | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `STORAGE_DIR` | storage root (uploads, `jobs.db`) — set to `/mnt/data` with a persistent disk |
| `JOBS_DB_PATH`| override the SQLite path (defaults to `STORAGE_ROOT/jobs.db`) |
| `PORT`        | set to `10000` in `render.yaml`                       |

Both `STORAGE_DIR` and `JOBS_DB_PATH` are listed in `render.yaml` with
`sync: false` — set them in the Render dashboard after attaching a disk.

Persistent disk (optional): add in Render dashboard → size 10 GB →
mountPath `/mnt/data`, then set `STORAGE_DIR=/mnt/data`.

---

## 7. File structure after deploy

```
[app root]
├─ server/
│   ├─ dist/          ← built server (tsc)
│   └─ storage/       ← jobs.db, uploads (or $STORAGE_DIR)
└─ client/
    └─ dist/          ← built client (Vite) — served by Express + SPA fallback
```

---

## 8. Deployment steps

1. Push to GitHub (repo root must contain `render.yaml`).
2. Render → New → Web Service → connect repo (Render auto-detects `render.yaml`).
3. (Optional) Add a persistent disk and set `STORAGE_DIR=/mnt/data`.
4. Deploy.
5. Open `https://your-service.onrender.com/health` → `{"status":"ok"}`.
6. Paste a YouTube/TikTok link in the app → analyze → preview → download.

---

## 9. Local verification

```bash
npm run build --prefix server     # tsc
npm run build --prefix client     # tsc -b && vite build
npx tsx scripts/check-providers.ts    # from server/ — resolves + range-fetches
                                     # a YouTube and a TikTok video
npx tsx scripts/check-yt-fallback.ts   # yt-dlp YouTube fallback in isolation
npx tsx scripts/check-yt-failure.ts    # inspect the "not authorized" notice
```

### YouTube resolution order

1. Watch page (consent cookie) → `INNERTUBE_API_KEY` + `visitorData`
2. Innertube `/youtubei/v1/player` with `ANDROID`, `ANDROID_VR`, `IOS`, `WEB`,
   `TVHTML5`, `WEB_EMBEDDED_PLAYER` — keeps going until it has video **and** audio
3. `yt-dlp` when installed (`YT_DLP_PATH`, PATH, `~/.local/bin`, or the
   `pip3 install --user yt-dlp` step in `render.yaml`); it runs with a temporary
   cookie jar whose cookies are replayed with the returned URLs. HLS/DASH
   manifest URLs are filtered out, and H.264/AAC MP4 is preferred so ffmpeg can
   remux with `-c copy`.

When nothing resolves, the notice now carries YouTube's actual playability
reason (e.g. "This video is unavailable"), the server logs
`[youtube] <videoId>: no stream resolved — <reason>`, and the UI suggests adding
a `cookies.txt` from a logged-in session (`YT_COOKIES`) for age-gated content.

Last run (through the running server on `:3999`):

| Check | Result |
| --- | --- |
| `GET /health` | `200 {"status":"ok"}` |
| TikTok analyze (`@tiktok/video/7694307066965396766`) | duration 52 s, muxed URL + cookies |
| YouTube analyze (`dQw4w9WgXcQ`) | duration 213 s, muxed + audio URLs |
| `GET /api/media/stream` (both platforms, `Range: bytes=0-4095`) | `206 video/mp4`, `ftypisom` / `ftypmp42` |
| `GET /api/media/merge-preview` | 11.9 MB MP4 in 18 s, ffprobe duration 213.04 s |
| `POST /api/media/download` — YouTube muxed video | `COMPLETED`, 11.8 MB |
| `POST /api/media/download` — explicit video+audio mux | `COMPLETED` |
| `POST /api/media/download` — TikTok video | `COMPLETED`, 9.9 MB |
| `POST /api/media/download` — YouTube MP3 (320 kbps) | `COMPLETED` |
