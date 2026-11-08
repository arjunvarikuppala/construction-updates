import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Wallet,
  Ban,
  MessageSquare,
  FileText,
  CheckCircle2,
  Clock,
  Undo2,
  Download,
  Send,
  ShieldAlert,
  HandCoins,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Textarea } from '../common/Input.js';
import { SecureLink } from '../common/SecureMedia.js';
import { useToast } from '../../context/ToastContext.js';
import { useAuth } from '../../context/AuthContext.js';
import type { PaymentRequest, PaymentSettlement } from '../../types/index.js';
import { formatDate } from '../../utils/dates.js';
import {
  MODE_LABEL,
  STATUS_META,
  balancePaiseOf,
  idOf,
  inr,
  isPayable,
  nameOf,
  paidPaiseOf,
  payeeKindOf,
} from '../../utils/payments.js';
import { exportPaymentVoucherPdf } from '../../utils/paymentVoucherPdf.js';
import { useCompanySettings } from '../../utils/gst.js';
import { PayModal } from './PayModal.js';

interface PaymentReviewModalProps {
  payment: PaymentRequest | null;
  isOpen: boolean;
  onClose: () => void;
  /** RazorpayX bank payouts are offered only when they are really switched on */
  payoutsEnabled?: boolean;
}

export const PaymentReviewModal: React.FC<PaymentReviewModalProps> = ({ payment: listPayment, isOpen, onClose, payoutsEnabled }) => {
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const { data: company } = useCompanySettings();
  const id = listPayment?._id || listPayment?.id || '';

  const { data: detail } = useQuery({
    queryKey: ['payment-request', id],
    queryFn: () => api.get<{ payment: PaymentRequest }>(`/payments/requests/${id}`).then((r) => r.payment),
    enabled: isOpen && Boolean(id),
  });
  const payment = detail || listPayment;

  const [payOpen, setPayOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [undoing, setUndoing] = useState<PaymentSettlement | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const [busy, setBusy] = useState('');

  if (!isOpen || !payment) return null;

  const me = user?.id || (user as any)?._id;
  const isInCharge = payeeKindOf(payment) === 'INCHARGE';
  const isPayee = Boolean(me && isInCharge && idOf(payment.payeeUser) === String(me));
  const isCreator = Boolean(me && idOf(payment.createdBy) === String(me));
  const paid = paidPaiseOf(payment);
  const balance = balancePaiseOf(payment);
  const pct = payment.amount ? Math.min(100, Math.round((paid / payment.amount) * 100)) : 0;
  const meta = STATUS_META[payment.status] || { label: payment.status, tone: 'bg-slate-100 text-slate-700' };
  const entries = payment.settlements || [];
  const projectId = idOf(payment.project);
  const project = payment.project as any;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['payment-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['payment-request', id] }),
    ]);
  };

  const run = async (label: string, fn: () => Promise<any>, done?: () => void) => {
    setBusy(label);
    try {
      const res = await fn();
      success(res?.message || 'Done');
      await refresh();
      done?.();
    } catch (err: any) {
      toastError(err.message || 'Something went wrong');
    } finally {
      setBusy('');
    }
  };

  const canPay = isOwner && isPayable(payment);
  const canReject = isOwner && paid === 0 && ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_AUTHORIZATION', 'AUTHORIZED'].includes(payment.status);
  const canCancel = !isOwner && isCreator && paid === 0 && ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_AUTHORIZATION', 'AUTHORIZED'].includes(payment.status);
  const pendingPayout = payment.pendingPayout;
  const canCheckPayout = isOwner && (Boolean(pendingPayout) || (payoutsEnabled && entries.some((s) => s.mode === 'RAZORPAYX' && !s.voided)));

  return (
    <>
      <Modal
        isOpen={isOpen && !payOpen}
        onClose={onClose}
        title={`${inr(payment.amount)} to ${payment.payeeNameSnapshot}`}
        description={`${payment.paymentReference} · raised ${formatDate(payment.createdAt, 'dd MMM yyyy, hh:mm a')} by ${nameOf(payment.createdBy, 'Site In-Charge')}`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                onClose();
                navigate(`/messages/${projectId}?paymentId=${id}`);
              }}
              leftIcon={<MessageSquare className="w-4 h-4" />}
            >
              Discuss
            </Button>
            {paid > 0 && (
              <Button
                variant="outline"
                onClick={() => exportPaymentVoucherPdf(payment).catch(() => toastError('Could not create the voucher PDF'))}
                leftIcon={<Download className="w-4 h-4" />}
              >
                Voucher PDF
              </Button>
            )}
            {canCancel && (
              <Button
                variant="danger"
                isLoading={busy === 'cancel'}
                onClick={() => run('cancel', () => api.post(`/payments/requests/${id}/cancel`, { reason: 'Withdrawn by requester' }), onClose)}
                leftIcon={<Ban className="w-4 h-4" />}
              >
                Withdraw request
              </Button>
            )}
            {canReject && !rejecting && (
              <Button variant="danger" onClick={() => setRejecting(true)} leftIcon={<Ban className="w-4 h-4" />}>
                Reject
              </Button>
            )}
            {canCheckPayout && (
              <Button
                variant="outline"
                isLoading={busy === 'check'}
                onClick={() => run('check', () => api.post(`/payments/requests/${id}/reconcile`, {}))}
                leftIcon={<RefreshCw className="w-4 h-4" />}
              >
                Check RazorpayX status
              </Button>
            )}
            {canPay && (
              <Button onClick={() => setPayOpen(true)} leftIcon={<Wallet className="w-4 h-4" />}>
                {paid > 0 ? `Pay balance ${inr(balance)}` : 'Approve & pay'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {/* Status + progress */}
          <div className="p-4 rounded-2xl bg-navy-950 text-white space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${meta.tone}`}>{meta.label}</span>
              <span className="text-xs text-slate-300">
                {isInCharge ? 'To Site In-Charge' : `To ${(payment.payeeType || 'vendor').toLowerCase()}`}
                {project?.code ? ` · ${project.code}` : ''}
              </span>
            </div>
            <div>
              <div className="h-2.5 rounded-full bg-white/15 overflow-hidden" aria-label={`${pct}% paid`}>
                <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-xs mt-1.5">
                <span>
                  Paid <strong className="text-amber-300">{inr(paid)}</strong>
                </span>
                <span>
                  Balance <strong className={balance ? 'text-white' : 'text-emerald-300'}>{inr(balance)}</strong>
                </span>
              </div>
            </div>
            {payment.requiresHighValueAuth && paid === 0 && isOwner && !payment.pendingPayout && (
              <p className="text-[11px] text-amber-300 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" /> Above ₹1,00,000 — check the bill before paying.
              </p>
            )}
          </div>

          {pendingPayout && (
            <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50 text-xs text-indigo-950 flex items-start gap-2">
              <Zap className="w-4 h-4 shrink-0 text-indigo-600 mt-0.5" />
              <div>
                <strong>{inr(pendingPayout.amountPaise)}</strong> by {pendingPayout.mode} is with RazorpayX
                {pendingPayout.providerStatus ? ` (${pendingPayout.providerStatus})` : ''}, sent {formatDate(pendingPayout.initiatedAt, 'dd MMM, hh:mm a')}.
                <div className="text-indigo-800 mt-0.5">
                  {pendingPayout.providerStatus === 'queued'
                    ? 'Queued: your RazorpayX balance is low — add funds and it goes out automatically.'
                    : pendingPayout.providerStatus === 'pending'
                    ? 'Waiting for approval in your RazorpayX dashboard.'
                    : 'It updates here automatically when the bank confirms. Do not pay this again meanwhile.'}
                </div>
              </div>
            </div>
          )}

          {payment.failureReason && isPayable(payment) && (
            <p className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
              <strong>Last payout attempt:</strong> {payment.failureReason}
            </p>
          )}

          {/* Details */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div className="sm:col-span-2">
              <dt className="text-slate-500">For</dt>
              <dd className="font-semibold text-navy-950 text-sm">{payment.purpose}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Site</dt>
              <dd className="font-semibold text-navy-950">{project ? `${project.code} – ${project.name}` : '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Pay to</dt>
              <dd className="font-semibold text-navy-950 break-all">
                {[payment.vpaSnapshot && `UPI ${payment.vpaSnapshot}`, payment.accountNumberMaskedSnapshot && `A/C ${payment.accountNumberMaskedSnapshot} · ${payment.ifscSnapshot}`]
                  .filter(Boolean)
                  .join(' · ') || 'No UPI / bank saved'}
              </dd>
            </div>
            {payment.requestedPaymentDate && (
              <div>
                <dt className="text-slate-500">Needed by</dt>
                <dd className="font-semibold text-navy-950">{formatDate(payment.requestedPaymentDate, 'dd MMM yyyy')}</dd>
              </div>
            )}
            {payment.expense && typeof payment.expense === 'object' && (
              <div>
                <dt className="text-slate-500">Linked expense</dt>
                <dd className="font-semibold text-navy-950">
                  {inr(payment.expense.amount)} · {payment.expense.vendor || payment.expense.category}
                </dd>
              </div>
            )}
            {payment.inchargeRemarks && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Note</dt>
                <dd className="text-slate-700">{payment.inchargeRemarks}</dd>
              </div>
            )}
          </dl>

          {payment.invoiceUrl && (
            <SecureLink
              href={payment.invoiceUrl}
              className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 text-xs font-semibold text-navy-900 hover:bg-slate-50"
            >
              <FileText className="w-4 h-4 text-navy-800" /> View bill / invoice
            </SecureLink>
          )}

          {payment.status === 'REJECTED' && payment.rejectionReason && (
            <p className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900">
              <strong>Rejected:</strong> {payment.rejectionReason}
            </p>
          )}

          {rejecting && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 space-y-2">
              <Textarea
                label="Why is it rejected?"
                rows={2}
                maxLength={500}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!rejectReason.trim()}
                  isLoading={busy === 'reject'}
                  onClick={() => run('reject', () => api.post(`/payments/requests/${id}/reject`, { reason: rejectReason.trim() }), onClose)}
                >
                  Confirm reject
                </Button>
              </div>
            </div>
          )}

          {/* Payment entries */}
          <section className="space-y-2">
            <h4 className="text-xs font-bold text-navy-950 uppercase tracking-wider">Payments made</h4>
            {entries.length === 0 ? (
              <p className="text-xs text-slate-500 p-3 rounded-xl border border-dashed border-slate-300">
                {payment.pendingPayout
                  ? 'The RazorpayX payout above will appear here once the bank confirms it.'
                  : isOwner
                  ? 'Nothing paid yet. Use "Approve & pay" to send it with RazorpayX or record a payment you made.'
                  : 'Not paid yet. You will be notified when the MD pays.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {entries.map((s) => (
                  <li
                    key={s._id}
                    className={`p-3 rounded-xl border text-xs ${s.voided ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-emerald-200 bg-emerald-50/50'}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className={`text-sm font-black ${s.voided ? 'line-through text-slate-500' : 'text-navy-950'}`}>{inr(s.amountPaise)}</span>
                        <span className="ml-2 font-semibold text-slate-700">{MODE_LABEL[s.mode]}</span>
                        {s.reference && <span className="ml-1.5 font-mono text-slate-600 break-all">· {s.reference}</span>}
                        <div className="text-slate-500 mt-0.5">
                          {formatDate(s.paidOn, 'dd MMM yyyy')} · recorded by {nameOf(s.recordedBy, 'MD')}
                        </div>
                        {s.note && <div className="text-slate-600 mt-0.5">“{s.note}”</div>}
                        {s.voided && (
                          <div className="text-rose-700 mt-0.5">
                            Undone{s.voidReason ? `: ${s.voidReason}` : ''}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {s.proofUrl && (
                          <SecureLink href={s.proofUrl} className="inline-flex items-center gap-1 min-h-[32px] px-2 rounded-lg border border-slate-300 bg-white font-semibold text-navy-900">
                            <FileText className="w-3.5 h-3.5" /> Proof
                          </SecureLink>
                        )}
                        {!s.voided && isInCharge && (
                          s.receivedConfirmedAt ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Received {formatDate(s.receivedConfirmedAt, 'dd MMM')}
                            </span>
                          ) : isPayee ? (
                            <Button
                              size="sm"
                              isLoading={busy === `confirm-${s._id}`}
                              onClick={() => run(`confirm-${s._id}`, () => api.post(`/payments/requests/${id}/settlements/${s._id}/confirm`, {}))}
                              leftIcon={<HandCoins className="w-3.5 h-3.5" />}
                            >
                              I received it
                            </Button>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 text-amber-800 font-semibold">
                              <Clock className="w-3.5 h-3.5" /> Not confirmed yet
                            </span>
                          )
                        )}
                        {isOwner && !s.voided && s.mode !== 'RAZORPAYX' && (
                          <button
                            type="button"
                            onClick={() => {
                              setUndoing(s);
                              setUndoReason('');
                            }}
                            className="inline-flex items-center gap-1 min-h-[32px] px-2 rounded-lg text-slate-500 hover:bg-white hover:text-rose-700"
                          >
                            <Undo2 className="w-3.5 h-3.5" /> Undo
                          </button>
                        )}
                      </div>
                    </div>
                    {undoing?._id === s._id && (
                      <div className="mt-2 pt-2 border-t border-slate-200 space-y-2">
                        <Textarea
                          label="Why undo this entry? (it stays in the history)"
                          rows={2}
                          maxLength={300}
                          value={undoReason}
                          onChange={(e) => setUndoReason(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setUndoing(null)}>
                            Keep it
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={!undoReason.trim()}
                            isLoading={busy === `undo-${s._id}`}
                            onClick={() =>
                              run(
                                `undo-${s._id}`,
                                () => api.post(`/payments/requests/${id}/settlements/${s._id}/void`, { reason: undoReason.trim() }),
                                () => setUndoing(null)
                              )
                            }
                          >
                            Undo entry
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {payment.auditTrail?.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-bold text-navy-950 uppercase tracking-wider">History</summary>
              <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {[...payment.auditTrail].reverse().map((entry, i) => (
                  <li key={i} className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold text-navy-950">{entry.action.replace(/^PAYMENT_/, '').replace(/_/g, ' ').toLowerCase()}</span>
                      <span className="text-slate-400 shrink-0">{formatDate(entry.timestamp, 'dd MMM, hh:mm a')}</span>
                    </div>
                    <div className="text-slate-600">
                      {nameOf(entry.performedBy, 'System')}
                      {entry.note ? ` — ${entry.note}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Modal>

      <PayModal payment={payment} isOpen={payOpen} onClose={() => setPayOpen(false)} />
    </>
  );
};
