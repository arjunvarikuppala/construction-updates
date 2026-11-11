import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Camera, Paperclip, Loader2, AlertTriangle, Lock } from 'lucide-react';
import { ReportExpenseDraft, ExpenseCategory } from '../../types/index.js';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';
import { ReceiptThumb } from '../common/SecureMedia.js';
import { EXPENSE_CATEGORY_OPTIONS } from '../../utils/reportOptions.js';
import { uploadFileWithProgress } from '../../utils/upload.js';
import { formatRupees } from '../../utils/currency.js';
import { GstBillFields } from '../expenses/GstBillFields.js';
import { gstDraftTotalRupees, useCompanySettings } from '../../utils/gst.js';

interface Props {
  expenses: ReportExpenseDraft[];
  onChange: (next: ReportExpenseDraft[] | ((prev: ReportExpenseDraft[]) => ReportExpenseDraft[])) => void;
  onBusyChange?: (busy: boolean) => void;
}

export const emptyExpense = (): ReportExpenseDraft => ({
  category: 'CONSTRUCTION_MATERIALS',
  description: '',
  amount: '',
  vendor: '',
});

/** Rows are locked once the MD has started reviewing them (only DRAFT rows are editable). */
const isLocked = (e: ReportExpenseDraft) => !!e._id && !!e.status && e.status !== 'DRAFT';

/** Multiple expenses inside one daily report; amounts entered in ₹ and stored server-side as paise. */
export const ReportExpensesInput: React.FC<Props> = ({ expenses, onChange, onBusyChange }) => {
  const [uploading, setUploading] = useState<Record<number, number>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const { data: company } = useCompanySettings();
  const companyGstin = company?.gstin || undefined;

  const update = (i: number, patch: Partial<ReportExpenseDraft>) =>
    onChange((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const uploadReceipt = async (i: number, file?: File | null) => {
    if (!file) return;
    setErrors((p) => ({ ...p, [i]: '' }));
    setUploading((p) => ({ ...p, [i]: 0 }));
    try {
      const res = await uploadFileWithProgress(file, (pct) => setUploading((p) => ({ ...p, [i]: pct })));
      update(i, { receiptUrl: res.url });
    } catch (err: any) {
      setErrors((p) => ({ ...p, [i]: err.message || 'Upload failed' }));
    } finally {
      setUploading((p) => {
        const n = { ...p };
        delete n[i];
        return n;
      });
    }
  };

  const busy = Object.keys(uploading).length > 0;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const total = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-navy-950">Expenses &amp; bills</h3>
          <p className="text-xs text-slate-500">Each bill goes to the MD for approval when you submit the report.</p>
        </div>
        <Button type="button" size="sm" variant="outline" leftIcon={<Plus className="w-4 h-4" />} onClick={() => onChange((p) => [...p, emptyExpense()])}>
          Add expense
        </Button>
      </div>

      {expenses.length === 0 ? (
        <p className="text-xs text-slate-500">No expenses today.</p>
      ) : (
        expenses.map((e, i) => {
          const locked = isLocked(e);
          const pct = uploading[i];
          return (
            <fieldset key={e._id || i} disabled={locked} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 min-w-0">
              <legend className="sr-only">Expense {i + 1}</legend>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Select
                    aria-label="Expense category"
                    value={e.category}
                    onChange={(ev) => update(i, { category: ev.target.value as ExpenseCategory })}
                    options={EXPENSE_CATEGORY_OPTIONS}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="0.01"
                    aria-label={e.gst?.isGstBill ? 'Bill total in rupees (calculated from GST)' : 'Amount in rupees'}
                    placeholder="Amount"
                    leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
                    value={e.amount}
                    readOnly={!!e.gst?.isGstBill}
                    className={e.gst?.isGstBill ? 'bg-slate-100 font-semibold' : ''}
                    onChange={(ev) => update(i, { amount: ev.target.value })}
                  />
                </div>
                {locked ? (
                  <span className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400" title={`Already ${e.status?.toLowerCase()} — managed from Expenses`}>
                    <Lock className="w-4 h-4" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChange((p) => p.filter((_, idx) => idx !== i))}
                    aria-label={`Remove expense ${i + 1}`}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-200 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Input aria-label="Expense description" placeholder="What was it for? e.g. 50 bags cement" maxLength={1000} value={e.description} onChange={(ev) => update(i, { description: ev.target.value })} />
              <Input aria-label="Vendor or payee" placeholder="Vendor / paid to (optional)" maxLength={200} value={e.vendor} onChange={(ev) => update(i, { vendor: ev.target.value })} />
              <GstBillFields
                value={e.gst}
                companyGstin={companyGstin}
                disabled={locked}
                onChange={(gst) => {
                  const total = gst?.isGstBill ? gstDraftTotalRupees(gst, companyGstin) : undefined;
                  update(i, { gst, ...(total !== undefined ? { amount: total > 0 ? String(total) : '' } : {}) });
                }}
              />

              <div className="flex flex-wrap items-center gap-2">
                {e.receiptUrl && <ReceiptThumb url={e.receiptUrl} className="w-12 h-12" label="bill" />}
                {!locked && (
                  <>
                    <label className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg bg-navy-900 text-white text-xs font-semibold cursor-pointer">
                      <Camera className="w-4 h-4 text-brand-400" />
                      {e.receiptUrl ? 'Retake bill' : 'Photo of bill'}
                      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(ev) => { uploadReceipt(i, ev.target.files?.[0]); ev.target.value = ''; }} />
                    </label>
                    <label className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold cursor-pointer">
                      <Paperclip className="w-4 h-4" />
                      PDF / file
                      <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(ev) => { uploadReceipt(i, ev.target.files?.[0]); ev.target.value = ''; }} />
                    </label>
                    {e.receiptUrl && (
                      <button type="button" onClick={() => update(i, { receiptUrl: undefined })} className="text-xs font-semibold text-rose-600 min-h-[40px] px-2">
                        Remove bill
                      </button>
                    )}
                  </>
                )}
                {pct !== undefined && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-600" role="status">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading {pct}%
                  </span>
                )}
                {errors[i] && (
                  <span className="flex items-center gap-1 text-xs text-rose-600 font-semibold" role="alert">
                    <AlertTriangle className="w-3.5 h-3.5" /> {errors[i]}
                  </span>
                )}
                {locked && <span className="text-[11px] font-semibold text-slate-500">Status: {e.status}</span>}
              </div>
            </fieldset>
          );
        })
      )}

      {total > 0 && (
        <div className="text-right text-sm font-semibold text-slate-700">
          Total today: <span className="text-navy-950">{formatRupees(total)}</span>
        </div>
      )}
    </div>
  );
};
