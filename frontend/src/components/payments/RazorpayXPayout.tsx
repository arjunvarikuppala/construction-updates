import React, { useEffect, useMemo, useState } from 'react';
import { Send, ShieldCheck, Zap, AlertTriangle } from 'lucide-react';
import { Input } from '../common/Input.js';
import { Button } from '../common/Button.js';
import type { PaymentRequest, PayoutMode, PayoutOptions } from '../../types/index.js';
import { inr } from '../../utils/payments.js';

const NO_SPIN = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

const MODE_INFO: Record<PayoutMode, { label: string; hint: string }> = {
  UPI: { label: 'UPI', hint: 'Instant to the UPI ID · up to ₹1,00,000' },
  IMPS: { label: 'IMPS', hint: 'Instant to the bank account · up to ₹5,00,000' },
  NEFT: { label: 'NEFT', hint: 'Bank account · within a few hours' },
  RTGS: { label: 'RTGS', hint: 'Bank account · ₹2,00,000 and above' },
};

interface Props {
  payment: PaymentRequest;
  options: PayoutOptions;
  sending: boolean;
  onSend: (amountPaise: number, mode: PayoutMode) => void;
}

/** "Send now with RazorpayX": choose amount and rail, confirm, send. */
export const RazorpayXPayout: React.FC<Props> = ({ payment, options, sending, onSend }) => {
  const balance = options.balancePaise;
  const [amount, setAmount] = useState(String(balance / 100));
  const [mode, setMode] = useState<PayoutMode | ''>('');
  const [confirming, setConfirming] = useState(false);
  const amountPaise = Math.round((parseFloat(amount) || 0) * 100);

  const fits = (m: PayoutMode) => amountPaise >= options.limits[m].min && amountPaise <= options.limits[m].max;

  // Pick the fastest rail that fits the amount
  useEffect(() => {
    if (mode && options.modes.includes(mode) && fits(mode)) return;
    const best = (['UPI', 'IMPS', 'NEFT', 'RTGS'] as PayoutMode[]).find((m) => options.modes.includes(m) && fits(m));
    setMode(best || '');
  }, [amountPaise, options.modes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setConfirming(false), [amountPaise, mode]);

  const problem = useMemo(() => {
    if (amountPaise < 100) return 'Enter the amount to send.';
    if (amountPaise > balance) return `That is more than the balance due (${inr(balance)}).`;
    if (!mode) return 'This amount is outside the limits of the available payment methods. Send it in parts.';
    if (!fits(mode)) {
      const l = options.limits[mode];
      return amountPaise < l.min ? `${mode} needs at least ${inr(l.min)}.` : `${mode} allows at most ${inr(l.max)} per payout.`;
    }
    return '';
  }, [amountPaise, balance, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const dest =
    mode === 'UPI'
      ? payment.vpaSnapshot
      : payment.accountNumberMaskedSnapshot
      ? `A/C ${payment.accountNumberMaskedSnapshot} · ${payment.ifscSnapshot || ''}`
      : '';

  return (
    <div className="space-y-3">
      {options.mode === 'test' && (
        <p className="text-[11px] font-semibold text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-2.5 py-1.5">
          TEST MODE — RazorpayX test keys are in use. No real money moves.
        </p>
      )}

      <Input
        label="Amount to send"
        type="number"
        inputMode="decimal"
        min="1"
        step="0.01"
        className={NO_SPIN}
        leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        helperText={amountPaise > 0 && amountPaise < balance ? `Part payment — ${inr(balance - amountPaise)} will stay due` : `Balance due ${inr(balance)}`}
        disabled={sending}
      />

      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">Send by</span>
        <div role="radiogroup" aria-label="Payout method" className="grid grid-cols-2 gap-1.5">
          {(['UPI', 'IMPS', 'NEFT', 'RTGS'] as PayoutMode[]).map((m) => {
            const available = options.modes.includes(m);
            const ok = available && fits(m);
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={!ok || sending}
                onClick={() => setMode(m)}
                title={!available ? (m === 'UPI' ? 'No UPI ID saved for this payee' : 'No bank account saved for this payee') : !ok ? 'Amount outside this method’s limit' : undefined}
                className={`text-left p-2.5 rounded-xl border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  mode === m ? 'bg-navy-900 border-navy-900 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="block text-xs font-bold">{MODE_INFO[m].label}</span>
                <span className={`block text-[10px] ${mode === m ? 'text-slate-300' : 'text-slate-500'}`}>
                  {available ? MODE_INFO[m].hint : m === 'UPI' ? 'No UPI ID saved' : 'No bank account saved'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {problem ? (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5 flex gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {problem}
        </p>
      ) : !confirming ? (
        <Button className="w-full" onClick={() => setConfirming(true)} leftIcon={<Zap className="w-4 h-4" />}>
          Send {inr(amountPaise)} by {mode}
        </Button>
      ) : (
        <div className="p-3 rounded-xl border-2 border-amber-400 bg-amber-50 space-y-2.5">
          <p className="text-sm text-navy-950">
            <strong>{inr(amountPaise)}</strong> will leave your RazorpayX account now and go to <strong>{payment.payeeNameSnapshot}</strong>
            {dest && <span className="font-mono text-xs break-all"> ({dest})</span>} by {mode}.
          </p>
          <p className="text-[11px] text-slate-600 flex items-start gap-1">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-600" /> Sent once only — even if you tap twice or the network drops.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setConfirming(false)} disabled={sending}>
              Back
            </Button>
            <Button className="flex-1" isLoading={sending} onClick={() => onSend(amountPaise, mode as PayoutMode)} leftIcon={<Send className="w-4 h-4" />}>
              Confirm & send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
