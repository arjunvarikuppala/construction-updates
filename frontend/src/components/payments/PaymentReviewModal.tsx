import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  X,
  Building2,
  Users,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  FileText,
  ExternalLink,
  MessageSquare,
  Clock,
  Send,
  RefreshCw,
  Ban,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../common/Button.js';
import { useToast } from '../../context/ToastContext.js';
import { useAuth } from '../../context/AuthContext.js';
import { PaymentRequest } from '../../types/index.js';
import { formatDate } from '../../utils/dates.js';

interface PaymentReviewModalProps {
  payment: PaymentRequest | null;
  isOpen: boolean;
  onClose: () => void;
}

export const PaymentReviewModal: React.FC<PaymentReviewModalProps> = ({
  payment,
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [reviewNote, setReviewNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Authorize Mutation
  const authorizeMutation = useMutation({
    mutationFn: (note?: string) =>
      api.post(`/payments/requests/${payment?._id || payment?.id}/authorize`, { note }),
    onSuccess: () => {
      showToast('Payment request authorized successfully', 'success');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['payment-stats'] });
      onClose();
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to authorize payment', 'error');
    },
  });

  // Reject Mutation
  const rejectMutation = useMutation({
    mutationFn: (reason: string) =>
      api.post(`/payments/requests/${payment?._id || payment?.id}/reject`, { reason }),
    onSuccess: () => {
      showToast('Payment request rejected', 'info');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['payment-stats'] });
      onClose();
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to reject payment', 'error');
    },
  });

  // Initiate Payout Mutation
  const initiatePayoutMutation = useMutation({
    mutationFn: () =>
      api.post(`/payments/requests/${payment?._id || payment?.id}/initiate`, {}),
    onSuccess: (data: any) => {
      showToast(data.message || 'Payout transfer submitted to RazorpayX', 'success');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['payment-stats'] });
      onClose();
    },
    onError: (err: any) => {
      showToast(err.message || 'Payout transfer failed', 'error');
    },
  });

  // Reconcile Status Mutation
  const reconcileMutation = useMutation({
    mutationFn: () =>
      api.post(`/payments/requests/${payment?._id || payment?.id}/reconcile`, {}),
    onSuccess: (data: any) => {
      showToast(`Status reconciled: ${data.payment?.status}`, 'info');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['payment-stats'] });
    },
    onError: (err: any) => {
      showToast(err.message || 'Reconciliation inquiry failed', 'error');
    },
  });

  if (!isOpen || !payment) return null;

  const currentUserId = user?.id || (user as any)?._id;
  const creatorId =
    typeof payment.createdBy === 'object'
      ? (payment.createdBy as any)._id || (payment.createdBy as any).id
      : payment.createdBy;

  const amount = payment.amountPaise || payment.amount || 0;
  const isHighValue = Boolean(payment.isHighValue || payment.requiresHighValueAuth || amount >= 10000000);
  const isCreator = Boolean(currentUserId && creatorId && String(currentUserId) === String(creatorId));
  const isDualAuthBlocked = isHighValue && isCreator;

  const referenceNumber = payment.referenceNumber || payment.paymentReference;
  const preferredMethod = payment.preferredMethod || payment.paymentMethod;
  const payeeName = payment.beneficiarySnapshot?.name || payment.payeeNameSnapshot;
  const vpa = payment.beneficiarySnapshot?.vpa || payment.vpaSnapshot;
  const accountNumberMasked = payment.beneficiarySnapshot?.accountNumberMasked || payment.accountNumberMaskedSnapshot;
  const ifsc = payment.beneficiarySnapshot?.ifsc || payment.ifscSnapshot;
  const bankName = payment.beneficiarySnapshot?.bankName || payment.bankNameSnapshot;
  const projectCode = payment.projectSnapshot?.code || payment.project?.code;
  const projectName = payment.projectSnapshot?.name || payment.project?.name;
  const requestedDate = payment.requestedDate || payment.requestedPaymentDate;
  const remarks = payment.remarks || payment.inchargeRemarks;
  const utr = payment.razorpayxUtr || payment.providerUtr;

  const canAuthorize =
    isOwner &&
    !isDualAuthBlocked &&
    ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_AUTHORIZATION'].includes(payment.status);

  const canInitiate =
    isOwner && payment.status === 'AUTHORIZED';

  const canReconcile =
    isOwner && ['PROCESSING', 'UNKNOWN', 'SUBMITTED'].includes(payment.status);

  const canReject =
    isOwner &&
    ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_AUTHORIZATION', 'AUTHORIZED'].includes(payment.status);

  const projectId =
    typeof payment.project === 'object' ? payment.project._id : payment.project;

  const handleDiscuss = () => {
    onClose();
    navigate(`/messages/${projectId}?paymentId=${payment._id || payment.id}`);
  };

  const handleRejectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionReason.trim()) {
      showToast('Rejection reason is required', 'error');
      return;
    }
    rejectMutation.mutate(rejectionReason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 bg-navy-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-navy-950">Payment Request Details</h3>
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-navy-100 text-navy-800">
                  {referenceNumber}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Created {formatDate(payment.createdAt, 'dd MMM yyyy, hh:mm a')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Top Status & Amount Banner */}
          <div className="p-5 rounded-2xl bg-navy-950 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md">
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold">
                Requested Payout Amount
              </span>
              <span className="text-3xl font-black text-amber-400">
                ₹{(amount / 100).toLocaleString('en-IN')}
              </span>
              <span className="text-xs text-slate-400 block mt-0.5">
                Method: <strong className="text-white">{preferredMethod}</strong>
              </span>
            </div>

            <div className="flex flex-col items-start sm:items-end gap-1.5">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Status</span>
              <span className="px-3 py-1 rounded-full text-xs font-extrabold tracking-wide uppercase bg-amber-500 text-navy-950">
                {payment.status.replace(/_/g, ' ')}
              </span>
              {isHighValue && (
                <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" />
                  High-Value Dual Auth Required
                </span>
              )}
            </div>
          </div>

          {/* Dual-Authorization Warning Banner */}
          {isDualAuthBlocked && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-xs text-rose-800">
                <ShieldAlert className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>Dual Authorization Policy Enforcement</span>
              </div>
              <p className="text-xs leading-relaxed text-rose-700">
                You created this payment request of ₹{(amount / 100).toLocaleString('en-IN')}.
                Under high-value financial compliance, <strong>the creator cannot approve their own high-value payout</strong>.
                Another Managing Director / Executive must independently authorize this transfer.
              </p>
            </div>
          )}

          {/* Beneficiary & Project Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Beneficiary Card */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Beneficiary Details
              </span>
              <div className="font-bold text-sm text-navy-950">
                {payeeName}
              </div>
              <div className="text-slate-600 font-mono text-[11px] space-y-0.5">
                {vpa ? (
                  <div>UPI VPA: {vpa}</div>
                ) : (
                  <>
                    <div>A/C: {accountNumberMasked}</div>
                    <div>IFSC: {ifsc}</div>
                    {bankName && (
                      <div>Bank: {bankName}</div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Requester & Project Card */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Project & Submitter
              </span>
              <div className="font-bold text-sm text-navy-950">
                [{projectCode}] {projectName}
              </div>
              <div className="text-slate-600 text-[11px] space-y-0.5">
                <div>Requested by: <strong>{payment.createdBy?.name || 'Site In-Charge'}</strong></div>
                <div>Role: {payment.createdBy?.role || 'IN_CHARGE'}</div>
                {requestedDate && (
                  <div>Requested Date: {formatDate(requestedDate, 'dd MMM yyyy')}</div>
                )}
              </div>
            </div>
          </div>

          {/* Purpose & Remarks */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
            <span className="text-[10px] text-slate-400 uppercase font-bold block">Purpose</span>
            <p className="font-semibold text-navy-950 text-sm leading-snug">{payment.purpose}</p>
            {remarks && (
              <p className="text-slate-600 pt-1 text-xs border-t border-slate-200 mt-2">
                <strong>Remarks:</strong> {remarks}
              </p>
            )}
          </div>

          {/* Invoice Document Preview */}
          {payment.invoiceUrl && (
            <div className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-700 font-semibold truncate">
                <FileText className="w-4 h-4 text-navy-800 flex-shrink-0" />
                <span className="truncate">Attached Supporting Invoice / Receipt</span>
              </div>
              <a
                href={payment.invoiceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-800 transition-colors flex-shrink-0"
              >
                <span>View Attachment</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Rejection notice if rejected */}
          {payment.status === 'REJECTED' && payment.rejectionReason && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
              <span className="font-bold block mb-0.5">Rejection Reason:</span>
              <p className="text-[11px]">{payment.rejectionReason}</p>
            </div>
          )}

          {/* RazorpayX Transaction Metadata */}
          {payment.razorpayxPayoutId && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                RazorpayX Payout Metadata
              </span>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px]">Payout ID</span>
                  <span className="font-bold text-navy-900">{payment.razorpayxPayoutId}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">UTR / Bank Ref</span>
                  <span className="font-bold text-navy-900">{utr || 'In-Flight'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Audit Trail Timeline */}
          {payment.auditTrail && payment.auditTrail.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <span className="text-xs font-bold text-navy-950 uppercase tracking-wider block">
                Authorization & Transaction Trail
              </span>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {payment.auditTrail.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 text-[11px] p-2 rounded-xl bg-slate-50 border border-slate-100"
                  >
                    <Clock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-navy-950">{entry.action}</span>
                        <span className="text-slate-400 text-[10px]">
                          {formatDate(entry.timestamp, 'dd MMM, hh:mm a')}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        By {typeof entry.performedBy === 'object' ? entry.performedBy.name : 'System'}
                        {entry.note ? ` — "${entry.note}"` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reject Reason Form Toggle */}
          {showRejectForm && (
            <form onSubmit={handleRejectSubmit} className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
              <span className="text-xs font-bold text-rose-950 block">Enter Reason for Rejection *</span>
              <textarea
                required
                rows={2}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this request is rejected so the site engineer can revise"
                className="w-full p-2.5 rounded-xl border border-rose-300 text-xs bg-white focus:ring-2 focus:ring-rose-500 outline-none"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowRejectForm(false)}
                  type="button"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  type="submit"
                  isLoading={rejectMutation.isPending}
                >
                  Confirm Rejection
                </Button>
              </div>
            </form>
          )}

          {/* Review Note for Authorizing */}
          {canAuthorize && !showRejectForm && (
            <div>
              <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                Executive Authorization Note (Optional)
              </label>
              <input
                type="text"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="e.g. Approved against Milestone 3 verification"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
          {/* Discuss in Chat Button */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDiscuss}
            leftIcon={<MessageSquare className="w-3.5 h-3.5 text-navy-800" />}
          >
            Discuss with Site Team
          </Button>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {canReconcile && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => reconcileMutation.mutate()}
                isLoading={reconcileMutation.isPending}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Reconcile Status
              </Button>
            )}

            {canReject && !showRejectForm && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setShowRejectForm(true)}
                leftIcon={<Ban className="w-3.5 h-3.5" />}
              >
                Reject Request
              </Button>
            )}

            {canAuthorize && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => authorizeMutation.mutate(reviewNote || undefined)}
                isLoading={authorizeMutation.isPending}
                leftIcon={<ShieldCheck className="w-4 h-4 text-navy-950" />}
              >
                Authorize Payment
              </Button>
            )}

            {canInitiate && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => initiatePayoutMutation.mutate()}
                isLoading={initiatePayoutMutation.isPending}
                leftIcon={<Send className="w-4 h-4 text-navy-950" />}
              >
                Initiate Transfer (RazorpayX)
              </Button>
            )}

            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
