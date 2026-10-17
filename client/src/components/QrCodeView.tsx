/**
 * QR Studio — generate QR codes from a URL, a hosted file, Wi-Fi, a contact
 * card, an event, a location, email/SMS/phone, or plain text, and brand them
 * with a centre logo, custom colours and module shapes.
 *
 * Composes the pieces in `components/qr/*` (content fields, designer, preview,
 * batch/library/sheet panels) over the pure logic in `services/qr*`. The QR
 * matrix is generated in the browser — the server is only involved when a file
 * is uploaded for hosting.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QrCode, Languages, FolderOpen, Package, Bookmark } from 'lucide-react';
import { stringsFor, type Lang } from './qr/qrStrings';
import { Button, PANEL_CLASS, SectionHeading, LABEL_CLASS, INPUT_CLASS } from './qr/QrPrimitives';
import { QrContentFields } from './qr/QrContentFields';
import {
  CONTENT_TYPE_ORDER,
  contentTypeLabels,
  EMPTY_FIELDS,
  isContentEmpty,
  payloadInputFor,
  type QrFieldsState,
} from './qr/qrFields';
import { QrDesignControls, DesignIssues } from './qr/QrDesignControls';
import { QrPreview } from './qr/QrPreview';
import { BatchPanel, LibraryPanel, SheetPanel } from './qr/QrPanels';
import { buildPayload, type QrContentType } from '../services/qrPayload';
import {
  DEFAULT_DESIGN,
  deletePreset,
  loadLibrary,
  loadPresets,
  removeFromLibrary,
  savePreset,
  saveToLibrary,
  toggleLibraryFavorite,
  validateDesign,
  type DesignPreset,
  type QrDesign,
  type SavedQr,
} from '../services/qrDesign';

type Panel = null | 'batch' | 'library' | 'sheet';

/** A short label for the current content, used for file names and the library. */
function titleFor(type: QrContentType, fields: QrFieldsState, s: ReturnType<typeof stringsFor>): string {
  switch (type) {
    case 'url':
      return fields.url || s.typeUrl;
    case 'text':
      return fields.text.slice(0, 40) || s.typeText;
    case 'file':
      return fields.fileUrl.split('/').pop() || s.typeFile;
    case 'wifi':
      return fields.wifiSsid || s.typeWifi;
    case 'vcard':
      return [fields.vcardFirst, fields.vcardLast].filter(Boolean).join(' ') || s.typeVcard;
    case 'email':
      return fields.emailTo || s.typeEmail;
    case 'sms':
    case 'phone':
      return (type === 'sms' ? fields.smsPhone : fields.phone) || s.typePhone;
    case 'event':
      return fields.eventTitle || s.typeEvent;
    case 'geo':
      return fields.geoLat && fields.geoLng ? `${fields.geoLat}, ${fields.geoLng}` : s.typeGeo;
  }
}

export const QrCodeView: React.FC = () => {
  const [lang, setLang] = useState<Lang>('en');
  const s = useMemo(() => stringsFor(lang), [lang]);

  const [contentType, setContentType] = useState<QrContentType>('url');
  const [fields, setFields] = useState<QrFieldsState>(EMPTY_FIELDS);
  const [design, setDesign] = useState<QrDesign>(DEFAULT_DESIGN);
  // Read from localStorage in a lazy initializer rather than an effect: the
  // panels are only reachable after a click, so there is no server-render
  // mismatch to guard against and this avoids a second render on mount.
  const [presets, setPresets] = useState<DesignPreset[]>(loadPresets);
  const [library, setLibrary] = useState<SavedQr[]>(loadLibrary);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /** Reports a failed action through the toast rather than an alert. */
  const showError = useCallback(
    (message: string) => {
      setToast(message);
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 4000);
    },
    []
  );

  const setField = useCallback(
    <K extends keyof QrFieldsState>(key: K, value: QrFieldsState[K]) => {
      setFields((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const setDesignValue = useCallback(
    <K extends keyof QrDesign>(key: K, value: QrDesign[K]) => {
      setDesign((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const payloadResult = useMemo(
    () => buildPayload(payloadInputFor(contentType, fields)),
    [contentType, fields]
  );
  const payload = payloadResult.ok ? payloadResult.data : '';
  const payloadError = payloadResult.ok ? null : payloadResult.error;

  // An untouched form is not an error — show guidance instead of a validation
  // message for a field the user has not reached yet.
  const contentEmpty = useMemo(() => isContentEmpty(contentType, fields), [contentType, fields]);
  const previewError = contentEmpty ? null : payloadError;

  const issues = useMemo(() => validateDesign(design), [design]);
  const hasBlockingIssue = issues.some((issue) => issue.level === 'error');

  const title = titleFor(contentType, fields, s);

  const handleSaveToLibrary = () => {
    if (!payload) {
      showError('Generate a code before saving it.');
      return;
    }
    const next = saveToLibrary({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: saveName.trim() || title,
      type: contentType,
      payload,
      design,
      createdAt: Date.now(),
      favorite: false,
    });
    setLibrary(next);
    setSaveName('');
    showToast(s.saveToLibrary);
  };

  return (
    <div className="space-y-5 min-w-0">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-xl sm:text-2xl text-white flex items-center gap-2">
            <QrCode className="w-6 h-6 text-purple-400" />
            {s.title}
          </h2>
          <p className="text-xs text-neutral-400 mt-1 max-w-2xl leading-relaxed">{s.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setPanel('library')}>
            <Bookmark className="w-3.5 h-3.5 inline mr-1.5" />
            {s.library}
          </Button>
          <Button onClick={() => setPanel('batch')}>
            <Package className="w-3.5 h-3.5 inline mr-1.5" />
            {s.batch}
          </Button>
          <Button onClick={() => setLang(lang === 'en' ? 'kh' : 'en')} title="Language">
            <Languages className="w-3.5 h-3.5 inline mr-1.5" />
            {lang === 'en' ? 'ខ្មែរ' : 'English'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-5 min-w-0">
        {/* ── Left: content + design ───────────────────────────────────── */}
        <div className="space-y-5 min-w-0">
          <div className={PANEL_CLASS}>
            <SectionHeading>{s.contentType}</SectionHeading>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_TYPE_ORDER.map((type) => {
                const labels = contentTypeLabels(s);
                const active = type === contentType;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setContentType(type)}
                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
                      active
                        ? 'bg-purple-500/20 border-purple-400/50 text-purple-200'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {labels[type]}
                  </button>
                );
              })}
            </div>

            <div className="pt-2">
              <QrContentFields
                type={contentType}
                fields={fields}
                onChange={setField}
                s={s}
                onError={showError}
              />
            </div>
          </div>

          <div className={PANEL_CLASS}>
            <SectionHeading>{s.design}</SectionHeading>
            <QrDesignControls
              design={design}
              onChange={setDesignValue}
              s={s}
              savedPresets={presets}
              onApplyPreset={(next) => setDesign(next)}
              onSavePreset={(name) => {
                // A stable id so the preset can be deleted later; the name is
                // what the user actually recognises.
                setPresets(savePreset({ id: `preset-${Date.now()}`, name, design }));
                showToast(s.savePreset);
              }}
              onDeletePreset={(id) => setPresets(deletePreset(id))}
              onError={showError}
            />
          </div>
        </div>

        {/* ── Right: preview + export ──────────────────────────────────── */}
        <div className="space-y-5 min-w-0">
          <div className={`${PANEL_CLASS} lg:sticky lg:top-20`}>
            <DesignIssues issues={issues} />

            <QrPreview
              payload={payload}
              design={design}
              payloadError={previewError}
              s={s}
              fileName={title}
              onError={showError}
              onToast={showToast}
              onOpenSheet={() => {
                if (hasBlockingIssue) {
                  showError(s.errorFixFirst);
                  return;
                }
                setPanel('sheet');
              }}
            />

            <div className="pt-3 border-t border-white/[0.06] space-y-2">
              <span className={LABEL_CLASS}>{s.saveToLibrary}</span>
              <div className="flex gap-2">
                <input
                  className={INPUT_CLASS}
                  placeholder={title}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <Button onClick={handleSaveToLibrary}>
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {panel === 'batch' && (
        <BatchPanel
          design={design}
          s={s}
          onClose={() => setPanel(null)}
          onError={showError}
          onToast={showToast}
        />
      )}

      {panel === 'library' && (
        <LibraryPanel
          entries={library}
          s={s}
          onClose={() => setPanel(null)}
          onOpen={(entry) => {
            // Restoring a saved code also restores its design, so re-exporting
            // reproduces exactly what was stored.
            setDesign(entry.design);
            setContentType('text');
            setFields({ ...EMPTY_FIELDS, text: entry.payload });
            setPanel(null);
            showToast(entry.title);
          }}
          onDelete={(id) => setLibrary(removeFromLibrary(id))}
          onToggleFavorite={(id) => setLibrary(toggleLibraryFavorite(id))}
          onClearAll={() => {
            library.forEach((entry) => removeFromLibrary(entry.id));
            setLibrary([]);
          }}
        />
      )}

      {panel === 'sheet' && (
        <SheetPanel
          payload={payload}
          label={title}
          design={design}
          s={s}
          onClose={() => setPanel(null)}
          onError={showError}
          onToast={showToast}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-neutral-900/95 backdrop-blur-xl border border-white/10 text-xs text-white shadow-glass anim-fade-in-up max-w-[90vw] text-center"
        >
          {toast}
        </div>
      )}
    </div>
  );
};
