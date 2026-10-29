import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, CheckCircle2, XCircle, RefreshCw, Eye, ArrowRight } from 'lucide-react';
import { Expense } from '../../types/index.js';
import { Badge } from '../common/Badge.js';
import { Button } from '../common/Button.js';
import { formatINR } from '../../utils/currency.js';
import { formatDate } from '../../utils/dates.js';

interface ExpenseCardProps {
  expense: Expense;
  isOwner: boolean;
  onApprove?: (expense: Expense) => void;
  onReject?: (expense: Expense) => void;
  onResubmit?: (expense: Expense) => void;
  onView?: (expense: Expense) => void;
}

export const ExpenseCard: React.FC<ExpenseCardProps> = ({
  expense,
  isOwner,
  onApprove,
  onReject,
  onResubmit,
  onView,
}) => {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-card hover:shadow-card-hover transition-all space-y-2.5">
      {/* Row 1: Status badge and date */}
      <div className="flex items-center justify-between text-xs">
        <Badge status={expense.status} size="sm" />
        <span className="text-slate-500 font-medium">{formatDate(expense.date, 'dd MMM yyyy')}</span>
      </div>

      {/* Row 2: Expense description/title and amount */}
      <div className="flex items-baseline justify-between gap-3 pt-0.5">
        <h4
          className="font-bold text-navy-950 text-base leading-snug truncate flex-1 min-w-0"
          title={expense.description || expense.vendor}
        >
          {expense.description || expense.vendor}
        </h4>
        <span className="text-base sm:text-lg font-black text-navy-900 shrink-0">
          {formatINR(expense.amount)}
        </span>
      </div>

      {/* Row 3: Project code and project name */}
      <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate -mt-1">
        {expense.project?.code && (
          <span className="font-mono text-[11px] font-bold text-navy-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
            {expense.project.code}
          </span>
        )}
        <span className="truncate font-medium">{expense.project?.name || expense.vendor}</span>
      </div>

      {/* Row 4: Category and Bill Receipt action in a light-grey panel */}
      <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100 flex items-center justify-between gap-2">
        <Badge category={expense.category} size="sm" />
        {expense.receiptUrl ? (
          <a
            href={expense.receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-navy-800 flex items-center gap-1 hover:text-amber-600 transition-colors"
          >
            <span>Bill Receipt</span>
            <ExternalLink className="w-3 h-3 text-slate-400" />
          </a>
        ) : (
          <span className="text-[11px] text-slate-400 italic">No receipt attached</span>
        )}
      </div>

      {/* Rejection Note Warning */}
      {expense.rejectionReason && expense.status === 'REJECTED' && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
          <span className="font-bold block text-[11px]">Reason for Rejection:</span>
          <p className="mt-0.5">{expense.rejectionReason}</p>
        </div>
      )}

      {/* Row 5: Centered Details action with eye icon and right arrow */}
      <div className="pt-1 border-t border-slate-100 space-y-2">
        <button
          type="button"
          onClick={() => (onView ? onView(expense) : navigate('/expenses'))}
          className="w-full py-2 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 flex items-center justify-center gap-2 transition-colors active:bg-slate-200"
        >
          <Eye className="w-3.5 h-3.5 text-slate-500" />
          <span>Details</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
        </button>

        {isOwner && expense.status === 'PENDING' && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs text-rose-700 border-rose-200 hover:bg-rose-50"
              onClick={() => onReject?.(expense)}
              leftIcon={<XCircle className="w-3.5 h-3.5 text-rose-600" />}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="amber"
              className="flex-1 text-xs font-semibold"
              onClick={() => onApprove?.(expense)}
              leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
            >
              Approve
            </Button>
          </div>
        )}

        {!isOwner && expense.status === 'REJECTED' && (
          <Button
            size="sm"
            variant="amber"
            className="w-full text-xs font-semibold"
            onClick={() => onResubmit?.(expense)}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Resubmit
          </Button>
        )}
      </div>
    </div>
  );
};
