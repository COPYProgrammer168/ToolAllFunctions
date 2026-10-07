import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import { nanoid } from 'nanoid';
import type { VideoMetadata, JobConfig, JobProgress, JobState } from '../types/index.js';
import { VideoAnalyzer } from './VideoAnalyzer.js';
import { OptimizationPlanner, type PlannedPipeline } from './OptimizationPlanner.js';
import { FFmpegService } from './FFmpegService.js';
import { QualityValidator } from './QualityValidator.js';
import { HardwareDetector } from './HardwareDetector.js';
import { STORAGE_ROOT } from '../utils/paths.js';

const BASE_STORAGE_DIR = STORAGE_ROOT;

export interface JobRecord {
  id: string;
  jobDir: string;
  inputPath: string;
  outputPath: string;
  meta: VideoMetadata;
  config: JobConfig;
  plan: PlannedPipeline;
  progress: JobProgress;
  createdAt: number;
}

export class JobManager {
  private static jobs = new Map<string, JobRecord>();
  private static listeners = new Map<string, Set<Response>>();
  private static ffmpegService = new FFmpegService();

  public static async init() {
    await fs.mkdir(BASE_STORAGE_DIR, { recursive: true });
    await fs.mkdir(path.join(BASE_STORAGE_DIR, 'uploads'), { recursive: true });
    await fs.mkdir(path.join(BASE_STORAGE_DIR, 'jobs'), { recursive: true });

    // Periodic cleanup of jobs older than 2 hours
    setInterval(() => {
      this.cleanupOldJobs();
    }, 15 * 60 * 1000);
  }

  public static async createJob(
    uploadedFilePath: string,
    originalName: string,
    userConfig: Partial<JobConfig>
  ): Promise<JobRecord> {
    const jobId = nanoid(10);
    const jobDir = path.join(BASE_STORAGE_DIR, 'jobs', jobId);
    await fs.mkdir(jobDir, { recursive: true });

    // Move uploaded file into jobDir
    const inputExt = path.extname(originalName) || '.mp4';
    const inputPath = path.join(jobDir, `source${inputExt}`);
    await fs.rename(uploadedFilePath, inputPath);

    // Initial state: ANALYZING
    const initialProgress: JobProgress = {
      state: 'ANALYZING',
      percent: 0,
      stageName: 'Analyzing source video metadata and bitstreams',
      currentFrame: 0,
      totalFrames: 0,
      fps: 0,
      speed: '0x',
      timeRemainingSec: 0,
      warnings: [],
      inputSize: (await fs.stat(inputPath)).size,
    };

    // Analyze video
    const report = await VideoAnalyzer.analyze(inputPath, originalName);
    const hwInfo = await HardwareDetector.detect();

    // Plan optimization
    const plan = OptimizationPlanner.plan(report.metadata, userConfig, hwInfo.hasNvidiaGpu);
    const outputPath = path.join(jobDir, `optimized_${jobId}.mp4`);

    const totalEstimatedFrames = Math.round(
      (plan.config.isPreview ? Math.min(report.metadata.duration, 5) : report.metadata.duration) *
      (plan.filters.targetFps || report.metadata.fps)
    );

    initialProgress.state = 'PLANNING';
    initialProgress.totalFrames = totalEstimatedFrames;
    initialProgress.warnings = plan.warnings;

    const jobRecord: JobRecord = {
      id: jobId,
      jobDir,
      inputPath,
      outputPath,
      meta: report.metadata,
      config: plan.config,
      plan,
      progress: initialProgress,
      createdAt: Date.now(),
    };

    this.jobs.set(jobId, jobRecord);
    return jobRecord;
  }

  public static getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  public static subscribe(jobId: string, res: Response) {
    if (!this.listeners.has(jobId)) {
      this.listeners.set(jobId, new Set());
    }
    const set = this.listeners.get(jobId)!;
    set.add(res);

    // Send current state immediately
    const job = this.jobs.get(jobId);
    if (job) {
      res.write(`data: ${JSON.stringify(job.progress)}\n\n`);
    }

    res.on('close', () => {
      set.delete(res);
      if (set.size === 0) {
        this.listeners.delete(jobId);
      }
    });
  }

  public static broadcast(jobId: string, progress: JobProgress) {
    const set = this.listeners.get(jobId);
    if (set) {
      const payload = `data: ${JSON.stringify(progress)}\n\n`;
      for (const res of set) {
        res.write(payload);
      }
    }
  }

  public static updateProgress(jobId: string, partial: Partial<JobProgress>) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.progress = { ...job.progress, ...partial };
    this.broadcast(jobId, job.progress);
  }

  public static async startJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('Job not found');

    // Run async in background
    (async () => {
      try {
        this.updateProgress(jobId, {
          state: 'PROCESSING',
          stageName: 'Initializing video processing pipeline',
          percent: 5,
        });

        await this.ffmpegService.processVideo(
          jobId,
          job.inputPath,
          job.outputPath,
          job.meta,
          job.plan,
          (prog) => {
            this.updateProgress(jobId, prog);
          }
        );

        // Quality Validation
        this.updateProgress(jobId, {
          state: 'VALIDATING',
          stageName: 'Validating output visual integrity and audio synchronization',
          percent: 97,
        });

        const validation = await QualityValidator.validate(
          job.outputPath,
          job.meta,
          job.config.isPreview
        );

        const outStat = await fs.stat(job.outputPath);

        this.updateProgress(jobId, {
          state: 'COMPLETED',
          percent: 100,
          stageName: 'Optimization successfully completed',
          outputPath: job.outputPath,
          outputUrl: `/api/jobs/${jobId}/download`,
          outputSize: outStat.size,
          validationReport: validation,
          timeRemainingSec: 0,
        });
      } catch (err: any) {
        if (err.isCancelled) {
          this.updateProgress(jobId, {
            state: 'CANCELLED',
            stageName: 'Optimization cancelled by user',
            error: 'Process cancelled',
          });
          await this.cleanJobOutput(job);
        } else {
          console.error(`Job ${jobId} failed:`, err);
          this.updateProgress(jobId, {
            state: 'FAILED',
            stageName: 'Processing failed',
            error: 'The selected enhancement pipeline could not process this video. Try Fast Optimize or Preserve Original.',
            technicalError: err.message,
          });
        }
      }
    })();
  }

  public static async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    const cancelled = this.ffmpegService.cancel(jobId);
    this.updateProgress(jobId, {
      state: 'CANCELLED',
      stageName: 'Optimization cancelled by user',
      error: 'Job cancelled by user',
    });

    await this.cleanJobOutput(job);
    return cancelled;
  }

  public static async deleteJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    this.ffmpegService.cancel(jobId);
    try {
      await fs.rm(job.jobDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Error removing job dir for ${jobId}:`, err);
    }
    this.jobs.delete(jobId);
    this.listeners.delete(jobId);
    return true;
  }

  private static async cleanJobOutput(job: JobRecord) {
    try {
      await fs.unlink(job.outputPath);
    } catch {}
  }

  private static async cleanupOldJobs() {
    const now = Date.now();
    const twoHoursMs = 2 * 60 * 60 * 1000;

    for (const [id, job] of this.jobs.entries()) {
      if (now - job.createdAt > twoHoursMs) {
        await this.deleteJob(id);
      }
    }
  }
}
