import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import { api } from '../../api/client.js';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { LoadingSkeleton } from '../common/LoadingSkeleton.js';
import { useToast } from '../../context/ToastContext.js';
import { formatDate } from '../../utils/dates.js';
import { inr } from '../../utils/payments.js';
import { downloadFromApi } from '../../utils/download.js';

interface Row {
  date: string;
  type: 'Salary' | 'Payment request';
  project: string;
  details: string;
  amountPaise: number;
  mode: string;
  utr: string;
  paidBy: string;
  received: string;
}
interface Ledger {
  rows: Row[];
  totals: { salaryPaise: number; requestsPaise: number; totalPaise: number; unpaidRequestsPaise: number };
}

/** MD: every payment made to one in-charge (salary + payment requests), by date, with Excel download. */
export const InChargePaymentsModal: React.FC<{ employee: { _id: string; name: string } | null; onClose: () => void }> = ({ employee, onClose }) => {
  const { error: toastError } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [filter, setFilter] = useState<'ALL' | Row['type']>('ALL');
  const { data, isLoading } = useQuery({
    queryKey: ['salary', 'payments-ledger', employee?._id],
    queryFn: () => api.get<Ledger>(`/export/in-charges/${employee!._id}/payments`),
    enabled: Boolean(employee),
  });
  if (!employee) return null;

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFromApi(`/export/in-charges/${employee._id}/payments.xlsx`, `${employee.name.replace(/[^A-Za-z0-9]+/g, '-')}-payment-history.xlsx`);
    } catch (err: any) {
      toastError(err.message || 'Could not download the Excel file');
    } finally {
      setDownloading(false);
    }
  };

  const rows = (data?.rows || []).filter((r) => filter === 'ALL' || r.type === filter).slice().reverse();

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Payment history · ${employee.name}`}
      description="Every payment made to them — salary and payment requests — by date."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={download} isLoading={downloading} leftIcon={<FileSpreadsheet className="w-4 h-4" />}>
            Download Excel
          </Button>
        </>
      }
    >
      {isLoading || !data ? (
        <LoadingSkeleton rows={3} height="h-20" />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              { k: 'Total paid', v: data.totals.totalPaise, c: 'text-navy-950' },
              { k: 'Salary', v: data.totals.salaryPaise, c: 'text-emerald-700' },
              { k: 'Payment requests', v: data.totals.requestsPaise, c: 'text-emerald-700' },
              { k: 'Requests still due', v: data.totals.unpaidRequestsPaise, c: data.totals.unpaidRequestsPaise ? 'text-rose-700' : 'text-navy-950' },
            ].map((t) => (
              <div key={t.k} className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t.k}</div>
                <div className={`text-sm font-black ${t.c}`}>{inr(t.v)}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            {(['ALL', 'Salary', 'Payment request'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold ${filter === f ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {f === 'ALL' ? 'All' : f === 'Salary' ? 'Salary' : 'Payment requests'}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 rounded-xl border border-dashed border-slate-300">No payments yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[760px] text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    {['Date', 'Type', 'Details', 'Amount', 'Mode', 'UTR / cheque', 'Received'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.date, 'dd MMM yyyy')}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${r.type === 'Salary' ? 'bg-emerald-100 text-emerald-800' : 'bg-navy-100 text-navy-900'}`}>
                          {r.type}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-navy-950 font-semibold">{r.details}</div>
                        {r.project && <div className="text-[11px] text-slate-500">{r.project}</div>}
                      </td>
                      <td className="px-3 py-2 font-bold whitespace-nowrap">{inr(r.amountPaise)}</td>
                      <td className="px-3 py-2">{r.mode}</td>
                      <td className="px-3 py-2 font-mono">{r.utr || '—'}</td>
                      <td className="px-3 py-2">{r.received}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
