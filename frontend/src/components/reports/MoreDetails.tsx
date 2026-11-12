import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/** Collapsible "More details" block inside a report row: optional fields that feed the Excel registers. */
export const MoreDetails: React.FC<{ summary?: string; filled?: boolean; children: React.ReactNode }> = ({ summary, filled, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full min-h-[40px] px-3 flex items-center justify-between gap-2 text-xs font-semibold text-slate-600 hover:text-navy-900"
      >
        <span className="truncate text-left">
          More details {filled ? <span className="text-emerald-700">· {summary || 'added'}</span> : <span className="font-normal text-slate-400">(optional)</span>}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-3 gap-2">{children}</div>}
    </div>
  );
};

/** Small labelled input used inside MoreDetails. */
export const DetailField: React.FC<{
  label: string;
  value: string | number | undefined;
  onChange: (v: string) => void;
  type?: 'text' | 'number' | 'time';
  placeholder?: string;
  wide?: boolean;
  maxLength?: number;
  prefix?: string;
  list?: string;
}> = ({ label, value, onChange, type = 'text', placeholder, wide, maxLength, prefix, list }) => (
  <label className={`block min-w-0 ${wide ? 'col-span-2 sm:col-span-3' : ''}`}>
    <span className="block text-[11px] font-semibold text-slate-500 mb-0.5">{label}</span>
    <span className="flex items-center rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-navy-500/20 focus-within:border-navy-500">
      {prefix && <span className="pl-2 text-xs font-bold text-slate-500">{prefix}</span>}
      <input
        type={type}
        list={list}
        inputMode={type === 'number' ? 'decimal' : undefined}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? 'any' : undefined}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 h-10 px-2 text-sm bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </span>
  </label>
);

/** "" → undefined, otherwise a non-negative number */
export const numOrUndef = (v: string) => {
  if (v === '') return undefined;
  const x = parseFloat(v);
  return Number.isFinite(x) && x >= 0 ? x : undefined;
};
/** "" → undefined */
export const textOrUndef = (v: string) => (v.trim() === '' ? undefined : v);
