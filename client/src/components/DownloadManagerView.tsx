import React, { useState, useEffect } from 'react';
import {
  Download,
  Pause,
  Play,
  XCircle,
  Trash2,
  RefreshCw,
  Film,
  Music,
  Layers,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import type { MediaJobRecord } from '../types';
import { playerStore } from '../services/player';
import {
  fetchMediaJobs,
  pauseMediaJob,
  resumeMediaJob,
  cancelMediaJob,
  deleteMediaJob,
} from '../services/api';

interface DownloadManagerViewProps {
  onSendToOptimizer?: (filePath: string, name: string) => void;
}

export const DownloadManagerView: React.FC<DownloadManagerViewProps> = ({
  onSendToOptimizer,
}) => {
  const [jobs, setJobs] = useState<MediaJobRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      const data = await fetchMediaJobs();
      setJobs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 4000);
    return () => clearInterval(interval);
  }, []);

  const handlePause = async (id: string) => {
    await pauseMediaJob(id);
    loadJobs();
  };

  const handleResume = async (id: string) => {
    await resumeMediaJob(id);
    loadJobs();
  };

  const handleCancel = async (id: string) => {
    await cancelMediaJob(id);
    loadJobs();
  };

  const handleDelete = async (id: string) => {
    await deleteMediaJob(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(1)} MB`;
  };

  const getStatusPill = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-white/10 text-white border border-white/20 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Completed
          </span>
        );
      case 'DOWNLOADING':
      case 'CONVERTING':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-white/10 text-white border border-white/20 flex items-center gap-1 animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {status}
          </span>
        );
      case 'PAUSED':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-white/10 text-white border border-white/20">
            Paused
          </span>
        );
      case 'FAILED':
      case 'CANCELLED':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-white/10 text-white border border-white/20">
            {status}
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-neutral-500/10 text-neutral-400 border border-neutral-500/20">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-indigo-300 bg-indigo-500/10 border-indigo-500/30 text-xs font-semibold uppercase tracking-wider mb-1">
            <Download className="w-3.5 h-3.5" />
            Active Tasks
          </div>
          <h2 className="text-2xl font-extrabold text-indigo-300 tracking-tight">Central Download Manager</h2>
          <p className="text-xs text-neutral-400">
            Monitor real-time download speed, resume partial files, or send directly to the optimizer pipeline.
          </p>
        </div>

        <button
          onClick={loadJobs}
          className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-neutral-200 transition-all flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Jobs List */}
      {jobs.length === 0 ? (
        <div className="glass-panel p-12 rounded-2xl border border-white/5 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-white/5 flex items-center justify-center text-neutral-500">
            <Download className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">No Active or Recent Downloads</h3>
          <p className="text-xs text-neutral-400 max-w-sm mx-auto">
            Analyze any media URL or initiate an audio/video extraction to track jobs here. Unlimited downloads with automatic cleanup.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="glass-panel p-5 rounded-2xl border border-white/[0.08] hover:border-white/20 transition-all space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-white shrink-0">
                    {job.type === 'audio' ? (
                      <Music className="w-5 h-5" />
                    ) : job.type === 'image' ? (
                      <Layers className="w-5 h-5" />
                    ) : (
                      <Film className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white truncate max-w-md">{job.filename}</h4>
                    <p className="text-[11px] font-mono text-neutral-400 truncate max-w-sm">
                      {job.sourceUrl || 'Local Processing Job'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {getStatusPill(job.progress.status)}
                  <span className="text-xs font-mono text-white font-bold">
                    {job.progress.percent}%
                  </span>
                </div>
              </div>

              {/* Progress Bar & Telemetry */}
              <div className="space-y-1.5">
                <div className="w-full h-1.5 bg-neutral-900 rounded-full overflow-hidden border border-white/5">
                  <div
                    className="h-full bg-gradient-to-r from-white to-neutral-400 transition-all duration-300 rounded-full"
                    style={{ width: `${job.progress.percent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                  <span>
                    {formatBytes(job.progress.downloadedBytes)} / {formatBytes(job.progress.totalBytes)}
                  </span>
                  {job.progress.status === 'DOWNLOADING' && (
                    <span className="text-white">{job.progress.speedFormatted || '0 MB/s'}</span>
                  )}
                  <span>{job.progress.stageName}</span>
                </div>
              </div>

              {/* Actions Toolbar */}
              <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {job.progress.status === 'DOWNLOADING' && (
                    <button
                      onClick={() => handlePause(job.id)}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-neutral-300 flex items-center gap-1"
                    >
                      <Pause className="w-3 h-3" />
                      Pause
                    </button>
                  )}

                  {job.progress.status === 'PAUSED' && (
                    <button
                      onClick={() => handleResume(job.id)}
                      className="px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-xs text-white font-semibold flex items-center gap-1"
                    >
                      <Play className="w-3 h-3" />
                      Resume
                    </button>
                  )}

                  {['DOWNLOADING', 'QUEUED'].includes(job.progress.status) && (
                    <button
                      onClick={() => handleCancel(job.id)}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-white flex items-center gap-1"
                    >
                      <XCircle className="w-3 h-3" />
                      Cancel
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(job.id)}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-neutral-400 hover:text-white flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>

                {job.progress.status === 'COMPLETED' && (
                  <div className="flex flex-col gap-2">
                    {previewJobId === job.id && job.type === 'video' && (
                      <div className="rounded-xl overflow-hidden border border-white/10 bg-black/60">
                        <video
                          controls
                          autoPlay
                          className="w-full max-h-64"
                          src={`/api/media/jobs/${job.id}/preview`}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <a
                        href={`/api/media/jobs/${job.id}/download`}
                        download
                        className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-neutral-200 text-black text-xs font-bold transition-all shadow-md shadow-white/20 flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Save File
                      </a>

                      {job.type === 'audio' && (
                        <button
                          onClick={() =>
                            playerStore.addAndPlay({
                              id: job.id,
                              title: job.filename,
                              url: `/api/media/jobs/${job.id}/preview`,
                              creator: job.sourceUrl ? String(job.sourceUrl).replace(/^https?:\/\//, '').split('/')[0] : undefined,
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/40 text-fuchsia-300 text-xs font-medium transition-all flex items-center gap-1"
                        >
                          <Play className="w-3 h-3" />
                          Play
                        </button>
                      )}

                      {job.type === 'video' && (
                        <button
                          onClick={() =>
                            setPreviewJobId(previewJobId === job.id ? null : job.id)
                          }
                          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-neutral-200 transition-all flex items-center gap-1"
                        >
                          <Film className="w-3 h-3 text-white" />
                          {previewJobId === job.id ? 'Hide Preview' : 'Preview'}
                        </button>
                      )}

                      {job.type === 'video' && onSendToOptimizer && (
                        <button
                          onClick={() =>
                            onSendToOptimizer(
                              `storage/media-tools/${job.id}/output/${job.filename}`,
                              job.filename
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-neutral-200 transition-all flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3 text-white" />
                          Send to Optimizer
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


