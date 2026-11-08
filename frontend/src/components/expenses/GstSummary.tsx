import React from 'react';
import { AlertTriangle, BadgeCheck } from 'lucide-react';
import { Expense } from '../../types/index.js';
import { formatINR } from '../../utils/currency.js';
import { formatDate } from '../../utils/dates.js';
import { isValidGstin } from '../../utils/gst.js';

/** GST breakdown of a bill for the MD's review, with warnings that would block an ITC claim. */
export const GstSummary: React.FC<{ expense: Pick<Expense, 'gst' | 'receiptUrl'>; compact?: boolean }> = ({ expense, compact }) => {
  const g = expense.gst;
  if (!g) {
    return compact ? null : <p className="text-[11px] text-slate-500">Cash / no-GST bill</p>;
  }
  const warnings: string[] = [];
  if (!isValidGstin(g.vendorGstin)) warnings.push('Vendor GSTIN looks invalid');
  if (!expense.receiptUrl) warnings.push('No GST invoice attached — input credit cannot be claimed');

  const tax = g.cgstPaise + g.sgstPaise + g.igstPaise;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 text-[11px] text-slate-700 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="inline-flex items-center gap-1 font-bold text-emerald-800">
          <BadgeCheck className="w-3.5 h-3.5" /> GST bill
        </span>
        <span className="font-mono">{g.vendorGstin}</span>
        <span>
          Inv. {g.invoiceNumber} · {formatDate(g.invoiceDate, 'dd MMM yyyy')}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span>Taxable {formatINR(g.taxablePaise)}</span>
        {g.interState ? (
          <span>IGST {g.ratePercent}% {formatINR(g.igstPaise)}</span>
        ) : (
          <>
            <span>CGST {formatINR(g.cgstPaise)}</span>
            <span>SGST {formatINR(g.sgstPaise)}</span>
          </>
        )}
        {!compact && <span className="font-semibold text-emerald-800">Input credit {formatINR(tax)}</span>}
      </div>
      {warnings.map((w) => (
        <p key={w} className="flex items-center gap-1 font-semibold text-rose-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {w}
        </p>
      ))}
    </div>
  );
};
