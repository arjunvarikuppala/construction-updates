import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileCheck2,
  Send,
  RefreshCw,
  XCircle,
  Building2,
  Receipt,
  User,
  History,
  Lock,
} from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Input } from '../common/Input.js';
import { PaymentRequest } from '../../types/index.js';
import { formatINR } from '../../utils/currency.js';
import { formatDate } from '../../utils/dates.js';
import { useAuth } from '../../context/AuthContext.js';
import { useToast } from '../../context/ToastContext.js';
import { api } from '../../api/client.js';

interface PaymentReviewModalProps {
  payment: PaymentRequest | null;
  isOpen: boolean;
  onClose: () => void;
}

export const PaymentReviewModal: React.FC<PaymentReviewModalProps> = ({ payment, isOpen, onClose }) => {
  const queryClient = useQueryClient();
  const { isMD } = useAuth();
  const { success, error: toastError } = useToast();

  const [authNotes, setAuthNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);

  // Authorize Mutation
  const authorizeMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/payments/requests/${payment?._id}/authorize`, { notes: authNotes });
    },
    onSuccess: () => {
      success('Payment request authorized successfully by Managing Director!');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      setAuthNotes('');
      onClose();
    },
    onError: (err: any) => {
      toastError(err.message || 'Failed to authorize payment');
    },
  });

  // Initiate Transfer Mutation
  const initiateMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/payments/requests/${payment?._id}/initiate`, {});
    },
    onSuccess: (res: any) => {
      success(res.message || 'Payment transfer processed!');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      onClose();
    },
    onError: (err: any) => {
      toastError(err.message || 'Transfer initiation failed');
    },
  });

  // Reconcile Mutation
  const reconcileMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/payments/requests/${payment?._id}/reconcile`, {});
    },
    onSuccess: (res: any) => {
      success(res.message || 'Status reconciled with bank gateway!');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err: any) => {
      toastError(err.message || 'Reconciliation query failed');
    },
  });

  // Cancel Mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/payments/requests/${payment?._id}/cancel`, { reason: cancelReason });
    },
    onSuccess: () => {
      success('Payment request cancelled.');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      setShowCancelPrompt(false);
      setCancelReason('');
      onClose();
    },
    onError: (err: any) => {
      toastError(err.message || 'Failed to cancel payment');
    },
  });

  if (!payment) return null;

  const isAwaitingAuth = payment.status === 'AWAITING_AUTHORIZATION';
  const isDraft = payment.status === 'DRAFT';
  const isSettled = payment.status === 'PAID';
  const isFailed = payment.status === 'FAILED';
  const isUnknownOrInFlight =
    payment.status === 'UNKNOWN' || payment.status === 'SUBMITTED' || payment.status === 'PROCESSING';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Payment Review & Executive Authorization"
      description={`Reference: ${payment.paymentReference} • Created ${formatDate(payment.createdAt)}`}
      size="lg"
    >
      <div className="space-y-5">
        {/* Top Header Card */}
        <div className="p-4 bg-navy-950 text-white rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div>
            <span className="text-[11px] text-navy-200 block font-semibold uppercase tracking-wider">
              Disbursement Amount
            </span>
            <span className="text-2xl sm:text-3xl font-black text-amber-400 mt-0.5 block font-mono">
              {formatINR(payment.amount)}
            </span>
            <span className="text-xs text-navy-300 font-medium mt-0.5 block">
              Method: <strong>{payment.paymentMethod}</strong> • {payment.payeeType} Payment
            </span>
          </div>

          <div className="text-right">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                payment.status === 'PAID'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : payment.status === 'AWAITING_AUTHORIZATION'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : payment.status === 'PROCESSING' || payment.status === 'SUBMITTED'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  : payment.status === 'FAILED'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'bg-slate-700 text-slate-200'
              }`}
            >
              {payment.status === 'PAID' && <CheckCircle2 className="w-3.5 h-3.5" />}
              {payment.status === 'AWAITING_AUTHORIZATION' && <Clock className="w-3.5 h-3.5" />}
              {payment.status === 'FAILED' && <XCircle className="w-3.5 h-3.5" />}
              {payment.status.replace(/_/g, ' ')}
            </span>
            {payment.providerUtr && (
              <span className="block font-mono text-[11px] text-emerald-400 mt-1">
                UTR: {payment.providerUtr}
              </span>
            )}
          </div>
        </div>

        {/* High-Value Authorization Banner if needed */}
        {isAwaitingAuth && (
          <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-300 text-xs text-amber-950 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold block">
                Independent MD Authorization Required (&gt; ₹1,00,000)
              </span>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                As a corporate fraud prevention measure, transactions above ₹1,00,000 must be reviewed and authorized by the Managing Director prior to dispatching corporate bank transfers.
              </p>
            </div>
          </div>
        )}

        {/* Beneficiary & Bank Details Grid */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
          <span className="text-xs font-bold text-navy-950 block uppercase tracking-wider">
            Verified Beneficiary Details
          </span>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Payee Name</span>
              <span className="font-bold text-navy-950 block">{payment.payeeNameSnapshot}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Bank Name</span>
              <span className="font-semibold text-slate-800 block">{payment.bankNameSnapshot}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Account Number</span>
              <span className="font-mono font-bold text-navy-950 block">
                {payment.accountNumberMaskedSnapshot}
              </span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">IFSC Code</span>
              <span className="font-mono font-semibold text-slate-800 block">{payment.ifscSnapshot}</span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Project</span>
              <span className="font-semibold text-slate-800 block">
                {payment.project?.code} - {payment.project?.name}
              </span>
            </div>

            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Invoice / Ref</span>
              <span className="font-semibold text-slate-800 block">
                {payment.invoiceNumber || 'None specified'}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 text-xs">
            <span className="text-slate-400 block text-[10px] uppercase font-bold">Purpose / Remarks</span>
            <p className="text-slate-800 font-medium mt-0.5">{payment.purpose}</p>
          </div>
        </div>

        {/* Failure Reason if Failed */}
        {isFailed && payment.failureReason && (
          <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-800">
            <span className="font-bold block">Bank Clearing Rejection Reason:</span>
            <p className="mt-0.5 text-rose-700">{payment.failureReason}</p>
          </div>
        )}

        {/* Audit Trail Timeline */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-navy-950 uppercase tracking-wider">
            <History className="w-3.5 h-3.5 text-amber-600" />
            <span>Audit Trail & Security Verification</span>
          </div>

          <div className="max-h-40 overflow-y-auto space-y-2 pr-1 divide-y divide-slate-100">
            {payment.auditTrail.map((entry, idx) => (
              <div key={idx} className="pt-2 first:pt-0 text-[11px] flex items-start justify-between">
                <div>
                  <span className="font-bold text-navy-950 block">{entry.action}</span>
                  <span className="text-slate-500 block">{entry.note}</span>
                </div>
                <span className="text-[10px] text-slate-400 whitespace-nowrap ml-2">
                  {formatDate(entry.timestamp, 'dd MMM, HH:mm')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Controls for MD & Users */}
        <div className="pt-3 border-t border-slate-200 space-y-3">
          {/* Executive MD Authorization Form */}
          {isAwaitingAuth && isMD && (
            <div className="p-3 bg-navy-50 rounded-xl border border-navy-200 space-y-2.5">
              <span className="text-xs font-bold text-navy-950 block">
                Executive MD Authorization Action
              </span>
              <Input
                placeholder="Optional authorization note (e.g. Verified with site engineer)"
                value={authNotes}
                onChange={(e) => setAuthNotes(e.target.value)}
              />
              <Button
                variant="amber"
                className="w-full font-bold"
                onClick={() => authorizeMutation.mutate()}
                isLoading={authorizeMutation.isPending}
                leftIcon={<FileCheck2 className="w-4 h-4 text-navy-950" />}
              >
                Authorize High-Value Payment
              </Button>
            </div>
          )}

          {/* Cancellation Form Prompt */}
          {showCancelPrompt && (
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 space-y-2">
              <span className="text-xs font-bold text-rose-900 block">Cancel Payment Request</span>
              <Input
                placeholder="Reason for cancellation"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowCancelPrompt(false)}
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="bg-rose-600 hover:bg-rose-700"
                  onClick={() => cancelMutation.mutate()}
                  isLoading={cancelMutation.isPending}
                >
                  Confirm Cancellation
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {(isDraft || isAwaitingAuth) && !showCancelPrompt && (
                <button
                  type="button"
                  onClick={() => setShowCancelPrompt(true)}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                >
                  Cancel Request
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>

              {/* Status Reconciliation button */}
              {isUnknownOrInFlight && (
                <Button
                  variant="primary"
                  onClick={() => reconcileMutation.mutate()}
                  isLoading={reconcileMutation.isPending}
                  leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                >
                  Reconcile Bank Status
                </Button>
              )}

              {/* Initiate Transfer button */}
              {isDraft && isMD && (
                <Button
                  variant="amber"
                  className="font-bold"
                  onClick={() => initiateMutation.mutate()}
                  isLoading={initiateMutation.isPending}
                  leftIcon={<Send className="w-4 h-4 text-navy-950" />}
                >
                  Initiate {payment.paymentMethod} Transfer
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
