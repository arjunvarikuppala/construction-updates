import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, Zap, NotebookPen } from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { useToast } from '../../context/ToastContext.js';
import { api } from '../../api/client.js';
import type { PaymentRequest, PayoutMode, PayoutOptions } from '../../types/index.js';
import { PayFields, PayDraft, emptyPayDraft, payDraftProblems, payDraftToPayload } from './PayFields.js';
import { RazorpayXPayout } from './RazorpayXPayout.js';
import { balancePaiseOf, inr, newSettlementKey, paidPaiseOf, payeeKindOf } from '../../utils/payments.js';

interface Props {
  payment: PaymentRequest | null;
  isOpen: boolean;
  onClose: () => void;
  onPaid?: (updated: PaymentRequest) => void;
}

/**
 * MD approves a request by paying it, in full or in part:
 * - "Send with RazorpayX": money leaves the RazorpayX account right now (when set up)
 * - "Record a payment": already paid from own UPI app / bank / cheque / cash
 */
export const PayModal: React.FC<Props> = ({ payment, isOpen, onClose, onPaid }) => {
  const { success, error: toastError, showToast } = useToast();
  const queryClient = useQueryClient();
  const balance = payment ? balancePaiseOf(payment) : 0;
  const [draft, setDraft] = useState<PayDraft>(() => emptyPayDraft(balance, Boolean(payment?.vpaSnapshot)));
  const [settlementKey, setSettlementKey] = useState(newSettlementKey);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [tab, setTab] = useState<'razorpayx' | 'record'>('record');

  const { data: options } = useQuery({
    queryKey: ['payout-options', payment?._id],
    queryFn: () => api.get<PayoutOptions>(`/payments/requests/${payment!._id}/payout-options`),
    enabled: isOpen && Boolean(payment?._id),
    staleTime: 0,
  });
  const canRazorpay = Boolean(options?.enabled && options.modes.length > 0);

  // Fresh form (and a fresh idempotency key) every time it opens for a request
  useEffect(() => {
    if (isOpen && payment) {
      setDraft(emptyPayDraft(balancePaiseOf(payment), Boolean(payment.vpaSnapshot)));
      setSettlementKey(newSettlementKey());
      setShowErrors(false);
    }
  }, [isOpen, payment?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isOpen) setTab(canRazorpay ? 'razorpayx' : 'record');
  }, [isOpen, canRazorpay]);

  const problems = useMemo(() => payDraftProblems(draft, balance), [draft, balance]);
  if (!payment) return null;
  const isInCharge = payeeKindOf(payment) === 'INCHARGE';

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['payment-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['payment-request', payment._id] }),
      queryClient.invalidateQueries({ queryKey: ['payout-options', payment._id] }),
    ]);

  const submit = async () => {
    if (problems.length) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ message: string; payment: PaymentRequest }>(
        `/payments/requests/${payment._id}/pay`,
        payDraftToPayload(draft, settlementKey)
      );
      success(res.message || 'Payment recorded');
      await refresh();
      onPaid?.(res.payment);
      onClose();
    } catch (err: any) {
      // A conflict (duplicate UTR / changed balance) needs a new attempt key
      setSettlementKey(newSettlementKey());
      toastError(err.message || 'Could not record the payment');
    } finally {
      setSaving(false);
    }
  };

  const sendPayout = async (amountPaise: number, mode: PayoutMode) => {
    setSaving(true);
    try {
      const res = await api.post<{ message: string; outcome: string; payment: PaymentRequest }>(
        `/payments/requests/${payment._id}/initiate`,
        { amountPaise, mode }
      );
      if (res.outcome === 'paid') success(res.message);
      else showToast(res.message, res.outcome === 'unknown' ? 'warning' : 'info');
      await refresh();
      onPaid?.(res.payment);
      onClose();
    } catch (err: any) {
      toastError(err.message || 'The payout could not be sent');
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={saving ? () => undefined : onClose}
      title={`Pay ${payment.payeeNameSnapshot}`}
      description={`${payment.paymentReference} · ${payment.purpose}`}
      size="lg"
      footer={
        tab === 'record' ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} isLoading={saving} leftIcon={<Wallet className="w-4 h-4" />}>
              {paidPaiseOf(payment) > 0 ? 'Record payment' : 'Approve & record payment'}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Requested', value: inr(payment.amount) },
            { label: 'Paid so far', value: inr(paidPaiseOf(payment)) },
            { label: 'Balance due', value: inr(balance), strong: true },
          ].map((k) => (
            <div key={k.label} className={`p-2.5 rounded-xl border ${k.strong ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
              <span className="block text-[10px] uppercase font-bold text-slate-500">{k.label}</span>
              <span className={`block text-sm sm:text-base font-black ${k.strong ? 'text-amber-800' : 'text-navy-950'}`}>{k.value}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-600">
          {isInCharge ? 'Site In-Charge' : 'Vendor'}: <strong className="text-navy-950">{payment.payeeNameSnapshot}</strong>
          {payment.vpaSnapshot && <span className="font-mono"> · UPI {payment.vpaSnapshot}</span>}
          {payment.accountNumberMaskedSnapshot && (
            <span className="font-mono"> · A/C {payment.accountNumberMaskedSnapshot} · {payment.ifscSnapshot}</span>
          )}
        </p>

        {payment.failureReason && (
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
            Last attempt: {payment.failureReason}
          </p>
        )}

        {canRazorpay && (
          <div role="tablist" aria-label="How to pay" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
            {[
              { id: 'razorpayx' as const, icon: Zap, label: 'Send with RazorpayX' },
              { id: 'record' as const, icon: NotebookPen, label: 'Record a payment I made' },
            ].map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                disabled={saving}
                className={`min-h-[40px] px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${
                  tab === t.id ? 'bg-white shadow text-navy-950' : 'text-slate-600'
                }`}
              >
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>
        )}

        {tab === 'razorpayx' && options && canRazorpay ? (
          <RazorpayXPayout payment={payment} options={options} sending={saving} onSend={sendPayout} />
        ) : (
          <>
            <PayFields
              value={draft}
              onChange={setDraft}
              balancePaise={balance}
              payee={{ name: payment.payeeNameSnapshot, vpa: payment.vpaSnapshot }}
              note={`${payment.paymentReference} ${payment.purpose}`}
              disabled={saving}
            />
            {showErrors && problems.length > 0 && (
              <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5">
                Please fix: {problems.join(', ')}.
              </p>
            )}
            <p className="text-[11px] text-slate-500">
              Recording this marks the request {balance > 0 ? 'paid (or part paid)' : 'paid'}, notifies{' '}
              {isInCharge ? payment.payeeNameSnapshot : 'the site team'} and adds it to the monthly payments register.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
};
