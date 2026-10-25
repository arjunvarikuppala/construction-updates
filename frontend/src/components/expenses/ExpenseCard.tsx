import React from 'react';
import { ExternalLink, CheckCircle2, XCircle, RefreshCw, Eye } from 'lucide-react';
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
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-card hover:shadow-card-hover transition-all space-y-3">
      {/* Top row: Status and Date */}
      <div className="flex items-center justify-between text-xs">
        <Badge status={expense.status} size="sm" />
        <span className="text-slate-500 font-medium">{formatDate(expense.date, 'dd MMM yyyy')}</span>
      </div>

      {/* Amount & Vendor */}
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h4 className="font-bold text-navy-950 text-base leading-snug">{expense.vendor}</h4>
          <span className="text-xs text-slate-500 font-medium block">
            {expense.project?.code} • {expense.project?.name}
          </span>
        </div>
        <div className="text-right flex-shrink-0">
          <span className="text-lg font-black text-navy-900">{formatINR(expense.amount)}</span>
        </div>
      </div>

      {/* Description & Category */}
      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs text-slate-700 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Badge category={expense.category} size="sm" />
          {expense.receiptUrl && (
            <a
              href={expense.receiptUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-semibold text-navy-800 flex items-center gap-1 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Bill Receipt</span>
            </a>
          )}
        </div>
        <p className="text-slate-600 line-clamp-2 pt-1">{expense.description}</p>
      </div>

      {/* Rejection Note Warning */}
      {expense.rejectionReason && expense.status === 'REJECTED' && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
          <span className="font-bold block text-[11px]">Reason for Rejection:</span>
          <p className="mt-0.5">{expense.rejectionReason}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="pt-1 flex items-center justify-end gap-2 border-t border-slate-100">
        <Button
          size="sm"
          variant="ghost"
          className="text-xs text-slate-600"
          onClick={() => onView?.(expense)}
          leftIcon={<Eye className="w-3.5 h-3.5" />}
        >
          Details
        </Button>

        {isOwner && expense.status === 'PENDING' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="text-xs text-rose-700 border-rose-200 hover:bg-rose-50"
              onClick={() => onReject?.(expense)}
              leftIcon={<XCircle className="w-3.5 h-3.5 text-rose-600" />}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="amber"
              className="text-xs font-semibold"
              onClick={() => onApprove?.(expense)}
              leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
            >
              Approve
            </Button>
          </>
        )}

        {!isOwner && expense.status === 'REJECTED' && (
          <Button
            size="sm"
            variant="amber"
            className="text-xs font-semibold"
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
