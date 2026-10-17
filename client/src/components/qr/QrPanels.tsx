/**
 * Batch generation, the saved-code library, and the printable PDF sheet.
 *
 * All three are modal-style panels sharing the app's existing modal pattern
 * (`MediaSettingsModal`): a fixed overlay with a scrollable card. They are kept
 * in one file because each is small and they are only ever opened from the
 * preview toolbar.
 */

import React, { useMemo, useState } from 'react';
import { X, Loader2, Star, Trash2, FileText, Package, Download } from 'lucide-react';
import { Button, Field, LABEL_CLASS, TextArea, SelectInput, Toggle, INPUT_CLASS } from './QrPrimitives';
import type { QrStrings } from './qrStrings';
import type { QrDesign, SavedQr } from '../../services/qrDesign';
import { buildBatchZip, batchToCsv, parseBatchList } from '../../services/qrBatch';
import { buildQrSheet, DEFAULT_SHEET_OPTIONS, type SheetOptions } from '../../services/qrPdfSheet';
import { downloadBlob } from '../../services/qrExporter';

const OVERLAY =
  'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md';
const CARD = 'glass-panel rounded-2xl border border-white/[0.08] w-full max-w-2xl max-h-[88vh] flex flex-col';
const HEADER =
  'flex items-center justify-between gap-4 px-5 py-4 border-b border-white/[0.06] shrink-0';

const ModalShell: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}> = ({ title, onClose, children, width }) => (
  <div className={OVERLAY} role="dialog" aria-modal="true" aria-label={title}>
    <div className={`${CARD} ${width ?? ''}`}>
      <div className={HEADER}>
        <h3 className="font-display text-sm text-white">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5 overflow-y-auto min-w-0">{children}</div>
    </div>
  </div>
);

/* ── Batch ───────────────────────────────────────────────────────────────── */

interface BatchPanelProps {
  design: QrDesign;
  s: QrStrings;
  onClose: () => void;
  onError: (message: string) => void;
  onToast: (message: string) => void;
}

export const BatchPanel: React.FC<BatchPanelProps> = ({ design, s, onClose, onError, onToast }) => {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const entries = useMemo(() => parseBatchList(input), [input]);

  const handleGenerate = async () => {
    if (entries.length === 0) {
      onError('Add at least one URL or line.');
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: entries.length });
    try {
      const zip = await buildBatchZip(entries, design, (done, total) => setProgress({ done, total }));
      downloadBlob(zip, 'qr-codes.zip');
      onToast(`${entries.length} codes generated.`);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Batch generation failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleCsv = () => {
    if (entries.length === 0) {
      onError('Nothing to export yet.');
      return;
    }
    downloadBlob(new Blob([batchToCsv(entries)], { type: 'text/csv;charset=utf-8' }), 'qr-codes.csv');
  };

  return (
    <ModalShell title={s.batch} onClose={onClose}>
      <div className="space-y-4">
        <TextArea
          label={s.batch}
          value={input}
          onChange={setInput}
          placeholder={s.batchPlaceholder}
          rows={8}
          mono
          hint={s.batchHelp}
        />

        <p className="text-xs text-neutral-400">
          <span className="font-bold text-white">{entries.length}</span> {s.entriesFound}
        </p>

        {progress && (
          <div className="space-y-1.5">
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-purple-400 transition-all"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-neutral-400">
              {progress.done} / {progress.total}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end">
          <Button onClick={handleCsv} disabled={busy}>
            <Download className="w-3.5 h-3.5 inline mr-1.5" />
            {s.batchCsv}
          </Button>
          <Button variant="primary" onClick={handleGenerate} disabled={busy}>
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 inline mr-1.5 animate-spin" />
            ) : (
              <Package className="w-3.5 h-3.5 inline mr-1.5" />
            )}
            {s.batchGenerate}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
};

/* ── Saved library ───────────────────────────────────────────────────────── */

interface LibraryPanelProps {
  entries: SavedQr[];
  s: QrStrings;
  onClose: () => void;
  onOpen: (entry: SavedQr) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onClearAll: () => void;
}

export const LibraryPanel: React.FC<LibraryPanelProps> = ({
  entries,
  s,
  onClose,
  onOpen,
  onDelete,
  onToggleFavorite,
  onClearAll,
}) => {
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const visible = entries.filter((entry) => {
    if (favoritesOnly && !entry.favorite) return false;
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return entry.title.toLowerCase().includes(needle) || entry.payload.toLowerCase().includes(needle);
  });

  return (
    <ModalShell title={s.library} onClose={onClose} width="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[160px]">
            <input
              className={INPUT_CLASS}
              placeholder={s.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Toggle label={s.favorites} checked={favoritesOnly} onChange={setFavoritesOnly} />
          {entries.length > 0 && (
            <Button variant="danger" onClick={onClearAll}>
              <Trash2 className="w-3.5 h-3.5 inline mr-1.5" />
              {s.clearAll}
            </Button>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="text-xs text-neutral-500 py-8 text-center">{s.noSaved}</p>
        ) : (
          <ul className="space-y-2">
            {visible.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 min-w-0"
              >
                <button
                  type="button"
                  onClick={() => onToggleFavorite(entry.id)}
                  className={`p-1 rounded shrink-0 ${entry.favorite ? 'text-amber-300' : 'text-neutral-600 hover:text-neutral-400'}`}
                  aria-label={s.favorites}
                >
                  <Star className="w-4 h-4" fill={entry.favorite ? 'currentColor' : 'none'} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{entry.title}</p>
                  <p className="text-[11px] text-neutral-500 font-mono break-all line-clamp-2">
                    {entry.payload}
                  </p>
                </div>
                <Button onClick={() => onOpen(entry)}>{s.open}</Button>
                <Button variant="danger" onClick={() => onDelete(entry.id)} title={s.delete}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  );
};

/* ── PDF sheet ───────────────────────────────────────────────────────────── */

interface SheetPanelProps {
  /** The current code, placed once per requested copy. */
  payload: string;
  label: string;
  design: QrDesign;
  s: QrStrings;
  onClose: () => void;
  onError: (message: string) => void;
  onToast: (message: string) => void;
}

export const SheetPanel: React.FC<SheetPanelProps> = ({
  payload,
  label,
  design,
  s,
  onClose,
  onError,
  onToast,
}) => {
  const [options, setOptions] = useState<SheetOptions>(DEFAULT_SHEET_OPTIONS);
  const [copies, setCopies] = useState(6);
  const [busy, setBusy] = useState(false);

  const update = <K extends keyof SheetOptions>(key: K, value: SheetOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  const handleBuild = async () => {
    setBusy(true);
    try {
      const sheetDesign: QrDesign = {
        ...design,
        // The caption is drawn per cell by the sheet, so a code-level caption
        // would print twice.
        caption: '',
        frameEnabled: false,
      };
      const blob = await buildQrSheet(
        [{ payload, label: label || 'Scan me', design: sheetDesign }],
        options,
        copies
      );
      downloadBlob(blob, 'qr-sheet.pdf');
      onToast('Sheet ready.');
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not build the sheet.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={s.sheet} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <SelectInput
            label={s.paper}
            value={options.paper}
            options={[
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'US Letter' },
            ]}
            onChange={(v) => update('paper', v as SheetOptions['paper'])}
          />
          <SelectInput
            label={s.copies}
            value={String(copies)}
            options={[1, 2, 4, 6, 9, 12, 24].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => setCopies(Number(v))}
          />
          <SelectInput
            label={s.columns}
            value={String(options.columns)}
            options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => update('columns', Number(v))}
          />
          <Field label={s.rowGap}>
            <input
              type="number"
              min={2}
              max={40}
              className={INPUT_CLASS}
              value={options.rowGapMm}
              onChange={(e) => update('rowGapMm', Number(e.target.value))}
            />
          </Field>
          <Field label={s.sheetMargin}>
            <input
              type="number"
              min={5}
              max={40}
              className={INPUT_CLASS}
              value={options.marginMm}
              onChange={(e) => update('marginMm', Number(e.target.value))}
            />
          </Field>
        </div>

        <Toggle
          label={s.showLabels}
          checked={options.showLabels}
          onChange={(v) => update('showLabels', v)}
        />

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            {s.startOver}
          </Button>
          <Button variant="primary" onClick={handleBuild} disabled={busy}>
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 inline mr-1.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5 inline mr-1.5" />
            )}
            {s.buildSheet}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
};

export { LABEL_CLASS };
