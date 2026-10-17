/**
 * The designer panel: presets, colours and gradients, module shapes, the centre
 * logo, and the frame/caption block.
 *
 * The logo is read as a data URL so the design can be serialised into the saved
 * library and reused in the SVG export without re-reading the file. Limit is
 * kept small because the data URL is stored in localStorage.
 */

import React, { useRef } from 'react';
import { Upload, X, Trash2, Save, AlertTriangle } from 'lucide-react';
import {
  Button,
  ChipGroup,
  ColorInput,
  Field,
  LABEL_CLASS,
  RangeInput,
  SectionHeading,
  SelectInput,
  Toggle,
  INPUT_CLASS,
} from './QrPrimitives';
import type { QrStrings } from './qrStrings';
import {
  BUILT_IN_PRESETS,
  MAX_SAFE_LOGO_PCT,
  MIN_MARGIN_MODULES,
  type DesignPreset,
  type QrDesign,
  type QrGradient,
} from '../../services/qrDesign';

/** Logos are inlined as data URLs, so keep the source file modest. */
export const MAX_LOGO_BYTES = 1024 * 1024;

interface QrDesignControlsProps {
  design: QrDesign;
  onChange: <K extends keyof QrDesign>(key: K, value: QrDesign[K]) => void;
  s: QrStrings;
  savedPresets: DesignPreset[];
  onApplyPreset: (design: QrDesign) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  onError: (message: string) => void;
}

export const QrDesignControls: React.FC<QrDesignControlsProps> = ({
  design,
  onChange,
  s,
  savedPresets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  onError,
}) => {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const presetNameRef = useRef<HTMLInputElement>(null);

  const dotOptions = [
    { value: 'square', label: s.shapeSquare },
    { value: 'dots', label: s.shapeDots },
    { value: 'rounded', label: s.shapeRounded },
    { value: 'extra-rounded', label: s.shapeExtraRounded },
    { value: 'classy', label: s.shapeClassy },
    { value: 'classy-rounded', label: s.shapeClassyRounded },
  ];

  const cornerSquareOptions = [
    { value: 'square', label: s.shapeSquare },
    { value: 'extra-rounded', label: s.shapeRounded },
    { value: 'dot', label: s.shapeDot },
  ];

  const cornerDotOptions = [
    { value: 'square', label: s.shapeSquare },
    { value: 'dot', label: s.shapeDot },
  ];

  const handleLogo = (file: File) => {
    if (!file.type.startsWith('image/')) {
      onError('Choose an image file for the logo (PNG, JPG, WebP or SVG).');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      onError(`That logo is ${(file.size / 1024 / 1024).toFixed(1)} MB. Use an image under 1 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onChange('logoDataUrl', reader.result);
    };
    reader.onerror = () => onError('That logo could not be read.');
    reader.readAsDataURL(file);
  };

  /** Edits one stop of a gradient in place. */
  const updateGradientStop = (
    key: 'fgGradient' | 'bgGradient',
    index: number,
    color: string
  ) => {
    const gradient = design[key];
    const stops = gradient.stops.map((stop, i) => (i === index ? { ...stop, color } : stop));
    onChange(key, { ...gradient, stops });
  };

  return (
    <div className="space-y-5 min-w-0">
      {/* ── Presets ─────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <SectionHeading>{s.presets}</SectionHeading>
        <div className="flex flex-wrap gap-1.5">
          {[...BUILT_IN_PRESETS, ...savedPresets].map((preset) => (
            <span key={preset.id} className="inline-flex items-center">
              <button
                type="button"
                onClick={() => onApplyPreset(preset.design)}
                className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] font-semibold text-neutral-300 hover:text-white transition-all"
              >
                {preset.name}
              </button>
              {!BUILT_IN_PRESETS.some((b) => b.id === preset.id) && (
                <button
                  type="button"
                  title={s.delete}
                  onClick={() => onDeletePreset(preset.id)}
                  className="ml-0.5 p-1 rounded text-neutral-500 hover:text-red-300"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            ref={presetNameRef}
            className={`${INPUT_CLASS} text-xs`}
            placeholder={s.presetName}
          />
          <Button
            onClick={() => {
              const name = presetNameRef.current?.value.trim();
              if (!name) {
                onError('Give the preset a name first.');
                return;
              }
              onSavePreset(name);
              if (presetNameRef.current) presetNameRef.current.value = '';
            }}
          >
            <Save className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Colours ─────────────────────────────────────────────────────── */}
      <div className="space-y-3 pt-1 border-t border-white/[0.06]">
        <SectionHeading>{s.colors}</SectionHeading>
        <Toggle
          label={s.useGradient}
          checked={design.fgGradientEnabled}
          onChange={(v) => onChange('fgGradientEnabled', v)}
        />

        {design.fgGradientEnabled ? (
          <GradientEditor
            gradient={design.fgGradient}
            onChange={(next) => onChange('fgGradient', next)}
            onStopColor={(index, color) => updateGradientStop('fgGradient', index, color)}
            s={s}
          />
        ) : (
          <ColorInput label={s.foreground} value={design.fgColor} onChange={(v) => onChange('fgColor', v)} />
        )}

        <ColorInput label={s.background} value={design.bgColor} onChange={(v) => onChange('bgColor', v)} />
      </div>

      {/* ── Shapes ──────────────────────────────────────────────────────── */}
      <div className="space-y-3 pt-1 border-t border-white/[0.06]">
        <ChipGroup
          label={s.dotStyle}
          value={design.dotStyle}
          options={dotOptions}
          onChange={(v) => onChange('dotStyle', v as QrDesign['dotStyle'])}
          columns={2}
        />
        <ChipGroup
          label={s.cornerStyle}
          value={design.cornerSquareStyle}
          options={cornerSquareOptions}
          onChange={(v) => onChange('cornerSquareStyle', v as QrDesign['cornerSquareStyle'])}
          columns={3}
        />
        <ChipGroup
          label={s.cornerDotStyle}
          value={design.cornerDotStyle}
          options={cornerDotOptions}
          onChange={(v) => onChange('cornerDotStyle', v as QrDesign['cornerDotStyle'])}
          columns={2}
        />
      </div>

      {/* ── Logo ────────────────────────────────────────────────────────── */}
      <div className="space-y-3 pt-1 border-t border-white/[0.06]">
        <SectionHeading>{s.logo}</SectionHeading>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleLogo(file);
          }}
        />

        {design.logoDataUrl ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-white/5 border border-white/10 p-1.5 flex items-center justify-center shrink-0">
                <img src={design.logoDataUrl} alt="" className="max-h-full max-w-full object-contain" />
              </div>
              <Button onClick={() => logoInputRef.current?.click()}>{s.uploadLogo}</Button>
              <Button variant="danger" onClick={() => onChange('logoDataUrl', null)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            <RangeInput
              label={s.logoSize}
              value={design.logoSizePct}
              min={5}
              max={40}
              onChange={(v) => onChange('logoSizePct', v)}
              unit="%"
              hint={
                design.logoSizePct > MAX_SAFE_LOGO_PCT
                  ? `Above ${MAX_SAFE_LOGO_PCT}% the code gets hard to scan.`
                  : undefined
              }
            />
            <RangeInput
              label={s.logoPadding}
              value={design.logoPaddingPct}
              min={0}
              max={30}
              onChange={(v) => onChange('logoPaddingPct', v)}
              unit="%"
            />
            <RangeInput
              label={s.logoRadius}
              value={design.logoRadiusPct}
              min={0}
              max={50}
              onChange={(v) => onChange('logoRadiusPct', v)}
              unit="%"
            />
            <Toggle
              label={s.hideDotsBehindLogo}
              checked={design.logoHideDots}
              onChange={(v) => onChange('logoHideDots', v)}
            />
          </div>
        ) : (
          <Button full onClick={() => logoInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5 inline mr-1.5" />
            {s.uploadLogo}
          </Button>
        )}
      </div>

      {/* ── Frame & caption ─────────────────────────────────────────────── */}
      <div className="space-y-3 pt-1 border-t border-white/[0.06]">
        <SectionHeading>{s.frame}</SectionHeading>
        <Toggle label={s.addFrame} checked={design.frameEnabled} onChange={(v) => onChange('frameEnabled', v)} />
        <Field label={s.caption}>
          <input
            className={INPUT_CLASS}
            value={design.caption}
            placeholder={s.captionPlaceholder}
            onChange={(e) => onChange('caption', e.target.value)}
          />
        </Field>
      </div>

      {/* ── Output ──────────────────────────────────────────────────────── */}
      <div className="space-y-3 pt-1 border-t border-white/[0.06]">
        <SelectInput
          label={s.errorCorrection}
          value={design.errorCorrection}
          options={[
            { value: 'L', label: 'L — 7%' },
            { value: 'M', label: 'M — 15%' },
            { value: 'Q', label: 'Q — 25%' },
            { value: 'H', label: 'H — 30% (best with a logo)' },
          ]}
          onChange={(v) => onChange('errorCorrection', v as QrDesign['errorCorrection'])}
          hint={design.logoDataUrl ? 'Raised to H automatically while a logo is set.' : undefined}
        />
        <RangeInput
          label={s.margin}
          value={design.margin}
          min={0}
          max={10}
          onChange={(v) => onChange('margin', v)}
          hint={design.margin < MIN_MARGIN_MODULES ? `The spec recommends at least ${MIN_MARGIN_MODULES}.` : undefined}
        />
        <SelectInput
          label={s.size}
          value={String(design.size)}
          options={[
            { value: '512', label: '512 × 512 px' },
            { value: '1024', label: '1024 × 1024 px' },
            { value: '2048', label: '2048 × 2048 px' },
            { value: '4096', label: '4096 × 4096 px (print)' },
          ]}
          onChange={(v) => onChange('size', Number(v))}
        />
      </div>
    </div>
  );
};

interface GradientEditorProps {
  gradient: QrGradient;
  onChange: (gradient: QrGradient) => void;
  onStopColor: (index: number, color: string) => void;
  s: QrStrings;
}

/** Editor for the two-stop gradient used by the foreground and background. */
const GradientEditor: React.FC<GradientEditorProps> = ({ gradient, onChange, onStopColor, s }) => (
  <div className="space-y-3">
    <SelectInput
      label={s.gradientType}
      value={gradient.type}
      options={[
        { value: 'linear', label: s.gradientLinear },
        { value: 'radial', label: s.gradientRadial },
      ]}
      onChange={(v) => onChange({ ...gradient, type: v as QrGradient['type'] })}
    />
    {gradient.type === 'linear' && (
      <RangeInput
        label={s.gradientAngle}
        value={gradient.rotation}
        min={0}
        max={359}
        onChange={(v) => onChange({ ...gradient, rotation: v })}
        unit="°"
      />
    )}
    <div className="space-y-2">
      {gradient.stops.map((stop, index) => (
        <ColorInput
          key={index}
          label={s.stopColor}
          value={stop.color}
          onChange={(color) => onStopColor(index, color)}
        />
      ))}
    </div>
    <div
      className="h-6 rounded-lg border border-white/10"
      style={{
        background:
          gradient.type === 'linear'
            ? `linear-gradient(${gradient.rotation}deg, ${gradient.stops[0]?.color}, ${gradient.stops[1]?.color})`
            : `radial-gradient(circle, ${gradient.stops[0]?.color}, ${gradient.stops[1]?.color})`,
      }}
    />
    <div className="flex gap-2">
      <input
        className={`${INPUT_CLASS} font-mono text-xs`}
        value={gradient.stops[0]?.color ?? ''}
        onChange={(e) => {
          const next = e.target.value;
          if (/^#[0-9a-f]{0,6}$/i.test(next)) onStopColor(0, next);
        }}
      />
      <input
        className={`${INPUT_CLASS} font-mono text-xs`}
        value={gradient.stops[1]?.color ?? ''}
        onChange={(e) => {
          const next = e.target.value;
          if (/^#[0-9a-f]{0,6}$/i.test(next)) onStopColor(1, next);
        }}
      />
    </div>
  </div>
);

/** Inline warning list shown above the preview when a design is risky. */
export const DesignIssues: React.FC<{
  issues: { level: 'error' | 'warn'; message: string }[];
}> = ({ issues }) => {
  if (issues.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {issues.map((issue, index) => (
        <p
          key={index}
          className={`text-[11px] flex items-start gap-1.5 leading-snug ${
            issue.level === 'error' ? 'text-red-300' : 'text-amber-300'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {issue.message}
        </p>
      ))}
    </div>
  );
};

export { LABEL_CLASS };
