import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api.js';
import { JobManager } from './services/JobManager.js';
import { MediaJobManager } from './services/MediaJobManager.js';
import { HardwareDetector } from './services/HardwareDetector.js';
import { STORAGE_ROOT } from './utils/paths.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
// Allow override of storage root (Render Disk mount, etc.)
if (!STORAGE_ROOT) {
    console.warn('[WARN] STORAGE_DIR not set; using default ./storage');
}
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Mount API routes
app.use('/api', apiRouter);
// Serve built client assets (client must be built first, output to client/dist)
const clientDist = path.resolve(__dirname, '../../client/dist');
// Serve static assets under /assets
app.use('/assets', express.static(clientDist, { index: 'index.html', fallthrough: false }));
// SPA fallback: serve index.html for any unmatched route except /api and /assets
app.use('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/assets')) {
        return res.status(404).end();
    }
    try {
        res.sendFile(path.join(clientDist, 'index.html'));
    }
    catch (e) {
        res.status(500).send('Unable to serve client assets');
    }
});
// Initialize services and start server
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
    app.listen(PORT, () => {
        console.log(`Server listening on http://localhost:${PORT}`);
    });
}
startServer().catch((err) => {
    console.error('Fatal server startup error:', err);
    process.exit(1);
});
