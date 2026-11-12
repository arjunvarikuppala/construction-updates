import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { api } from '../../api/client.js';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Select } from '../common/Input.js';
import { LoadingSkeleton } from '../common/LoadingSkeleton.js';
import { PayFields, emptyPayDraft, payDraftProblems, payDraftToPayload, type PayDraft } from '../payments/PayFields.js';
import { useToast } from '../../context/ToastContext.js';
import { localMonthString } from '../../utils/dates.js';
import { inr, newSettlementKey } from '../../utils/payments.js';
import { SALARY_STATUS, monthLabel, payableMonths, type SalaryEmployee, type SalaryHistoryResponse } from '../../utils/salary.js';
import { SalaryHistoryList } from './SalaryHistoryList.js';

export const useSalaryHistory = (employeeId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['salary', 'history', employeeId],
    queryFn: () => api.get<SalaryHistoryResponse>(`/salaries/employees/${employeeId}`),
    enabled: Boolean(employeeId) && enabled,
  });

/** MD pays (part of) a month's salary: month, mode, UTR, date, proof. */
export const PaySalaryModal: React.FC<{ employee: SalaryEmployee | null; month?: string; onClose: () => void }> = ({ employee, month: initialMonth, onClose }) => {
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const current = localMonthString();
  const [month, setMonth] = useState(initialMonth || current);
  const { data, isLoading } = useSalaryHistory(employee?._id, Boolean(employee));
  const monthly = employee && (employee.salaryFrequency || 'MONTHLY') === 'MONTHLY' ? employee.salary || 0 : 0;

  const state = useMemo(() => {
    const h = data?.history.find((x) => x.month === month);
    const due = h ? h.duePaise || monthly : monthly;
    const paid = h?.paidPaise || 0;
    return { due, paid, balance: Math.max(0, due - paid), status: h?.status || 'UNPAID' };
  }, [data, month, monthly]);

  const [draft, setDraft] = useState<PayDraft>(() => emptyPayDraft(0, Boolean(employee?.vpa)));
  const [key, setKey] = useState(newSettlementKey());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!employee) return;
    setMonth(initialMonth || current);
    setKey(newSettlementKey());
  }, [employee?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill the amount with what is still due for the chosen month
  useEffect(() => {
    if (employee) setDraft(emptyPayDraft(state.balance, Boolean(employee.vpa)));
  }, [employee?._id, month, state.balance]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!employee) return null;
  const fullyPaid = state.due > 0 && state.balance === 0;
  const problems = fullyPaid ? ['this month is already fully paid'] : payDraftProblems(draft, state.due > 0 ? state.balance : 0);

  const save = async () => {
    if (problems.length) return;
    setSaving(true);
    try {
      const r: any = await api.post(`/salaries/employees/${employee._id}/payments`, { month, ...payDraftToPayload(draft, key) });
      success(r?.message || 'Salary recorded');
      await queryClient.invalidateQueries({ queryKey: ['salary'] });
      onClose();
    } catch (err: any) {
      toastError(err.message || 'Could not record the salary');
      setKey(newSettlementKey());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => !saving && onClose()}
      title={`Pay salary · ${employee.name}`}
      description={monthly ? `Monthly salary ${inr(monthly)}` : 'No monthly salary set — record what you paid.'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={saving} disabled={problems.length > 0 || isLoading} leftIcon={<Wallet className="w-4 h-4" />}>
            Record salary payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <Select
            label="Salary month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            options={payableMonths(current).map((m) => ({ value: m, label: `${monthLabel(m)}${m > current ? ' (advance)' : ''}` }))}
          />
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            {isLoading ? (
              <span className="text-slate-500">Loading…</span>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${SALARY_STATUS[state.status].tone}`}>{SALARY_STATUS[state.status].label}</span>
                <span>
                  Paid <strong className="text-emerald-700">{inr(state.paid)}</strong>
                </span>
                {state.due > 0 && (
                  <span>
                    Due <strong className={state.balance ? 'text-rose-700' : 'text-emerald-700'}>{inr(state.balance)}</strong>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {fullyPaid ? (
          <p className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
            {monthLabel(month)} salary is fully paid. Choose another month to pay.
          </p>
        ) : (
          <PayFields
            value={draft}
            onChange={setDraft}
            balancePaise={state.due > 0 ? state.balance : 0}
            payee={{ name: employee.name, vpa: employee.vpa }}
            note={`Salary ${monthLabel(month, true)}`}
            disabled={saving}
          />
        )}
        {!fullyPaid && problems.length > 0 && draft.amount && (
          <p className="text-[11px] text-rose-700">To save: {problems.join(', ')}.</p>
        )}
        <p className="text-[11px] text-slate-500">
          {employee.name} gets a notification with a salary receipt as proof. Salaries are kept separate from site expenses.
        </p>
      </div>
    </Modal>
  );
};

/** MD: an in-charge's month-by-month salary history. */
export const SalaryHistoryModal: React.FC<{ employee: SalaryEmployee | null; onClose: () => void; onPay: (e: SalaryEmployee) => void }> = ({ employee, onClose, onPay }) => {
  const { data, isLoading } = useSalaryHistory(employee?._id, Boolean(employee));
  if (!employee) return null;
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Salary history · ${employee.name}`}
      description={data ? `Paid ${inr(data.totals.paidPaise)} in total${data.totals.pendingPaise ? ` · ${inr(data.totals.pendingPaise)} still due` : ''}` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onPay(employee)} leftIcon={<Wallet className="w-4 h-4" />}>
            Pay salary
          </Button>
        </>
      }
    >
      {isLoading || !data ? <LoadingSkeleton rows={3} height="h-24" /> : <SalaryHistoryList data={data} asMD />}
    </Modal>
  );
};
