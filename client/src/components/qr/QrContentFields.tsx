/**
 * The content-type picker and the form for whichever type is selected.
 *
 * Every field group is controlled and reported upward as a whole value, so the
 * parent view keeps one `fields` object per type and a live preview re-renders
 * from that single source of truth. The file type is the exception: it owns an
 * upload action rather than a text value.
 */

import React, { useRef, useState } from 'react';
import { UploadCloud, Loader2, Link2, Check } from 'lucide-react';
import { Field, TextArea, TextInput, Button, INPUT_CLASS, LABEL_CLASS } from './QrPrimitives';
import type { QrStrings } from './qrStrings';
import type { QrContentType } from '../../services/qrPayload';
import type { QrFieldsState } from './qrFields';
import { uploadQrFile, absoluteQrFileUrl, MediaApiError } from '../../services/api';

interface QrContentFieldsProps {
  type: QrContentType;
  fields: QrFieldsState;
  onChange: <K extends keyof QrFieldsState>(key: K, value: QrFieldsState[K]) => void;
  s: QrStrings;
  onError: (message: string) => void;
}

/** The file upload control, kept separate because it owns async upload state. */
const FileFields: React.FC<QrContentFieldsProps> = ({ fields, onChange, s, onError }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileName, setFileName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setProgress(0);
    try {
      const hosted = await uploadQrFile(file, setProgress);
      // Encode the absolute URL: a phone scanning the code has no notion of
      // this page's origin, so a relative path would be meaningless.
      onChange('fileUrl', absoluteQrFileUrl(hosted.url));
      setProgress(null);
    } catch (err) {
      setProgress(null);
      setFileName('');
      if (err instanceof MediaApiError && err.isRateLimited) {
        onError(
          `Too many uploads right now. Try again in ${err.retryAfter ?? 60} seconds.`
        );
      } else {
        onError(err instanceof Error ? err.message : 'Upload failed.');
      }
    }
  };

  const busy = progress !== null;

  return (
    <div className="space-y-4 min-w-0">
      <div className="min-w-0">
        <span className={LABEL_CLASS}>{s.content}</span>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={`rounded-xl border border-dashed p-5 text-center transition-colors ${
            isDragOver ? 'border-purple-400/60 bg-purple-500/10' : 'border-white/15 bg-white/[0.02]'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          {busy ? (
            <div className="space-y-2">
              <Loader2 className="w-5 h-5 mx-auto text-purple-400 animate-spin" />
              <p className="text-xs text-neutral-300 truncate">
                {s.uploading} — {progress}%
              </p>
              <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-purple-400 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <UploadCloud className="w-5 h-5 mx-auto text-neutral-400" />
              <p className="text-xs text-neutral-400">{s.fileHelp}</p>
              <Button onClick={() => inputRef.current?.click()}>{s.chooseFile}</Button>
            </div>
          )}
        </div>
      </div>

      {fields.fileUrl && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/25 p-3 space-y-1.5 min-w-0">
          <p className="text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            {s.uploaded}
            {fileName && <span className="text-emerald-200/70 font-normal truncate">· {fileName}</span>}
          </p>
          <p className="text-[11px] text-emerald-200/80 font-mono break-all">
            <Link2 className="w-3 h-3 inline mr-1" />
            {fields.fileUrl}
          </p>
        </div>
      )}

      <Field label={s.hostedLink}>
        <input
          className={`${INPUT_CLASS} font-mono text-xs`}
          value={fields.fileUrl}
          spellCheck={false}
          placeholder="https://…"
          onChange={(e) => onChange('fileUrl', e.target.value)}
        />
      </Field>
    </div>
  );
};

export const QrContentFields: React.FC<QrContentFieldsProps> = (props) => {
  const { type, fields, onChange, s } = props;

  switch (type) {
    case 'url':
      return (
        <TextInput
          label={s.urlLabel}
          value={fields.url}
          onChange={(v) => onChange('url', v)}
          placeholder={s.urlPlaceholder}
          id="qr-url"
        />
      );

    case 'text':
      return (
        <TextArea
          label={s.textLabel}
          value={fields.text}
          onChange={(v) => onChange('text', v)}
          placeholder={s.textPlaceholder}
          rows={5}
        />
      );

    case 'file':
      return <FileFields {...props} />;

    case 'wifi':
      return (
        <div className="space-y-4">
          <TextInput
            label={s.networkName}
            value={fields.wifiSsid}
            onChange={(v) => onChange('wifiSsid', v)}
          />
          {fields.wifiEncryption !== 'nopass' && (
            <TextInput
              label={s.wifiPassword}
              value={fields.wifiPassword}
              onChange={(v) => onChange('wifiPassword', v)}
            />
          )}
          <Field label={s.encryption}>
            <select
              className={`${INPUT_CLASS} cursor-pointer`}
              value={fields.wifiEncryption}
              onChange={(e) => onChange('wifiEncryption', e.target.value)}
            >
              <option value="WPA" className="bg-neutral-900">
                WPA / WPA2 / WPA3
              </option>
              <option value="WEP" className="bg-neutral-900">
                WEP
              </option>
              <option value="nopass" className="bg-neutral-900">
                {s.encryptionOpen}
              </option>
            </select>
          </Field>
          <div className="flex items-center gap-2">
            <input
              id="qr-wifi-hidden"
              type="checkbox"
              className="accent-purple-400"
              checked={fields.wifiHidden}
              onChange={(e) => onChange('wifiHidden', e.target.checked)}
            />
            <label htmlFor="qr-wifi-hidden" className="text-xs text-neutral-300">
              {s.hiddenNetwork}
            </label>
          </div>
        </div>
      );

    case 'vcard':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextInput label={s.firstName} value={fields.vcardFirst} onChange={(v) => onChange('vcardFirst', v)} />
            <TextInput label={s.lastName} value={fields.vcardLast} onChange={(v) => onChange('vcardLast', v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label={s.company} value={fields.vcardOrg} onChange={(v) => onChange('vcardOrg', v)} />
            <TextInput label={s.jobTitle} value={fields.vcardTitle} onChange={(v) => onChange('vcardTitle', v)} />
          </div>
          <TextInput
            label={s.phoneLabel}
            type="tel"
            value={fields.vcardPhone}
            onChange={(v) => onChange('vcardPhone', v)}
          />
          <TextInput
            label={s.emailAddress}
            type="email"
            value={fields.vcardEmail}
            onChange={(v) => onChange('vcardEmail', v)}
          />
          <TextInput label={s.website} value={fields.vcardWebsite} onChange={(v) => onChange('vcardWebsite', v)} />
          <TextInput label={s.address} value={fields.vcardAddress} onChange={(v) => onChange('vcardAddress', v)} />
          <TextArea label={s.note} value={fields.vcardNote} onChange={(v) => onChange('vcardNote', v)} rows={2} />
        </div>
      );

    case 'email':
      return (
        <div className="space-y-4">
          <TextInput
            label={s.recipient}
            type="email"
            value={fields.emailTo}
            onChange={(v) => onChange('emailTo', v)}
          />
          <TextInput label={s.subject} value={fields.emailSubject} onChange={(v) => onChange('emailSubject', v)} />
          <TextArea label={s.message} value={fields.emailBody} onChange={(v) => onChange('emailBody', v)} rows={4} />
        </div>
      );

    case 'sms':
      return (
        <div className="space-y-4">
          <TextInput
            label={s.phoneLabel}
            type="tel"
            value={fields.smsPhone}
            onChange={(v) => onChange('smsPhone', v)}
          />
          <TextArea label={s.message} value={fields.smsMessage} onChange={(v) => onChange('smsMessage', v)} rows={4} />
        </div>
      );

    case 'phone':
      return (
        <TextInput
          label={s.phoneLabel}
          type="tel"
          value={fields.phone}
          onChange={(v) => onChange('phone', v)}
          placeholder="+855 12 345 678"
        />
      );

    case 'event':
      return (
        <div className="space-y-4">
          <TextInput label={s.eventTitle} value={fields.eventTitle} onChange={(v) => onChange('eventTitle', v)} />
          <TextInput label={s.location} value={fields.eventLocation} onChange={(v) => onChange('eventLocation', v)} />
          <TextInput
            label={s.startTime}
            type="datetime-local"
            value={fields.eventStart}
            onChange={(v) => onChange('eventStart', v)}
          />
          <TextInput
            label={s.endTime}
            type="datetime-local"
            value={fields.eventEnd}
            onChange={(v) => onChange('eventEnd', v)}
          />
          <TextArea
            label={s.description}
            value={fields.eventDescription}
            onChange={(v) => onChange('eventDescription', v)}
            rows={2}
          />
        </div>
      );

    case 'geo':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextInput
              label={s.latitude}
              value={fields.geoLat}
              onChange={(v) => onChange('geoLat', v)}
              placeholder="11.5564"
            />
            <TextInput
              label={s.longitude}
              value={fields.geoLng}
              onChange={(v) => onChange('geoLng', v)}
              placeholder="104.9282"
            />
          </div>
          <Button
            full
            onClick={() => {
              if (!navigator.geolocation) {
                props.onError('This browser does not support location sharing.');
                return;
              }
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  onChange('geoLat', position.coords.latitude.toFixed(6));
                  onChange('geoLng', position.coords.longitude.toFixed(6));
                },
                () => props.onError('Could not read your location.')
              );
            }}
          >
            Use my current location
          </Button>
        </div>
      );
  }
};
