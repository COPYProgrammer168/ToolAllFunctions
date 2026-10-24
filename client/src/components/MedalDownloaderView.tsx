import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Download,
  ExternalLink,
  Film,
  Gamepad2,
  HardDrive,
  Languages,
  Link2,
  Loader2,
  Medal,
  RotateCcw,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { cancelMedalDownload, getMedalJob, inspectMedalClip, medalDownloadUrl, startMedalDownload } from '../services/api';
import { MediaApiError } from '../services/api';
import type { MedalInspection, MedalJobState, MedalJobStatus } from '../types';
import { MEDAL_UNAVAILABLE_MESSAGE, medalStrings, type MedalLang } from './medal/medalStrings';

const TERMINAL_STATES: ReadonlySet<MedalJobState> = new Set([
  'done',
  'failed',
  'cancelled',
  'download_not_available',
]);

const ACTIVE_STATES: ReadonlySet<MedalJobState> = new Set([
  'queued',
  'inspecting',
  'downloading',
]);

function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes: number | undefined, unknown: string): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return unknown;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function looksLikeMedalUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'medal.tv' || parsed.hostname === 'www.medal.tv')
    );
  } catch {
    return false;
  }
}

export const MedalDownloaderView: React.FC = () => {
  const [lang, setLang] = useState<MedalLang>('en');
  const s = useMemo(() => medalStrings(lang), [lang]);

  const [url, setUrl] = useState('');
  const [inspection, setInspection] = useState<MedalInspection | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [authorized, setAuthorized] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [job, setJob] = useState<MedalJobStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);

  // SEO title and meta description, restored when the view unmounts.
  useEffect(() => {
    const originalTitle = document.title;
    document.title = 'Medal.tv Video Downloader | AI Video Optimizer';

    let metaDesc = document.querySelector('meta[name="description"]');
    const originalDesc = metaDesc?.getAttribute('content') || '';
    let created = false;
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
      created = true;
    }
    metaDesc.setAttribute(
      'content',
      'Download available Medal.tv gaming clips. Inspect a public Medal clip and save the original MP4 when Medal exposes it.'
    );

    return () => {
      document.title = originalTitle;
      if (created) metaDesc?.remove();
      else if (metaDesc && originalDesc) metaDesc.setAttribute('content', originalDesc);
    };
  }, []);

  // Poll only real job state. The percentage is never invented locally.
  useEffect(() => {
    if (!jobId || !downloadToken) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const poll = async () => {
      try {
        const next = await getMedalJob(jobId, downloadToken);
        if (cancelled) return;
        failures = 0;
        setJob(next);
        setError(null);
        if (TERMINAL_STATES.has(next.state)) return;
      } catch (err) {
        if (cancelled) return;
        if (err instanceof MediaApiError && err.status === 404) {
          setError(s.jobExpired);
          return;
        }
        if (err instanceof MediaApiError && err.status === 403) {
          setError(s.unauthorized);
          return;
        }
        failures += 1;
        const seconds = err instanceof MediaApiError && err.isRateLimited ? err.retryAfter || 10 : Math.min(2 ** failures, 10);
        setError(
          err instanceof MediaApiError && err.isRateLimited
            ? s.rateLimited.replace('{seconds}', String(seconds))
            : s.requestFailed
        );
        timer = setTimeout(poll, seconds * 1000);
        return;
      }

      timer = setTimeout(poll, 1500);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, downloadToken, s]);

  const handleInspect = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError(null);

    if (!looksLikeMedalUrl(url)) {
      setError(s.invalidUrl);
      return;
    }

    setIsInspecting(true);
    setInspection(null);
    setJob(null);
    setJobId(null);
    setDownloadToken(null);
    setAuthorized(false);

    try {
      const result = await inspectMedalClip(url.trim());
      setInspection(result);
      if (!result.download.available) setAuthorized(false);
    } catch (err) {
      if (err instanceof MediaApiError && err.isRateLimited) {
        setError(s.rateLimited.replace('{seconds}', String(err.retryAfter || 60)));
      } else {
        setError(err instanceof Error && err.message ? err.message : s.requestFailed);
      }
    } finally {
      setIsInspecting(false);
    }
  };

  const handleStartDownload = async () => {
    if (!inspection?.download.available) return;
    if (!authorized) {
      setError(s.authorizationRequired);
      return;
    }

    setError(null);
    setIsStarting(true);

    try {
      const started = await startMedalDownload(url.trim());
      setJobId(started.jobId);
      setDownloadToken(started.downloadToken);
      setJob({
        jobId: started.jobId,
        state: 'queued',
        stage: s.stateQueued,
        createdAt: started.createdAt,
        updatedAt: started.createdAt,
        expiresAt: started.expiresAt,
        clip: inspection.clip,
        progress: { percent: null, downloadedBytes: 0, totalBytes: 0 },
      });
    } catch (err) {
      if (err instanceof MediaApiError && err.isRateLimited) {
        setError(s.rateLimited.replace('{seconds}', String(err.retryAfter || 60)));
      } else {
        setError(err instanceof Error && err.message ? err.message : s.requestFailed);
      }
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!jobId || !downloadToken) return;
    const cancelled = await cancelMedalDownload(jobId, downloadToken);
    if (cancelled) {
      setJob((current) =>
        current
          ? {
              ...current,
              state: 'cancelled',
              stage: s.stateCancelled,
              progress: { ...current.progress, percent: null },
            }
          : current
      );
    }
  };

  const stateLabel = (state: MedalJobState): string => {
    switch (state) {
      case 'queued':
        return s.stateQueued;
      case 'inspecting':
        return s.stateInspecting;
      case 'downloading':
        return s.stateDownloading;
      case 'done':
        return s.stateDone;
      case 'failed':
        return s.stateFailed;
      case 'cancelled':
        return s.stateCancelled;
      case 'download_not_available':
        return s.stateUnavailable;
    }
  };

  const jobActive = job ? ACTIVE_STATES.has(job.state) : false;
  const percent = job?.progress.percent;
  const downloaded = job?.progress.downloadedBytes || 0;
  const totalBytes = job?.progress.totalBytes || 0;

  const detailRows: { label: string; value: string }[] = [];
  if (inspection) {
    const clip = inspection.clip;
    if (clip.creator) detailRows.push({ label: s.creator, value: clip.creator });
    if (clip.gameName) detailRows.push({ label: s.game, value: clip.gameName });
    if (clip.durationSeconds) {
      detailRows.push({ label: s.duration, value: formatDuration(clip.durationSeconds) });
    }
    if (clip.uploadedAt) {
      detailRows.push({
        label: s.uploaded,
        value: new Date(clip.uploadedAt).toLocaleDateString(lang === 'kh' ? 'km-KH' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
      });
    }
    detailRows.push({
      label: s.format,
      value: inspection.download.available ? s.originalFormat : '—',
    });
    detailRows.push({
      label: s.size,
      value: formatBytes(inspection.download.sizeBytes, s.unknownSize),
    });
    detailRows.push({ label: s.clipId, value: clip.clipId });
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl text-white flex items-center gap-2">
            <Medal className="w-6 h-6 text-amber-400" />
            {s.title}
          </h1>
          <p className="text-xs text-neutral-400 mt-1 max-w-2xl leading-relaxed">{s.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'kh' : 'en')}
          className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 flex items-center gap-2 transition-all"
          title="Language"
        >
          <Languages className="w-3.5 h-3.5" />
          {s.languageButton}
        </button>
      </div>

      <form onSubmit={handleInspect} noValidate className="glass-panel p-4 sm:p-5 rounded-2xl border border-white/[0.08] space-y-3">
        <label htmlFor="medal-url" className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
          <Link2 className="w-3.5 h-3.5 text-amber-400" />
          {s.urlLabel}
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="medal-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={s.urlPlaceholder}
            className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/10 font-mono"
          />
          <button
            type="submit"
            disabled={isInspecting || !url.trim()}
            className="px-5 py-3 rounded-xl bg-amber-400/90 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-950 text-sm font-bold flex items-center justify-center gap-2 transition-all shrink-0"
          >
            {isInspecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Medal className="w-4 h-4" />}
            {isInspecting ? s.inspecting : s.inspect}
          </button>
        </div>
        <p className="text-[11px] text-neutral-500 leading-relaxed">{s.officialNote}</p>
      </form>

      {error && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs leading-relaxed" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!inspection && !isInspecting && (
        <div className="glass-panel p-8 rounded-2xl border border-white/[0.08] text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
            <Gamepad2 className="w-6 h-6 text-amber-300" />
          </div>
          <p className="text-sm text-neutral-400">{s.noClip}</p>
          <p className="text-[11px] text-neutral-600 max-w-lg mx-auto leading-relaxed">{s.privacyNote}</p>
        </div>
      )}

      {isInspecting && (
        <div className="glass-panel p-8 rounded-2xl border border-white/[0.08] text-center space-y-3" aria-live="polite">
          <Loader2 className="w-7 h-7 mx-auto text-amber-300 animate-spin" />
          <p className="text-sm text-neutral-300">{s.inspecting}</p>
        </div>
      )}

      {inspection && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-w-0">
          <div className="lg:col-span-7 glass-panel rounded-2xl border border-white/[0.08] overflow-hidden min-w-0">
            <div className="relative w-full aspect-video bg-black/60 border-b border-white/5">
              {inspection.clip.thumbnailUrl ? (
                <img
                  src={inspection.clip.thumbnailUrl}
                  alt={s.previewAlt}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Film className="w-10 h-10 text-neutral-700" />
                </div>
              )}
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 border border-white/10 text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-200">
                <Download className="w-3 h-3" />
                {inspection.download.available ? s.originalQuality : s.downloadUnavailable}
              </div>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-white leading-snug break-words">{inspection.clip.title}</h2>
                {inspection.clip.creator && (
                  <p className="text-xs text-neutral-400 mt-1 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    {inspection.clip.creator}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {detailRows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 py-2 border-b border-white/5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">{row.label}</span>
                    <span className="text-xs text-neutral-200 text-right break-all">{row.value}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={inspection.clip.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-neutral-200 inline-flex items-center gap-1.5 transition-all"
                >
                  {s.openOnMedal}
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={inspection.officialWorkflowUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-neutral-200 inline-flex items-center gap-1.5 transition-all"
                >
                  {s.openGuide}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-4 min-w-0">
            {inspection.download.available ? (
              <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-emerald-500/20 space-y-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="w-5 h-5" />
                  <h2 className="text-sm font-bold">{s.downloadAvailable}</h2>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-neutral-400 leading-relaxed">
                  <HardDrive className="w-4 h-4 shrink-0 text-emerald-400/80 mt-0.5" />
                  <span>{s.originalQualityHint}</span>
                </div>

                <div className="pt-3 border-t border-white/5 space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-300" />
                    {s.authorizationHeading}
                  </h3>
                  <label htmlFor="medal-authorized" className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      id="medal-authorized"
                      type="checkbox"
                      checked={authorized}
                      onChange={(event) => setAuthorized(event.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-amber-400 shrink-0"
                    />
                    <span className="text-xs text-neutral-200 leading-relaxed">{s.authorizationLabel}</span>
                  </label>
                  <p className="text-[10px] text-neutral-500 leading-relaxed">{s.authorizationHint}</p>
                  <button
                    type="button"
                    onClick={handleStartDownload}
                    disabled={!authorized || isStarting || jobActive}
                    className="w-full py-3 rounded-xl bg-amber-400/90 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-neutral-950 text-sm font-bold flex items-center justify-center gap-2 transition-all"
                  >
                    {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {isStarting ? s.starting : s.startDownload}
                  </button>
                </div>
              </div>
            ) : (
              <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] space-y-3">
                <div className="flex items-center gap-2 text-amber-300">
                  <AlertTriangle className="w-5 h-5" />
                  <h2 className="text-sm font-bold">{s.downloadUnavailable}</h2>
                </div>
                <p className="text-xs text-neutral-200 leading-relaxed">{MEDAL_UNAVAILABLE_MESSAGE}</p>
                {lang === 'kh' && (
                  <p className="text-[11px] text-neutral-400 leading-relaxed">{s.unavailableKhmer}</p>
                )}
                <p className="text-[10px] text-neutral-500 leading-relaxed">{s.officialNote}</p>
                <div className="flex flex-col gap-2 pt-1">
                  <a
                    href={inspection.clip.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 rounded-xl bg-amber-400/90 hover:bg-amber-300 text-neutral-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-all"
                  >
                    {s.openOnMedal}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href={inspection.officialWorkflowUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 inline-flex items-center justify-center gap-1.5 transition-all"
                  >
                    {s.openGuide}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}

            {job && (
              <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-white/[0.08] space-y-3" aria-live="polite">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-white">{s.jobHeading}</h2>
                  <span className="text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 border border-white/10 text-neutral-300">
                    {stateLabel(job.state)}
                  </span>
                </div>

                {job.state === 'done' ? (
                  <>
                    <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      {s.ready}
                    </p>
                    {job.media && (
                      <div className="grid grid-cols-2 gap-x-3">
                        <JobStat label={s.resolution} value={`${job.media.width}×${job.media.height}`} />
                        <JobStat label="FPS" value={String(job.media.fps || '—')} />
                        <JobStat label={s.duration} value={formatDuration(job.media.durationSeconds)} />
                        <JobStat label={s.size} value={formatBytes(job.media.sizeBytes, s.unknownSize)} />
                        <JobStat label="Video" value={job.media.videoCodec.toUpperCase()} />
                        <JobStat label="Audio" value={job.media.audioCodec ? job.media.audioCodec.toUpperCase() : '—'} />
                      </div>
                    )}
                    {downloadToken && (
                      <a
                        href={medalDownloadUrl(job.jobId, downloadToken)}
                        download={job.filename}
                        className="w-full py-3 rounded-xl bg-white hover:bg-neutral-200 text-black text-sm font-bold flex items-center justify-center gap-2 transition-all"
                      >
                        <Download className="w-4 h-4" />
                        {s.downloadFile}
                      </a>
                    )}
                  </>
                ) : job.state === 'download_not_available' ? (
                  <>
                    <p className="text-xs text-neutral-200 leading-relaxed">{MEDAL_UNAVAILABLE_MESSAGE}</p>
                    {lang === 'kh' && (
                      <p className="text-[11px] text-neutral-400 leading-relaxed">{s.unavailableKhmer}</p>
                    )}
                    <a
                      href={inspection.officialWorkflowUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-2.5 rounded-xl bg-amber-400/90 hover:bg-amber-300 text-neutral-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-all"
                    >
                      {s.openGuide}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </>
                ) : (
                  <>
                    {jobActive && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
                          <span>{percent === null ? s.progressUnknown : `${percent}%`}</span>
                          {totalBytes > 0 && (
                            <span>
                              {formatBytes(downloaded, s.unknownSize)} {s.of} {formatBytes(totalBytes, s.unknownSize)}
                            </span>
                          )}
                        </div>
                        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400 transition-all ${
                              percent === null ? 'w-1/3 animate-pulse' : ''
                            }`}
                            style={percent === null ? undefined : { width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {job.error ? (
                      <p className="text-[11px] text-rose-300 leading-relaxed">{job.error}</p>
                    ) : (
                      <p className="text-[11px] text-neutral-400 leading-relaxed">{job.stage}</p>
                    )}

                    {jobActive ? (
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-300 flex items-center justify-center gap-1.5 transition-all"
                      >
                        <X className="w-3.5 h-3.5" />
                        {s.cancel}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleInspect()}
                        className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-300 flex items-center justify-center gap-1.5 transition-all"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {s.retry}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="p-3.5 rounded-xl bg-neutral-900/50 border border-white/5 flex items-start gap-2">
              <Calendar className="w-3.5 h-3.5 text-neutral-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-neutral-500 leading-relaxed">{s.privacyNote}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const JobStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="py-1.5 border-b border-white/5">
    <p className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">{label}</p>
    <p className="text-[11px] text-neutral-200 mt-0.5 break-all">{value}</p>
  </div>
);
