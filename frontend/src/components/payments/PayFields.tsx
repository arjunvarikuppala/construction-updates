import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone, Upload, CheckCircle2, X, Info } from 'lucide-react';
import { Input, Textarea } from '../common/Input.js';
import { localDateString } from '../../utils/dates.js';
import { uploadFileWithProgress } from '../../utils/upload.js';
import { MODE_OPTIONS, inr, isValidVpa, upiPayLink } from '../../utils/payments.js';
import type { SettlementMode } from '../../types/index.js';

const NO_SPIN = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export interface PayDraft {
  amount: string;
  mode: Exclude<SettlementMode, 'RAZORPAYX'>;
  reference: string;
  paidOn: string;
  proofUrl: string;
  proofName: string;
  note: string;
}

export const emptyPayDraft = (amountPaise: number, hasVpa: boolean): PayDraft => ({
  amount: amountPaise > 0 ? String(amountPaise / 100) : '',
  mode: hasVpa ? 'UPI' : 'BANK_TRANSFER',
  reference: '',
  paidOn: localDateString(),
  proofUrl: '',
  proofName: '',
  note: '',
});

/** Problems that block saving (empty = OK) */
export function payDraftProblems(d: PayDraft, balancePaise: number): string[] {
  const p: string[] = [];
  const paise = Math.round((parseFloat(d.amount) || 0) * 100);
  if (paise < 100) p.push('enter the amount paid');
  else if (balancePaise > 0 && paise > balancePaise) p.push(`amount is more than the balance (${inr(balancePaise)})`);
  if (d.mode !== 'CASH') {
    const ref = d.reference.replace(/\s+/g, '');
    if (!ref) p.push(d.mode === 'CHEQUE' ? 'enter the cheque number' : 'enter the UTR / reference');
    else if (!/^[A-Za-z0-9/-]{4,40}$/.test(ref)) p.push('reference should be letters or digits only');
    else if (d.mode === 'UPI' && !/^\d{12}$/.test(ref) && !/^[A-Za-z0-9]{12,35}$/.test(ref)) p.push('a UPI UTR is usually 12 digits');
  }
  if (!d.paidOn) p.push('choose the payment date');
  return p;
}

export const payDraftToPayload = (d: PayDraft, settlementKey: string) => ({
  settlementKey,
  amountRupees: d.amount,
  mode: d.mode,
  reference: d.mode === 'CASH' ? undefined : d.reference.replace(/\s+/g, ''),
  paidOn: d.paidOn,
  proofUrl: d.proofUrl || undefined,
  note: d.note.trim() || undefined,
});

interface Props {
  value: PayDraft;
  onChange: (next: PayDraft) => void;
  /** Remaining balance in paise; 0 = no limit known yet (new request) */
  balancePaise: number;
  payee: { name: string; vpa?: string };
  note: string;
  disabled?: boolean;
}

/** How the MD paid: UPI app shortcut + QR, mode, UTR / cheque no., date and proof. */
export const PayFields: React.FC<Props> = ({ value, onChange, balancePaise, payee, note, disabled }) => {
  const set = (patch: Partial<PayDraft>) => onChange({ ...value, ...patch });
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const amountPaise = Math.round((parseFloat(value.amount) || 0) * 100);
  const vpaOk = Boolean(payee.vpa && isValidVpa(payee.vpa));
  const link = vpaOk && amountPaise >= 100 ? upiPayLink({ vpa: payee.vpa!, name: payee.name, amountPaise, note }) : '';
  const modeMeta = MODE_OPTIONS.find((m) => m.value === value.mode)!;

  useEffect(() => {
    if (value.mode === 'UPI' && link && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, link, { width: 148, margin: 1 }).catch(() => undefined);
    }
  }, [link, value.mode]);

  const onProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError('');
    setUploading(1);
    try {
      const up = await uploadFileWithProgress(file, (pct) => setUploading(Math.max(1, pct)));
      set({ proofUrl: up.url, proofName: up.originalName });
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploading(0);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">How did you pay?</span>
        <div role="radiogroup" aria-label="Payment mode" className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={value.mode === m.value}
              disabled={disabled}
              onClick={() => set({ mode: m.value })}
              className={`min-h-[40px] px-2 rounded-xl border text-xs font-bold transition ${
                value.mode === m.value
                  ? 'bg-navy-900 border-navy-900 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Amount paid"
          type="number"
          inputMode="decimal"
          min="1"
          step="0.01"
          className={NO_SPIN}
          leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
          value={value.amount}
          onChange={(e) => set({ amount: e.target.value })}
          helperText={
            balancePaise > 0
              ? amountPaise > 0 && amountPaise < balancePaise
                ? `Part payment — ${inr(balancePaise - amountPaise)} will stay due`
                : `Balance due ${inr(balancePaise)}`
              : undefined
          }
          disabled={disabled}
        />
        <Input
          label="Paid on"
          type="date"
          max={localDateString()}
          value={value.paidOn}
          onChange={(e) => set({ paidOn: e.target.value })}
          disabled={disabled}
        />
      </div>

      {value.mode === 'UPI' && amountPaise > 10000000 && (
        <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex items-start gap-1.5">
          <Info className="w-4 h-4 text-amber-600 shrink-0" />
          Most UPI apps allow up to ₹1,00,000 per payment. Pay ₹1,00,000 now and record the rest as a second payment, or use bank transfer.
        </p>
      )}

      {value.mode === 'UPI' && (
        <div className="p-3 rounded-xl border border-sky-200 bg-sky-50/60">
          {vpaOk ? (
            <div className="flex flex-col sm:flex-row gap-3 items-start">
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-xs text-slate-700">
                  Pay <strong>{payee.name}</strong> at <span className="font-mono font-semibold break-all">{payee.vpa}</span>
                  {amountPaise >= 100 && <> — <strong>{inr(amountPaise)}</strong></>}
                </p>
                {link ? (
                  <a
                    href={link}
                    className="inline-flex items-center gap-2 min-h-[40px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                  >
                    <Smartphone className="w-4 h-4" /> Open UPI app to pay
                  </a>
                ) : (
                  <p className="text-[11px] text-slate-500">Enter the amount to get the UPI pay button.</p>
                )}
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  On a computer, scan the QR with your phone. After paying, copy the 12-digit UTR from the app receipt below.
                </p>
              </div>
              {link && <canvas ref={canvasRef} aria-label="UPI payment QR code" className="rounded-lg bg-white border border-slate-200 shrink-0" />}
            </div>
          ) : (
            <p className="text-xs text-slate-600 flex items-start gap-1.5">
              <Info className="w-4 h-4 text-sky-600 shrink-0" />
              No UPI ID saved for {payee.name}. Pay from your UPI app by phone number or QR, then enter the UTR below.
            </p>
          )}
        </div>
      )}

      {value.mode !== 'CASH' && (
        <Input
          label={modeMeta.refLabel}
          maxLength={40}
          autoCapitalize="characters"
          inputMode={value.mode === 'UPI' || value.mode === 'CHEQUE' ? 'numeric' : 'text'}
          value={value.reference}
          onChange={(e) => set({ reference: e.target.value.replace(/\s+/g, '') })}
          helperText={modeMeta.refHint}
          disabled={disabled}
        />
      )}

      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">
          Proof {value.mode === 'CASH' ? '(signed voucher photo, optional)' : '(payment screenshot, recommended)'}
        </span>
        {value.proofUrl ? (
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-xs">
            <span className="flex items-center gap-1.5 min-w-0 text-emerald-800 font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{value.proofName || 'Proof attached'}</span>
            </span>
            <button
              type="button"
              aria-label="Remove proof"
              onClick={() => set({ proofUrl: '', proofName: '' })}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label className="flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-dashed border-slate-300 hover:border-amber-500 hover:bg-amber-50/30 cursor-pointer text-xs font-semibold text-slate-700">
            <Upload className="w-4 h-4 text-slate-400" />
            {uploading ? `Uploading… ${uploading}%` : 'Attach screenshot / photo'}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onProof} disabled={disabled || uploading > 0} />
          </label>
        )}
        {uploadError && <p className="text-[11px] text-rose-600 mt-1">{uploadError}</p>}
      </div>

      <Textarea
        label="Note (optional)"
        rows={2}
        maxLength={300}
        value={value.note}
        onChange={(e) => set({ note: e.target.value })}
        disabled={disabled}
      />
    </div>
  );
};
