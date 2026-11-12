import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { api } from '../api/client.js';
import { Card } from '../components/common/Card.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { SalaryHistoryList } from '../components/salary/SalaryHistoryList.js';
import { inr } from '../utils/payments.js';
import { SALARY_STATUS, type SalaryHistoryResponse } from '../utils/salary.js';

/** Site In-Charge: their own monthly salary, payments received and receipts. */
export const MySalaryPage: React.FC = () => {
  const [params] = useSearchParams();
  const highlightId = params.get('id');
  const { data, isLoading } = useQuery({
    queryKey: ['salary', 'me'],
    queryFn: () => api.get<SalaryHistoryResponse>('/salaries/me'),
  });

  const latest = data?.history[0];
  const monthly = data && (data.employee.salaryFrequency || 'MONTHLY') === 'MONTHLY' ? data.employee.salary || 0 : 0;

  return (
    <div className="space-y-5">
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">My Salary</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Salary paid to you by the MD, month by month, with a receipt for every payment.</p>
      </div>

      {isLoading || !data ? (
        <LoadingSkeleton rows={3} height="h-24" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Monthly salary</div>
              <div className="text-xl font-black text-navy-950 mt-1">{monthly ? inr(monthly) : '—'}</div>
            </Card>
            <Card className="p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{latest ? latest.label : 'This month'}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xl font-black text-emerald-700">{inr(latest?.paidPaise || 0)}</span>
                {latest && <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${SALARY_STATUS[latest.status].tone}`}>{SALARY_STATUS[latest.status].label}</span>}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total received</div>
              <div className="text-xl font-black text-navy-950 mt-1 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-amber-600" /> {inr(data.totals.paidPaise)}
              </div>
            </Card>
          </div>
          <SalaryHistoryList data={data} asMD={false} highlightId={highlightId} />
        </>
      )}
    </div>
  );
};
