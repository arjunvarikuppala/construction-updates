import React from 'react';
import { ExternalLink, CheckCircle2, XCircle, RefreshCw, Eye } from 'lucide-react';
import { Expense } from '../../types/index.js';
import { Badge } from '../common/Badge.js';
import { Button } from '../common/Button.js';
import { formatINR } from '../../utils/currency.js';
import { formatDate } from '../../utils/dates.js';

interface ExpenseTableProps {
  expenses: Expense[];
  isOwner: boolean;
  onApprove?: (expense: Expense) => void;
  onReject?: (expense: Expense) => void;
  onResubmit?: (expense: Expense) => void;
  onView?: (expense: Expense) => void;
}

export const ExpenseTable: React.FC<ExpenseTableProps> = ({
  expenses,
  isOwner,
  onApprove,
  onReject,
  onResubmit,
  onView,
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 font-bold uppercase tracking-wider">
            <th className="py-3 px-4">Date</th>
            <th className="py-3 px-4">Project</th>
            <th className="py-3 px-4">Category</th>
            <th className="py-3 px-4">Vendor & Description</th>
            <th className="py-3 px-4 text-right">Amount</th>
            <th className="py-3 px-4 text-center">Status</th>
            <th className="py-3 px-4 text-center">Receipt</th>
            <th className="py-3 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {expenses.map((expense) => {
            const id = expense._id || expense.id;
            return (
              <tr key={id} className="hover:bg-slate-50/60 transition-colors">
                <td className="py-3.5 px-4 font-medium text-slate-700 whitespace-nowrap">
                  {formatDate(expense.date, 'dd MMM yyyy')}
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap">
                  <span className="font-semibold text-navy-950 block">{expense.project?.code}</span>
                  <span className="text-[11px] text-slate-500 truncate max-w-[140px] block">
                    {expense.project?.name}
                  </span>
                </td>
                <td className="py-3.5 px-4 whitespace-nowrap">
                  <Badge category={expense.category} size="sm" />
                </td>
                <td className="py-3.5 px-4 max-w-xs">
                  <div className="font-semibold text-navy-900 truncate">{expense.vendor}</div>
                  <div className="text-[11px] text-slate-500 truncate" title={expense.description}>
                    {expense.description}
                  </div>
                  {expense.rejectionReason && expense.status === 'REJECTED' && (
                    <div className="mt-1 text-[10px] text-rose-700 bg-rose-50 p-1.5 rounded border border-rose-100">
                      <strong>Rejection note:</strong> {expense.rejectionReason}
                    </div>
                  )}
                </td>
                <td className="py-3.5 px-4 text-right font-bold text-navy-950 text-sm whitespace-nowrap">
                  {formatINR(expense.amount)}
                </td>
                <td className="py-3.5 px-4 text-center whitespace-nowrap">
                  <Badge status={expense.status} size="sm" />
                </td>
                <td className="py-3.5 px-4 text-center whitespace-nowrap">
                  {expense.receiptUrl ? (
                    <a
                      href={expense.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy-800 hover:text-navy-950 hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>View</span>
                    </a>
                  ) : (
                    <span className="text-slate-400 text-[11px]">—</span>
                  )}
                </td>
                <td className="py-3.5 px-4 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1.5">
                    {isOwner && expense.status === 'PENDING' && (
                      <>
                        <Button
                          size="sm"
                          variant="amber"
                          className="py-1 px-2.5 text-xs font-semibold"
                          onClick={() => onApprove?.(expense)}
                          leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="py-1 px-2 text-xs text-rose-700 hover:bg-rose-50 border-rose-200"
                          onClick={() => onReject?.(expense)}
                          leftIcon={<XCircle className="w-3.5 h-3.5 text-rose-600" />}
                        >
                          Reject
                        </Button>
                      </>
                    )}

                    {!isOwner && expense.status === 'REJECTED' && (
                      <Button
                        size="sm"
                        variant="amber"
                        className="py-1 px-2.5 text-xs font-semibold"
                        onClick={() => onResubmit?.(expense)}
                        leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                      >
                        Resubmit
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      className="p-1.5"
                      onClick={() => onView?.(expense)}
                      title="Inspect Details"
                    >
                      <Eye className="w-4 h-4 text-slate-500" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
