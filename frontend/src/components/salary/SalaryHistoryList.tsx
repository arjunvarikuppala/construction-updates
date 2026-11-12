import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, FileText, HandCoins, ReceiptText, Undo2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../common/Button.js';
import { Textarea } from '../common/Input.js';
import { SecureLink } from '../common/SecureMedia.js';
import { useToast } from '../../context/ToastContext.js';
import { formatDate } from '../../utils/dates.js';
import { MODE_LABEL, inr, nameOf } from '../../utils/payments.js';
import { SALARY_STATUS, type SalaryHistoryResponse, type SalaryPaymentEntry } from '../../utils/salary.js';
import { exportSalaryReceiptPdf } from '../../utils/salaryReceiptPdf.js';

interface Props {
  data: SalaryHistoryResponse;
  /** MD view: can undo entries. Employee view: can confirm receipt. */
  asMD: boolean;
  /** Entry to scroll to and highlight (from a notification link) */
  highlightId?: string | null;
}

/** Month-by-month salary history with every payment, receipts and proof. */
export const SalaryHistoryList: React.FC<Props> = ({ data, asMD, highlightId }) => {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState('');
  const [undoing, setUndoing] = useState<SalaryPaymentEntry | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const highlightRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (highlightId && highlightRef.current) highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightId, data]);

  const run = async (key: string, fn: () => Promise<any>, done?: () => void) => {
    setBusy(key);
    try {
      const r = await fn();
      success(r?.message || 'Done');
      await queryClient.invalidateQueries({ queryKey: ['salary'] });
      done?.();
    } catch (err: any) {
      toastError(err.message || 'Something went wrong');
    } finally {
      setBusy('');
    }
  };

  const months = data.history.filter((m) => m.entries.length > 0 || m.duePaise > 0);
  if (!months.length) {
    return <p className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300">No salary months yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {months.map((m) => {
        const meta = SALARY_STATUS[m.status];
        return (
          <li key={m.month} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="font-bold text-navy-950 text-sm">{m.label}</span>
                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${meta.tone}`}>{meta.label}</span>
              </div>
              <div className="text-xs text-slate-600 flex flex-wrap gap-x-3">
                {m.duePaise > 0 && (
                  <span>
                    Salary <strong className="text-navy-950">{inr(m.duePaise)}</strong>
                  </span>
                )}
                <span>
                  Paid <strong className="text-emerald-700">{inr(m.paidPaise)}</strong>
                </span>
                {m.balancePaise > 0 && (
                  <span>
                    Due <strong className="text-rose-700">{inr(m.balancePaise)}</strong>
                  </span>
                )}
              </div>
            </div>
            {m.entries.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-500">Nothing paid for this month yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {m.entries.map((e) => {
                  const hl = highlightId === e._id;
                  return (
                    <li
                      key={e._id}
                      ref={hl ? highlightRef : undefined}
                      className={`px-4 py-3 text-xs ${e.voided ? 'opacity-60' : ''} ${hl ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : ''}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className={`text-sm font-black ${e.voided ? 'line-through text-slate-500' : 'text-navy-950'}`}>{inr(e.amountPaise)}</span>
                          <span className="ml-2 font-semibold text-slate-700">{MODE_LABEL[e.mode]}</span>
                          {e.reference && <span className="ml-1.5 font-mono text-slate-600 break-all">· {e.reference}</span>}
                          <div className="text-slate-500 mt-0.5">
                            {formatDate(e.paidOn, 'dd MMM yyyy')} · paid by {nameOf(e.recordedBy, 'MD')}
                          </div>
                          {e.note && <div className="text-slate-600 mt-0.5">“{e.note}”</div>}
                          {e.voided && <div className="text-rose-700 mt-0.5">Undone{e.voidReason ? `: ${e.voidReason}` : ''}</div>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {!e.voided && (
                            <button
                              type="button"
                              onClick={() => exportSalaryReceiptPdf(data.employee, m, e).catch(() => toastError('Could not create the receipt PDF'))}
                              className="inline-flex items-center gap-1 min-h-[32px] px-2 rounded-lg border border-emerald-300 bg-white font-semibold text-emerald-800 hover:bg-emerald-50"
                            >
                              <ReceiptText className="w-3.5 h-3.5" /> Receipt
                            </button>
                          )}
                          {e.proofUrl && (
                            <SecureLink href={e.proofUrl} className="inline-flex items-center gap-1 min-h-[32px] px-2 rounded-lg border border-slate-300 bg-white font-semibold text-navy-900">
                              <FileText className="w-3.5 h-3.5" /> Proof
                            </SecureLink>
                          )}
                          {!e.voided &&
                            (e.receivedConfirmedAt ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Received {formatDate(e.receivedConfirmedAt, 'dd MMM')}
                              </span>
                            ) : asMD ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 text-amber-800 font-semibold">
                                <Clock className="w-3.5 h-3.5" /> Not confirmed yet
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                isLoading={busy === `confirm-${e._id}`}
                                onClick={() => run(`confirm-${e._id}`, () => api.post(`/salaries/payments/${e._id}/confirm`, {}))}
                                leftIcon={<HandCoins className="w-3.5 h-3.5" />}
                              >
                                I received it
                              </Button>
                            ))}
                          {asMD && !e.voided && (
                            <button
                              type="button"
                              onClick={() => {
                                setUndoing(e);
                                setUndoReason('');
                              }}
                              className="inline-flex items-center gap-1 min-h-[32px] px-2 rounded-lg text-slate-500 hover:bg-slate-50 hover:text-rose-700"
                            >
                              <Undo2 className="w-3.5 h-3.5" /> Undo
                            </button>
                          )}
                        </div>
                      </div>
                      {undoing?._id === e._id && (
                        <div className="mt-2 pt-2 border-t border-slate-200 space-y-2">
                          <Textarea
                            label="Why undo this entry? (it stays in the history)"
                            rows={2}
                            maxLength={300}
                            value={undoReason}
                            onChange={(ev) => setUndoReason(ev.target.value)}
                          />
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setUndoing(null)}>
                              Keep it
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={!undoReason.trim()}
                              isLoading={busy === `undo-${e._id}`}
                              onClick={() =>
                                run(`undo-${e._id}`, () => api.post(`/salaries/payments/${e._id}/void`, { reason: undoReason.trim() }), () => setUndoing(null))
                              }
                            >
                              Undo entry
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
};
