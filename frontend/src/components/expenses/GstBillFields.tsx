import React from 'react';
import { BadgeCheck, AlertTriangle } from 'lucide-react';
import { GstBillDraft } from '../../types/index.js';
import { Input, Select } from '../common/Input.js';
import { formatRupees } from '../../utils/currency.js';
import { GST_RATES, computeGst, emptyGstDraft, isValidGstin } from '../../utils/gst.js';

const NO_SPIN = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

interface Props {
  value?: GstBillDraft;
  onChange: (next: GstBillDraft | undefined) => void;
  /** BKR INFRA's GSTIN: decides CGST + SGST (same state) vs IGST */
  companyGstin?: string;
  disabled?: boolean;
}

/** "GST bill / Cash bill" switch plus the GST invoice fields and a live tax breakdown. */
export const GstBillFields: React.FC<Props> = ({ value, onChange, companyGstin, disabled }) => {
  const isGst = !!value?.isGstBill;
  const set = (patch: Partial<GstBillDraft>) => onChange({ ...(value || emptyGstDraft()), ...patch });

  const taxablePaise = Math.round((parseFloat(value?.taxable || '') || 0) * 100);
  const split = value ? computeGst(taxablePaise, value.ratePercent, value.vendorGstin, companyGstin) : null;
  const gstinTyped = (value?.vendorGstin || '').length;
  const gstinOk = isValidGstin(value?.vendorGstin);

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Bill type" className="inline-flex rounded-xl border border-slate-300 bg-white p-0.5 text-xs font-semibold">
        {[
          { gst: false, label: 'Cash / no-GST bill' },
          { gst: true, label: 'GST bill' },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={isGst === o.gst}
            disabled={disabled}
            onClick={() => onChange(o.gst ? { ...(value || emptyGstDraft()), isGstBill: true } : undefined)}
            className={`min-h-[36px] px-3 rounded-lg transition ${
              isGst === o.gst ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {isGst && value && (
        <div className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              aria-label="Vendor GSTIN"
              placeholder="Vendor GSTIN (15 characters)"
              maxLength={15}
              autoCapitalize="characters"
              value={value.vendorGstin}
              onChange={(e) => set({ vendorGstin: e.target.value.toUpperCase().replace(/\s/g, '') })}
              rightIcon={
                gstinTyped === 15 ? (
                  gstinOk ? <BadgeCheck className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />
                ) : undefined
              }
              error={gstinTyped === 15 && !gstinOk ? 'GSTIN is not valid — check the characters' : undefined}
            />
            <Input
              aria-label="GST invoice number"
              placeholder="Invoice no."
              maxLength={40}
              value={value.invoiceNumber}
              onChange={(e) => set({ invoiceNumber: e.target.value })}
            />
            <Input
              type="date"
              aria-label="GST invoice date"
              value={value.invoiceDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => set({ invoiceDate: e.target.value })}
            />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                aria-label="Taxable amount in rupees (before GST)"
                placeholder="Taxable value"
                className={NO_SPIN}
                leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
                value={value.taxable}
                onChange={(e) => set({ taxable: e.target.value })}
              />
              <Select
                aria-label="GST rate"
                value={String(value.ratePercent)}
                onChange={(e) => set({ ratePercent: Number(e.target.value) })}
                options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))}
              />
            </div>
          </div>

          {split && taxablePaise > 0 && (
            <p className="text-xs text-slate-700 flex flex-wrap gap-x-3 gap-y-0.5">
              <span>Taxable {formatRupees(taxablePaise / 100)}</span>
              {split.interState ? (
                <span>IGST {formatRupees(split.igst / 100)}</span>
              ) : (
                <>
                  <span>CGST {formatRupees(split.cgst / 100)}</span>
                  <span>SGST {formatRupees(split.sgst / 100)}</span>
                </>
              )}
              <span className="font-bold text-navy-950">Bill total {formatRupees(split.total / 100)}</span>
            </p>
          )}
          {!companyGstin && (
            <p className="text-[11px] text-amber-800">
              BKR INFRA&apos;s GSTIN is not set yet, so the tax is shown as CGST + SGST. The MD can add it under Company &amp; GST.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
