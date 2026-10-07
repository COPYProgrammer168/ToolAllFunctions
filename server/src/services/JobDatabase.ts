import Database from 'better-sqlite3';
import type { MediaJobRecord } from './MediaJobManager.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fallbackStorage = path.resolve(__dirname, '../../../storage');
export const STORAGE_ROOT = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : fallbackStorage;

// SQLite jobs database: override with JOBS_DB_PATH, otherwise STORAGE_ROOT/jobs.db
export const JOBS_DB_PATH = process.env.JOBS_DB_PATH
  ? process.env.JOBS_DB_PATH
  : path.join(STORAGE_ROOT, 'jobs.db');

function getDb(): Database.Database {
  fs.mkdirSync(path.dirname(JOBS_DB_PATH), { recursive: true });
  const db = new Database(JOBS_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_jobs (
      id TEXT PRIMARY KEY,
      title TEXT,
      filename TEXT,
      type TEXT,
      sourceUrl TEXT,
      jobDir TEXT,
      sourcePath TEXT,
      outputPath TEXT,
      format TEXT,
      createdAt INTEGER,
      completedAt INTEGER,
      progress TEXT,
      downloadMeta TEXT
    )
  `);
  return db;
}

export function loadJobs(): MediaJobRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM media_jobs ORDER BY createdAt DESC').all() as any[];
  return rows.map((r) => {
    let progress: any;
    try {
      progress = JSON.parse(r.progress);
    } catch {
      progress = {
        status: 'FAILED',
        percent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        speedFormatted: '0 MB/s',
        timeRemainingSec: 0,
        stageName: 'Corrupted record',
      };
    }
    let downloadMeta: any;
    try {
      downloadMeta = r.downloadMeta ? JSON.parse(r.downloadMeta) : undefined;
    } catch {
      downloadMeta = undefined;
    }
    return {
      id: r.id,
      title: r.title,
      filename: r.filename,
      type: r.type,
      sourceUrl: r.sourceUrl || undefined,
      jobDir: r.jobDir,
      sourcePath: r.sourcePath,
      outputPath: r.outputPath,
      format: r.format,
      createdAt: r.createdAt,
      completedAt: r.completedAt || undefined,
      progress,
      downloadMeta,
    } as MediaJobRecord;
  });
}

export function saveJob(job: MediaJobRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO media_jobs (id, title, filename, type, sourceUrl, jobDir, sourcePath, outputPath, format, createdAt, completedAt, progress, downloadMeta)
     VALUES (@id, @title, @filename, @type, @sourceUrl, @jobDir, @sourcePath, @outputPath, @format, @createdAt, @completedAt, @progress, @downloadMeta)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, filename=excluded.filename, type=excluded.type, sourceUrl=excluded.sourceUrl,
       jobDir=excluded.jobDir, sourcePath=excluded.sourcePath, outputPath=excluded.outputPath, format=excluded.format,
       createdAt=excluded.createdAt, completedAt=excluded.completedAt, progress=excluded.progress, downloadMeta=excluded.downloadMeta`
  ).run({
    id: job.id,
    title: job.title,
    filename: job.filename,
    type: job.type,
    sourceUrl: job.sourceUrl || null,
    jobDir: job.jobDir,
    sourcePath: job.sourcePath,
    outputPath: job.outputPath,
    format: job.format,
    createdAt: job.createdAt,
    completedAt: job.completedAt || null,
    progress: JSON.stringify(job.progress),
    downloadMeta: job.downloadMeta ? JSON.stringify(job.downloadMeta) : null,
  });
}

export function deleteJobRow(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM media_jobs WHERE id = ?').run(id);
}