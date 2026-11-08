import React from 'react';
import { Plus, Trash2, Users, Minus } from 'lucide-react';
import { LabourCountItem, LabourCategory } from '../../types/index.js';
import { Button } from '../common/Button.js';
import { Select } from '../common/Input.js';
import { LABOUR_CATEGORY_OPTIONS, LABOUR_PRESETS } from '../../utils/reportOptions.js';
import { formatRupees } from '../../utils/currency.js';

interface LabourBreakdownInputProps {
  labourList: LabourCountItem[];
  onChange: (list: LabourCountItem[]) => void;
}

const presetFor = (role: string) => LABOUR_PRESETS.find((p) => p.role === role);

/** Labour by trade with skilled / unskilled / supervisor category, headcount and hours. */
export const LabourBreakdownInput: React.FC<LabourBreakdownInputProps> = ({ labourList, onChange }) => {
  const update = (index: number, patch: Partial<LabourCountItem>) =>
    onChange(labourList.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const remove = (index: number) => onChange(labourList.filter((_, i) => i !== index));
  const add = (role = 'Mason') =>
    onChange([...labourList, { role, count: 1, category: presetFor(role)?.category || 'SKILLED' }]);

  const totals = labourList.reduce(
    (acc, l) => {
      const c = Number(l.count) || 0;
      acc.all += c;
      const cat = l.category || presetFor(l.role)?.category || 'SKILLED';
      acc[cat] = (acc[cat] || 0) + c;
      return acc;
    },
    { all: 0 } as Record<string, number>
  );
  const totalCost = labourList.reduce((s, l) => s + (Number(l.count) || 0) * (Number(l.wagePerDay) || 0), 0);
  const unused = LABOUR_PRESETS.filter((p) => p.role !== 'Other' && !labourList.some((l) => l.role === p.role)).slice(0, 6);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-navy-950">Labour on site</h3>
          <p className="text-xs text-slate-500">Headcount and daily wage per worker for each trade.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-300 rounded-lg text-sm font-bold text-amber-900">
            <Users className="w-4 h-4 text-amber-600" />
            <span>{totals.all} workers</span>
          </div>
          {totalCost > 0 && (
            <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm font-bold text-emerald-800">
              {formatRupees(totalCost)} / day
            </div>
          )}
        </div>
      </div>

      {totals.all > 0 && (
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
          {LABOUR_CATEGORY_OPTIONS.filter((o) => totals[o.value]).map((o) => (
            <span key={o.value} className="px-2 py-1 rounded-md bg-slate-100 text-slate-700">
              {o.label}: {totals[o.value]}
            </span>
          ))}
        </div>
      )}

      {labourList.length > 0 && (
        <div className="space-y-2">
          {labourList.map((item, index) => {
            const roleOptions = LABOUR_PRESETS.map((p) => p.role);
            if (!roleOptions.includes(item.role)) roleOptions.unshift(item.role);
            return (
              <div key={index} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Select
                      aria-label="Trade"
                      value={item.role}
                      onChange={(e) =>
                        update(index, { role: e.target.value, category: presetFor(e.target.value)?.category || item.category })
                      }
                      options={roleOptions.map((r) => ({ value: r, label: r }))}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    aria-label={`Remove ${item.role}`}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-200 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-[auto_1fr] min-[420px]:grid-cols-[1fr_auto_auto] gap-2 items-center">
                  <div className="col-span-2 min-[420px]:col-span-1 min-w-0">
                  <Select
                    aria-label="Labour category"
                    value={item.category || presetFor(item.role)?.category || 'SKILLED'}
                    onChange={(e) => update(index, { category: e.target.value as LabourCategory })}
                    options={LABOUR_CATEGORY_OPTIONS}
                  />
                  </div>
                  {/* Stepper avoids the keyboard for the most common edit */}
                  <div className="flex items-center rounded-xl border border-slate-300 bg-white overflow-hidden" role="group" aria-label="Headcount">
                    <button
                      type="button"
                      aria-label="Decrease headcount"
                      onClick={() => update(index, { count: Math.max(0, (Number(item.count) || 0) - 1) })}
                      className="w-11 h-11 flex items-center justify-center text-slate-600 hover:bg-slate-100"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      aria-label="Number of workers"
                      value={item.count || ''}
                      onChange={(e) => update(index, { count: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-12 h-11 text-center text-sm font-bold border-x border-slate-200 focus:outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Increase headcount"
                      onClick={() => update(index, { count: (Number(item.count) || 0) + 1 })}
                      className="w-11 h-11 flex items-center justify-center text-slate-600 hover:bg-slate-100"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 min-w-0">
                    <span className="font-bold text-slate-500">₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      aria-label={`Wage per worker per day for ${item.role}`}
                      value={item.wagePerDay ?? ''}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        update(index, { wagePerDay: e.target.value === '' || isNaN(v) || v <= 0 ? undefined : v });
                      }}
                      className="w-full min-w-[56px] max-w-[110px] h-11 rounded-xl border border-slate-300 px-2 text-sm text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="whitespace-nowrap">/ day</span>
                  </label>
                </div>
                {!!item.wagePerDay && (Number(item.count) || 0) > 0 && (
                  <p className="text-xs text-slate-600">
                    {item.count} × {formatRupees(item.wagePerDay)} ={' '}
                    <span className="font-bold text-emerald-700">{formatRupees((Number(item.count) || 0) * item.wagePerDay)}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {unused.map((p) => (
          <button
            key={p.role}
            type="button"
            onClick={() => add(p.role)}
            className="min-h-[36px] px-3 rounded-full border border-dashed border-slate-300 text-xs font-semibold text-slate-600 hover:border-amber-400 hover:text-navy-900"
          >
            + {p.role}
          </button>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => add('Other')} leftIcon={<Plus className="w-4 h-4" />}>
          Other trade
        </Button>
      </div>
    </div>
  );
};
