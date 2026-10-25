import React from 'react';
import { CheckCircle2, AlertTriangle, ExternalLink, Receipt } from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Expense } from '../../types/index.js';
import { formatINR } from '../../utils/currency.js';
import { formatDate } from '../../utils/dates.js';

interface ExpenseApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense | null;
  onApprove: (expenseId: string) => void;
  isLoading: boolean;
}

export const ExpenseApprovalModal: React.FC<ExpenseApprovalModalProps> = ({
  isOpen,
  onClose,
  expense,
  onApprove,
  isLoading,
}) => {
  if (!expense) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Verify & Approve Expense"
      description={`Review submission details for ${expense.project?.name}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="amber"
            onClick={() => onApprove(expense._id || expense.id!)}
            isLoading={isLoading}
            leftIcon={<CheckCircle2 className="w-4 h-4" />}
          >
            Confirm Approval
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Amount Highlight Banner */}
        <div className="bg-navy-900 text-white p-4 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs uppercase text-slate-300 font-bold tracking-wider">Requested Amount</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-400">
              {formatINR(expense.amount)}
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-300">Category</span>
            <div className="text-sm font-semibold text-white">
              {expense.category.replace(/_/g, ' ')}
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
          <div>
            <span className="text-slate-500 font-medium">Project:</span>
            <p className="font-semibold text-navy-950 mt-0.5">{expense.project?.name} ({expense.project?.code})</p>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Vendor / Payee:</span>
            <p className="font-semibold text-navy-950 mt-0.5">{expense.vendor}</p>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Expense Date:</span>
            <p className="font-semibold text-navy-950 mt-0.5">{formatDate(expense.date)}</p>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Submitted By:</span>
            <p className="font-semibold text-navy-950 mt-0.5">{expense.submittedBy?.name}</p>
          </div>
        </div>

        {/* Description */}
        <div>
          <span className="text-xs font-semibold text-slate-700">Description & Purpose:</span>
          <p className="mt-1 text-sm text-slate-800 bg-white p-3 rounded-lg border border-slate-200">
            {expense.description}
          </p>
        </div>

        {/* Receipt Preview */}
        {expense.receiptUrl ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-700">Attached Receipt / Bill:</span>
              <a
                href={expense.receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-navy-800 hover:text-navy-950 flex items-center gap-1 hover:underline"
              >
                <span>Open full image</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 max-h-64 flex items-center justify-center">
              <img
                src={expense.receiptUrl}
                alt="Receipt"
                className="max-h-64 object-contain w-full hover:scale-105 transition-transform duration-200"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
            <Receipt className="w-4 h-4 text-slate-400" />
            <span>No image attachment was provided for this expense.</span>
          </div>
        )}

        {/* Non-negotiable Disclaimer */}
        <div className="flex items-start gap-2.5 p-3.5 bg-amber-50/80 border border-amber-200/90 rounded-xl text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p>
            <strong>Statutory Compliance Notice:</strong> Approval verifies expense legitimacy and project allocation. Approval does not constitute proof of payment or final tax clearance.
          </p>
        </div>
      </div>
    </Modal>
  );
};
