import React from 'react';
import { Calculator } from 'lucide-react';
import { formatRupees } from '../../utils/currency.js';

export interface ReportCostTotals {
  work: number;
  labour: number;
  materials: number;
  machinery: number;
  expenses: number;
}

const LINES: Array<{ key: keyof ReportCostTotals; label: string }> = [
  { key: 'work', label: 'Work items' },
  { key: 'labour', label: 'Labour (daily wages)' },
  { key: 'materials', label: 'Materials' },
  { key: 'machinery', label: 'Machinery & equipment' },
  { key: 'expenses', label: 'Expenses & bills' },
];

export const grandTotalOf = (t: ReportCostTotals) =>
  Math.round((t.work + t.labour + t.materials + t.machinery + t.expenses) * 100) / 100;

/** Section subtotals and the grand total for one daily report (all amounts in ₹). */
export const ReportCostSummary: React.FC<{ totals: ReportCostTotals; className?: string }> = ({ totals, className = '' }) => {
  const grand = grandTotalOf(totals);
  return (
    <section
      aria-labelledby="report-grand-total"
      className={`rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden ${className}`}
    >
      <div className="flex items-center gap-2 px-4 sm:px-5 pt-4 pb-2">
        <Calculator className="w-4 h-4 text-navy-800" />
        <h3 id="report-grand-total" className="text-base font-semibold text-navy-950">
          Cost summary
        </h3>
      </div>
      <dl className="px-4 sm:px-5 divide-y divide-slate-100 text-sm">
        {LINES.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-3 py-2">
            <dt className="text-slate-600">{label}</dt>
            <dd className={`font-semibold tabular-nums ${totals[key] > 0 ? 'text-navy-950' : 'text-slate-400'}`}>
              {totals[key] > 0 ? formatRupees(totals[key]) : '—'}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-navy-950 text-white">
        <span className="text-sm font-bold uppercase tracking-wider">Grand total</span>
        <span className="text-xl font-black text-amber-400 tabular-nums">{formatRupees(grand)}</span>
      </div>
    </section>
  );
};
