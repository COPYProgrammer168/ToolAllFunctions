import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Side-effect: resolve ffmpeg/ffprobe (PATH or ffmpeg-static) before any
// service spawns a shell command.
import './utils/binaries.js';
import { apiRouter } from './routes/api.js';
import { JobManager } from './services/JobManager.js';
import { MediaJobManager } from './services/MediaJobManager.js';
import { HardwareDetector } from './services/HardwareDetector.js';
import { STORAGE_ROOT } from './utils/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const clientDist = path.resolve(__dirname, '../../client/dist');

if (!STORAGE_ROOT) {
  console.warn('[WARN] STORAGE_DIR not set; using default ./storage');
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', apiRouter);

app.use(express.static(clientDist, { fallthrough: true, index: false }));

app.use(/^\/(?!api|assets).*/, (req, res) => {
  try {
    res.sendFile(path.join(clientDist, 'index.html'));
  } catch (e) {
    res.status(500).send('Unable to serve client assets');
  }
});

async function startServer() {
  await JobManager.init();
  await MediaJobManager.init();
  const hw = await HardwareDetector.detect();

  console.log('----------------------------------------------------');
  console.log('AI Video Optimizer — Backend Engine Initialized');
  console.log(`Hardware Acceleration: ${hw.hasNvidiaGpu ? `NVIDIA GPU (${hw.gpuName})` : 'CPU Multi-Core'}`);
  console.log(`Recommended Encoder: ${hw.recommendedEncoder}`);
  console.log(`CPU Cores: ${hw.cpuCores} | Free RAM: ${hw.freeMemoryMB} MB`);
  console.log('----------------------------------------------------');

  const clientExists = fs.existsSync(clientDist);
  console.log(`[clientDist] ${clientDist}`);
  console.log(`[clientDist] exists=${clientExists}`);
  if (clientExists) {
    const assetsDir = path.join(clientDist, 'assets');
    console.log(`[clientDist] assets=${fs.readdirSync(assetsDir).join(', ')}`);
  }

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
