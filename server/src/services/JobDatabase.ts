import Database from 'better-sqlite3';
import type { MediaJobRecord } from './MediaJobManager.js';
import type { JobRecord } from '../types/index.js';
import path from 'node:path';
import fs from 'node:fs';
import { JOBS_DB_PATH } from '../utils/paths.js';

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
      downloadMeta TEXT,
      customBitrate INTEGER
    );

    CREATE TABLE IF NOT EXISTS optimization_jobs (
      id TEXT PRIMARY KEY,
      jobDir TEXT,
      inputPath TEXT,
      outputPath TEXT,
      meta TEXT,
      config TEXT,
      plan TEXT,
      progress TEXT,
      createdAt INTEGER
    );
  `);
  // Migrate databases created before the audio bitrate was persisted — resume
  // needs it to re-encode a paused music job to the requested kbps.
  try {
    db.exec('ALTER TABLE media_jobs ADD COLUMN customBitrate INTEGER');
  } catch {
    /* column already exists */
  }
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
      customBitrate: r.customBitrate ?? undefined,
    } as MediaJobRecord;
  });
}

export function saveJob(job: MediaJobRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO media_jobs (id, title, filename, type, sourceUrl, jobDir, sourcePath, outputPath, format, createdAt, completedAt, progress, downloadMeta, customBitrate)
     VALUES (@id, @title, @filename, @type, @sourceUrl, @jobDir, @sourcePath, @outputPath, @format, @createdAt, @completedAt, @progress, @downloadMeta, @customBitrate)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, filename=excluded.filename, type=excluded.type, sourceUrl=excluded.sourceUrl,
       jobDir=excluded.jobDir, sourcePath=excluded.sourcePath, outputPath=excluded.outputPath, format=excluded.format,
       createdAt=excluded.createdAt, completedAt=excluded.completedAt, progress=excluded.progress, downloadMeta=excluded.downloadMeta,
       customBitrate=excluded.customBitrate`
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
    customBitrate: job.customBitrate ?? null,
  });
}

export function deleteJobRow(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM media_jobs WHERE id = ?').run(id);
}

export function loadOptimizationJobs(): JobRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM optimization_jobs ORDER BY createdAt DESC').all() as any[];
  return rows
    .map((r) => {
      try {
        return {
          id: r.id,
          jobDir: r.jobDir,
          inputPath: r.inputPath,
          outputPath: r.outputPath,
          meta: JSON.parse(r.meta),
          config: JSON.parse(r.config),
          plan: JSON.parse(r.plan),
          progress: JSON.parse(r.progress),
          createdAt: Number(r.createdAt),
        } as JobRecord;
      } catch (err) {
        console.warn('Skipping corrupted optimization job record:', r.id, err);
        return null;
      }
    })
    .filter((j): j is JobRecord => j !== null);
}

export function saveOptimizationJob(job: JobRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO optimization_jobs (id, jobDir, inputPath, outputPath, meta, config, plan, progress, createdAt)
     VALUES (@id, @jobDir, @inputPath, @outputPath, @meta, @config, @plan, @progress, @createdAt)
     ON CONFLICT(id) DO UPDATE SET
       jobDir=excluded.jobDir, inputPath=excluded.inputPath, outputPath=excluded.outputPath,
       meta=excluded.meta, config=excluded.config, plan=excluded.plan,
       progress=excluded.progress, createdAt=excluded.createdAt`
  ).run({
    id: job.id,
    jobDir: job.jobDir,
    inputPath: job.inputPath,
    outputPath: job.outputPath,
    meta: JSON.stringify(job.meta),
    config: JSON.stringify(job.config),
    plan: JSON.stringify(job.plan),
    progress: JSON.stringify(job.progress),
    createdAt: job.createdAt,
  });
}

export function deleteOptimizationJobRow(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM optimization_jobs WHERE id = ?').run(id);
}
