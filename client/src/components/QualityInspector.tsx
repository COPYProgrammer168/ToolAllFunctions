import React from 'react';
import { Info, FileVideo, Cpu } from 'lucide-react';
import type { VideoMetadata, QualityValidationReport } from '../types';

interface QualityInspectorProps {
  metadata?: VideoMetadata;
  validation?: QualityValidationReport;
  outputSize?: number;
}

export const QualityInspector: React.FC<QualityInspectorProps> = ({ metadata, validation }) => {
  const formatBitrate = (bps?: number) => {
    if (!bps) return 'N/A';
    const mbps = bps / 1_000_000;
    return mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${(bps / 1000).toFixed(0)} kbps`;
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="glass-panel rounded-2xl border border-white/[0.08] overflow-hidden">
      <div className="p-5 border-b border-white/5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
          <Info className="w-4 h-4 text-white" />
          Quality Inspector
        </h3>
      </div>

      <div className="p-5 space-y-4">
        {metadata && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              <FileVideo className="w-3.5 h-3.5 text-white" />
              Source Video
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <InfoRow label="Resolution" value={`${metadata.width} × ${metadata.height}`} />
              <InfoRow label="FPS" value={`${metadata.fps} ${metadata.isVfr ? '(VFR)' : ''}`} />
              <InfoRow label="Codec" value={metadata.codecLongName} />
              <InfoRow label="Bitrate" value={formatBitrate(metadata.bitrate)} />
              <InfoRow label="Duration" value={`${Math.round(metadata.duration)}s`} />
              <InfoRow label="Pixel Format" value={metadata.pixelFormat} />
              <InfoRow label="Color" value={metadata.isHdr ? 'HDR' : 'SDR'} />
              <InfoRow label="Aspect Ratio" value={metadata.aspectRatio} />
              {metadata.audioCodec && (
                <>
                  <InfoRow label="Audio Codec" value={metadata.audioCodec} />
                  <InfoRow label="Audio Rate" value={`${metadata.audioSampleRate} Hz`} />
                  <InfoRow label="Channels" value={String(metadata.audioChannels)} />
                </>
              )}
            </div>
          </div>
        )}

        {validation && (
          <div className="space-y-3 pt-3 border-t border-white/5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              <Cpu className="w-3.5 h-3.5 text-white" />
              Output Validation
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <InfoRow label="Resolution" value={validation.outputResolution} />
              <InfoRow label="FPS" value={String(validation.outputFps)} />
              <InfoRow label="Codec" value={validation.outputCodec} />
              <InfoRow label="Duration" value={`${validation.outputDuration}s`} />
              <InfoRow label="Audio Sync" value={validation.audioSynced ? 'Synced ✓' : 'Drift ⚠'} />
              <InfoRow label="File Size" value={formatSize(validation.fileSizeBytes)} />
              {validation.durationDiffSec > 0 && (
                <InfoRow label="Duration Δ" value={`${validation.durationDiffSec.toFixed(2)}s`} />
              )}
            </div>
            {validation.warnings.length > 0 && (
              <div className="space-y-1.5 pt-2">
                {validation.warnings.map((w: string, i: number) => (
                  <div key={i} className="text-xs text-neutral-200 bg-white/5 border border-white/20 rounded-lg px-3 py-1.5">
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.04]">
    <div className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</div>
    <div className="text-xs font-mono text-neutral-200 mt-0.5 truncate" title={value}>{value}</div>
  </div>
);

