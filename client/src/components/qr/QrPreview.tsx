/**
 * Live preview of the composed QR code, plus the export and verify actions.
 *
 * The preview draws straight into a canvas rather than an <img> with an object
 * URL, so rapid slider changes never queue up blobs to revoke. Stale renders
 * are discarded by comparing a monotonically increasing request id, which is
 * what stops a slow render from overwriting a newer one.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Download,
  FileImage,
  FileCode2,
  FileText,
  ScanLine,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { Button, LABEL_CLASS } from './QrPrimitives';
import type { QrStrings } from './qrStrings';
import type { QrDesign } from '../../services/qrDesign';
import {
  composeCanvas,
  copyPngToClipboard,
  downloadBlob,
  exportRaster,
  exportSvgBlob,
  safeFileName,
} from '../../services/qrExporter';
import { verifyScannable, isDensePayload, type ScanResult } from '../../services/qrVerify';

/** The exact inputs a verification ran against, so a later edit invalidates it. */
interface ScanStamp {
  payload: string;
  design: QrDesign;
  result: ScanResult;
}

interface QrPreviewProps {
  payload: string;
  design: QrDesign;
  payloadError: string | null;
  s: QrStrings;
  /** Name used for downloaded files. */
  fileName: string;
  onError: (message: string) => void;
  onToast: (message: string) => void;
  onOpenSheet: () => void;
  /** Payload echoed back after a successful decode check. */
  onVerified?: () => void;
}

export const QrPreview: React.FC<QrPreviewProps> = ({
  payload,
  design,
  payloadError,
  s,
  fileName,
  onError,
  onToast,
  onOpenSheet,
  onVerified,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderId = useRef(0);
  const [isExporting, setIsExporting] = useState(false);
  // The verification result is stamped with the exact payload and design object
  // it was computed from. Design updates are immutable, so comparing identities
  // invalidates the result on any edit without serialising the design — which
  // can hold a megabyte-sized logo data URL.
  const [lastScan, setLastScan] = useState<ScanStamp | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const renderable = Boolean(payload) && !payloadError;
  const scan =
    lastScan && lastScan.payload === payload && lastScan.design === design
      ? lastScan.result
      : null;

  // Redraw whenever the payload or any part of the design changes.
  useEffect(() => {
    if (!renderable) {
      // Clear rather than leave the previous code on screen, which would
      // misrepresent what would be exported.
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const id = ++renderId.current;
    let cancelled = false;

    void (async () => {
      try {
        const composed = await composeCanvas(payload, design);
        if (cancelled || id !== renderId.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = composed.width;
        canvas.height = composed.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(composed, 0, 0);
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : 'Could not render the code.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [payload, design, renderable, onError]);

  const withExporting = async (work: () => Promise<void>) => {
    setIsExporting(true);
    try {
      await work();
    } catch (err) {
      onError(err instanceof Error ? err.message : s.exportFailed);
    } finally {
      setIsExporting(false);
    }
  };

  const handlePng = () =>
    withExporting(async () => {
      const blob = await exportRaster(payload, design, 'png');
      downloadBlob(blob, safeFileName(fileName, 'png'));
    });

  const handleJpg = () =>
    withExporting(async () => {
      const blob = await exportRaster(payload, design, 'jpeg');
      downloadBlob(blob, safeFileName(fileName, 'jpg'));
    });

  const handleSvg = () =>
    withExporting(async () => {
      const blob = await exportSvgBlob(payload, design);
      downloadBlob(blob, safeFileName(fileName, 'svg'));
    });

  const handleCopy = () =>
    withExporting(async () => {
      const blob = await exportRaster(payload, design, 'png');
      const ok = await copyPngToClipboard(blob, safeFileName(fileName, 'png'));
      onToast(ok ? s.copied : 'Clipboard is unavailable — the image was downloaded instead.');
    });

  const handleScan = () =>
    withExporting(async () => {
      setIsScanning(true);
      try {
        const result = await verifyScannable(payload, design);
        setLastScan({ payload, design, result });
        if (result.decoded && result.matches) onVerified?.();
      } finally {
        setIsScanning(false);
      }
    });

  const dense = renderable && isDensePayload(payload);

  return (
    <div className="space-y-4 min-w-0">
      <span className={LABEL_CLASS}>{s.preview}</span>

      <div className="rounded-2xl border border-white/[0.08] bg-neutral-950/40 p-4 flex items-center justify-center min-h-[280px]">
        {renderable ? (
          <canvas
            ref={canvasRef}
            // The canvas backing store carries the real resolution; CSS scales
            // it down for display so the preview is crisp on any screen.
            className="max-w-full h-auto rounded-lg"
            style={{ maxHeight: 380 }}
          />
        ) : (
          <p className="text-xs text-neutral-500 text-center max-w-[220px]">
            {payloadError ?? s.emptyHint}
          </p>
        )}
      </div>

      {/* Scan verification result */}
      {scan && (
        <div
          className={`rounded-xl border p-2.5 flex items-start gap-2 text-[11px] leading-snug ${
            scan.decoded && scan.matches
              ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-300'
              : 'bg-red-500/10 border-red-400/25 text-red-300'
          }`}
          role="status"
          aria-live="polite"
        >
          {scan.decoded && scan.matches ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          )}
          <span>{scan.decoded && scan.matches ? s.scannable : scan.reason}</span>
        </div>
      )}

      {dense && !scan?.decoded && (
        <p className="text-[11px] text-amber-300 flex items-start gap-1.5 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {s.densePayload}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={handlePng} disabled={!renderable || isExporting}>
          <FileImage className="w-3.5 h-3.5 inline mr-1.5" />
          {s.exportPng}
        </Button>
        <Button onClick={handleJpg} disabled={!renderable || isExporting}>
          <FileImage className="w-3.5 h-3.5 inline mr-1.5" />
          {s.exportJpg}
        </Button>
        <Button onClick={handleSvg} disabled={!renderable || isExporting}>
          <FileCode2 className="w-3.5 h-3.5 inline mr-1.5" />
          {s.exportSvg}
        </Button>
        <Button onClick={handleCopy} disabled={!renderable || isExporting}>
          <Copy className="w-3.5 h-3.5 inline mr-1.5" />
          {s.copyImage}
        </Button>
        <Button onClick={onOpenSheet} disabled={!renderable || isExporting}>
          <FileText className="w-3.5 h-3.5 inline mr-1.5" />
          {s.exportPdf}
        </Button>
        <Button onClick={handleScan} disabled={!renderable || isExporting}>
          {isScanning ? (
            <Loader2 className="w-3.5 h-3.5 inline mr-1.5 animate-spin" />
          ) : (
            <ScanLine className="w-3.5 h-3.5 inline mr-1.5" />
          )}
          {isScanning ? s.scanning : s.scanCheck}
        </Button>
      </div>

      {isExporting && !isScanning && (
        <p className="text-[11px] text-neutral-500 flex items-center gap-1.5">
          <Download className="w-3 h-3" />
          {s.preview}…
        </p>
      )}
    </div>
  );
};
