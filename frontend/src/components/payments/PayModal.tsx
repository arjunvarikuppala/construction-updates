import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { useToast } from '../../context/ToastContext.js';
import { api } from '../../api/client.js';
import type { PaymentRequest } from '../../types/index.js';
import { PayFields, PayDraft, emptyPayDraft, payDraftProblems, payDraftToPayload } from './PayFields.js';
import { balancePaiseOf, inr, newSettlementKey, paidPaiseOf, payeeKindOf } from '../../utils/payments.js';

interface Props {
  payment: PaymentRequest | null;
  isOpen: boolean;
  onClose: () => void;
  onPaid?: (updated: PaymentRequest) => void;
}

/** MD approves a request by paying it, in full or in part. */
export const PayModal: React.FC<Props> = ({ payment, isOpen, onClose, onPaid }) => {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const balance = payment ? balancePaiseOf(payment) : 0;
  const [draft, setDraft] = useState<PayDraft>(() => emptyPayDraft(balance, Boolean(payment?.vpaSnapshot)));
  const [settlementKey, setSettlementKey] = useState(newSettlementKey);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Fresh form (and a fresh idempotency key) every time it opens for a request
  useEffect(() => {
    if (isOpen && payment) {
      setDraft(emptyPayDraft(balancePaiseOf(payment), Boolean(payment.vpaSnapshot)));
      setSettlementKey(newSettlementKey());
      setShowErrors(false);
    }
  }, [isOpen, payment?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = useMemo(() => payDraftProblems(draft, balance), [draft, balance]);
  if (!payment) return null;
  const isInCharge = payeeKindOf(payment) === 'INCHARGE';

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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payment-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-request', payment._id] }),
      ]);
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={saving ? () => undefined : onClose}
      title={`Pay ${payment.payeeNameSnapshot}`}
      description={`${payment.paymentReference} · ${payment.purpose}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} isLoading={saving} leftIcon={<Wallet className="w-4 h-4" />}>
            {paidPaiseOf(payment) > 0 ? 'Record payment' : 'Approve & record payment'}
          </Button>
        </>
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
          {payment.accountNumberMaskedSnapshot && (
            <span className="font-mono"> · A/C {payment.accountNumberMaskedSnapshot} · {payment.ifscSnapshot}</span>
          )}
        </p>

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
      </div>
    </Modal>
  );
};
