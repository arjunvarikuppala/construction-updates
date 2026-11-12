import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Wallet, ClipboardList, Receipt } from 'lucide-react';
import { api } from '../../api/client.js';
import { Card } from '../common/Card.js';
import { Button } from '../common/Button.js';
import { LoadingSkeleton } from '../common/LoadingSkeleton.js';
import { useToast } from '../../context/ToastContext.js';
import { formatDate } from '../../utils/dates.js';
import { inr } from '../../utils/payments.js';
import { downloadFromApi } from '../../utils/download.js';

interface Register {
  payments: Array<{
    date: string;
    reference: string;
    raisedBy: string;
    purpose: string;
    payee: string;
    payeeType: string;
    requestAmountPaise: number;
    paidPaise: number;
    mode: string;
    utr: string;
    paidBy: string;
    received: string;
    status: string;
  }>;
  work: Array<{
    date: string;
    title: string;
    summary: string;
    workItems: string;
    labour: number;
    labourBreakdown: string;
    materials: string;
    machinery: string;
    photos: number;
    submittedBy: string;
  }>;
  expenses: Array<{ date: string; category: string; vendor: string; description: string; amountPaise: number; status: string }>;
  totals: {
    requestedPaise: number;
    paidPaise: number;
    duePaise: number;
    requests: number;
    reports: number;
    labourDays: number;
    expensesApprovedPaise: number;
    expensesPendingPaise: number;
  };
}

type Sheet = 'payments' | 'work' | 'expenses';

const th = 'px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap';
const td = 'px-3 py-2 text-xs text-slate-700 align-top';
const d = (s: string) => (s ? formatDate(s, 'dd MMM yyyy') : '—');

/** Project payments + daily work + expenses, as on screen and as one Excel workbook (MD). */
export const ProjectRegister: React.FC<{ projectId: string; projectCode: string }> = ({ projectId, projectCode }) => {
  const { error: toastError } = useToast();
  const [sheet, setSheet] = useState<Sheet>('payments');
  const [downloading, setDownloading] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['project-register', projectId],
    queryFn: () => api.get<Register>(`/export/projects/${projectId}/register`),
  });

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const download = async (kind: 'payments' | 'work' | 'expenses') => {
    setDownloading(kind);
    try {
      const q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
      const label = { payments: 'Payments', work: 'Work', expenses: 'Expenses' }[kind];
      await downloadFromApi(`/export/projects/${projectId}/${kind}.xlsx${q ? `?${q}` : ''}`, `${projectCode}-${label}.xlsx`);
    } catch (err: any) {
      toastError(err.message || 'Could not download the Excel file');
    } finally {
      setDownloading('');
    }
  };

  if (isLoading || !data) return <LoadingSkeleton rows={3} height="h-24" />;
  const t = data.totals;
  const tabs: Array<{ key: Sheet; label: string; icon: React.ElementType; count: number }> = [
    { key: 'payments', label: 'Payments', icon: Wallet, count: data.payments.length },
    { key: 'work', label: 'Work', icon: ClipboardList, count: data.work.length },
    { key: 'expenses', label: 'Expenses', icon: Receipt, count: data.expenses.length },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-bold text-navy-950">Download Excel (day by day)</h3>
          <p className="text-xs text-slate-500">
            Each file is in strict date order with a total after every day. Leave the dates empty for the whole project.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-600">
            From
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="block mt-0.5 h-10 rounded-lg border border-slate-300 px-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="block mt-0.5 h-10 rounded-lg border border-slate-300 px-2 text-sm" />
          </label>
          {(from || to) && (
            <Button size="sm" variant="ghost" onClick={() => (setFrom(''), setTo(''))}>
              Whole project
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { kind: 'payments' as const, label: 'Payments', note: 'Payments + payment timeline', icon: Wallet },
            { kind: 'work' as const, label: 'Work', note: 'Daily work, work items, labour, materials, machinery', icon: ClipboardList },
            { kind: 'expenses' as const, label: 'Expenses', note: 'Expenses with GST and approval', icon: Receipt },
          ].map((b) => {
            const Icon = b.icon;
            return (
              <button
                key={b.kind}
                type="button"
                onClick={() => download(b.kind)}
                disabled={Boolean(downloading)}
                className="flex items-start gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-left disabled:opacity-60"
              >
                <span className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  {downloading === b.kind ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Icon className="w-5 h-5" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-navy-950">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> {b.label}.xlsx
                  </span>
                  <span className="block text-[11px] text-slate-500">{b.note}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { k: 'Paid', v: inr(t.paidPaise), c: 'text-emerald-700' },
          { k: 'Still due', v: inr(t.duePaise), c: t.duePaise ? 'text-rose-700' : 'text-navy-950' },
          { k: 'Daily reports', v: String(t.reports), c: 'text-navy-950' },
          { k: 'Labour (worker-days)', v: String(t.labourDays), c: 'text-navy-950' },
        ].map((x) => (
          <Card key={x.k} className="p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{x.k}</div>
            <div className={`text-lg font-black ${x.c}`}>{x.v}</div>
          </Card>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {tabs.map((x) => {
          const Icon = x.icon;
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => setSheet(x.key)}
              className={`inline-flex items-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold whitespace-nowrap ${
                sheet === x.key ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {x.label}
              <span className={`px-1.5 rounded-full text-[10px] ${sheet === x.key ? 'bg-white/20' : 'bg-white'}`}>{x.count}</span>
            </button>
          );
        })}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto max-h-[560px]">
          {sheet === 'payments' && (
            <table className="w-full min-w-[980px]">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  {['Date', 'Request', 'Purpose', 'Paid to', 'Request amount', 'Paid', 'Mode', 'UTR / cheque', 'Received', 'Status'].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.payments.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className={`${td} whitespace-nowrap`}>{d(r.date)}</td>
                    <td className={`${td} font-mono whitespace-nowrap`}>{r.reference}</td>
                    <td className={td}>
                      <div className="font-semibold text-navy-950">{r.purpose}</div>
                      <div className="text-[11px] text-slate-500">by {r.raisedBy}</div>
                    </td>
                    <td className={td}>
                      {r.payee}
                      <div className="text-[11px] text-slate-500 capitalize">{r.payeeType}</div>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{inr(r.requestAmountPaise)}</td>
                    <td className={`${td} whitespace-nowrap font-bold ${r.paidPaise ? 'text-emerald-700' : 'text-slate-400'}`}>{inr(r.paidPaise)}</td>
                    <td className={td}>{r.mode || '—'}</td>
                    <td className={`${td} font-mono`}>{r.utr || '—'}</td>
                    <td className={td}>{r.received || '—'}</td>
                    <td className={td}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sheet === 'work' && (
            <table className="w-full min-w-[980px]">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  {['Date', 'Work', 'Items & quantities', 'Labour', 'Materials', 'Machinery', 'Photos', 'By'].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.work.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className={`${td} whitespace-nowrap`}>{d(r.date)}</td>
                    <td className={td}>
                      <div className="font-semibold text-navy-950">{r.title}</div>
                      {r.summary && <div className="text-[11px] text-slate-500 line-clamp-2">{r.summary}</div>}
                    </td>
                    <td className={td}>{r.workItems || '—'}</td>
                    <td className={td}>
                      <strong>{r.labour}</strong>
                      {r.labourBreakdown && <div className="text-[11px] text-slate-500">{r.labourBreakdown}</div>}
                    </td>
                    <td className={td}>{r.materials || '—'}</td>
                    <td className={td}>{r.machinery || '—'}</td>
                    <td className={td}>{r.photos}</td>
                    <td className={td}>{r.submittedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sheet === 'expenses' && (
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  {['Date', 'Category', 'Vendor', 'Description', 'Amount', 'Status'].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.expenses.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className={`${td} whitespace-nowrap`}>{d(r.date)}</td>
                    <td className={`${td} capitalize`}>{r.category}</td>
                    <td className={td}>{r.vendor || '—'}</td>
                    <td className={td}>{r.description}</td>
                    <td className={`${td} whitespace-nowrap font-bold`}>{inr(r.amountPaise)}</td>
                    <td className={`${td} capitalize`}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {((sheet === 'payments' && !data.payments.length) || (sheet === 'work' && !data.work.length) || (sheet === 'expenses' && !data.expenses.length)) && (
            <p className="p-6 text-center text-sm text-slate-500">Nothing here yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
};
