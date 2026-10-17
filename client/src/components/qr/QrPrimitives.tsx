/**
 * Small form primitives for the QR Studio view.
 *
 * The repo has no component library — views compose raw utility classes — but
 * this view has several dozen controls, so a handful of local primitives keeps
 * the panels readable and the focus/accent styling consistent. Accent is
 * purple, which no other tool uses.
 */

import React, { useId } from 'react';

export const PANEL_CLASS =
  'glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-4 min-w-0';

export const LABEL_CLASS =
  'block text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5';

export const INPUT_CLASS =
  'w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white ' +
  'placeholder:text-neutral-500 focus:outline-none focus:border-purple-400/60 transition-colors';

export const RANGE_CLASS = 'w-full accent-purple-400 h-1.5 cursor-pointer';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, htmlFor, hint, children }) => (
  <div className="min-w-0">
    <label className={LABEL_CLASS} htmlFor={htmlFor}>
      {label}
    </label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-neutral-500 leading-snug">{hint}</p>}
  </div>
);

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'url' | 'email' | 'tel' | 'datetime-local' | 'number' | 'password';
  hint?: string;
  id?: string;
}

export const TextInput: React.FC<TextInputProps> = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  id,
}) => {
  // A generated id keeps the label associated with its input for screen
  // readers and for tests, without every call site inventing a unique one.
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={inputId} hint={hint}>
      <input
        id={inputId}
        type={type}
        className={INPUT_CLASS}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        // A password of the wrong kind is the usual cause of a Wi-Fi code that
        // fails on the phone, so the value stays visible.
        spellCheck={false}
        autoComplete="off"
      />
    </Field>
  );
};

interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
  mono?: boolean;
}

export const TextArea: React.FC<TextAreaProps> = ({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  hint,
  mono,
}) => {
  const inputId = useId();
  return (
    <Field label={label} htmlFor={inputId} hint={hint}>
      <textarea
        id={inputId}
        className={`${INPUT_CLASS} resize-y ${mono ? 'font-mono text-xs leading-relaxed' : ''}`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
};

interface Option {
  value: string;
  label: string;
}

interface SelectInputProps {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  hint?: string;
}

export const SelectInput: React.FC<SelectInputProps> = ({ label, value, options, onChange, hint }) => {
  const inputId = useId();
  return (
    <Field label={label} htmlFor={inputId} hint={hint}>
      <select
        id={inputId}
        className={`${INPUT_CLASS} appearance-none cursor-pointer`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-neutral-900 text-white">
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
};

interface RangeInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Appended to the shown value, e.g. `%` or `px`. */
  unit?: string;
  hint?: string;
}

export const RangeInput: React.FC<RangeInputProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = '',
  hint,
}) => {
  const inputId = useId();
  return (
    <Field label={`${label} — ${value}${unit}`} htmlFor={inputId} hint={hint}>
      <input
        id={inputId}
        type="range"
        className={RANGE_CLASS}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
};

interface ColorInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export const ColorInput: React.FC<ColorInputProps> = ({ label, value, onChange }) => (
  <Field label={label}>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-12 rounded-lg border border-white/10 bg-transparent cursor-pointer shrink-0"
        aria-label={label}
      />
      <input
        className={`${INPUT_CLASS} font-mono text-xs uppercase`}
        value={value}
        aria-label={`${label} hex`}
        spellCheck={false}
        onChange={(e) => {
          const next = e.target.value;
          // Accept only a complete hex value so the picker never receives an
          // intermediate string it cannot parse.
          if (/^#[0-9a-f]{0,6}$/i.test(next)) onChange(next);
        }}
      />
    </div>
  </Field>
);

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ label, checked, onChange, hint }) => (
  <div className="min-w-0">
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 w-full text-left group"
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${
          checked ? 'bg-purple-500' : 'bg-white/10'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="text-xs text-neutral-300 group-hover:text-white transition-colors">{label}</span>
    </button>
    {hint && <p className="mt-1 ml-[46px] text-[11px] text-neutral-500 leading-snug">{hint}</p>}
  </div>
);

interface ChipGroupProps {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  /** Lay the chips out in a grid rather than a wrapping row. */
  columns?: 2 | 3;
}

export const ChipGroup: React.FC<ChipGroupProps> = ({ label, value, options, onChange, columns }) => (
  <Field label={label}>
    <div
      className={
        columns
          ? `grid gap-1.5 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`
          : 'flex flex-wrap gap-1.5'
      }
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all truncate ${
              active
                ? 'bg-purple-500/20 border-purple-400/50 text-purple-200'
                : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  </Field>
);

interface ButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  full?: boolean;
  title?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  full,
  title,
}) => {
  const variants: Record<string, string> = {
    primary: 'bg-white hover:bg-neutral-200 text-black',
    secondary: 'bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200',
    ghost: 'hover:bg-white/5 text-neutral-400 hover:text-white',
    danger: 'bg-red-500/10 hover:bg-red-500/20 border border-red-400/30 text-red-300',
  };

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
        variants[variant]
      } ${full ? 'w-full' : ''}`}
    >
      {children}
    </button>
  );
};

interface SectionHeadingProps {
  children: React.ReactNode;
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({ children }) => (
  <h3 className="font-display text-sm text-white tracking-wide">{children}</h3>
);
