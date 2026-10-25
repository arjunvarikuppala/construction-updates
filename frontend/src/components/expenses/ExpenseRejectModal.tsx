import React, { useState } from 'react';
import { XCircle, AlertCircle } from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Textarea } from '../common/Input.js';
import { Expense } from '../../types/index.js';
import { formatINR } from '../../utils/currency.js';

interface ExpenseRejectModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense | null;
  onReject: (expenseId: string, reason: string) => void;
  isLoading: boolean;
}

export const ExpenseRejectModal: React.FC<ExpenseRejectModalProps> = ({
  isOpen,
  onClose,
  expense,
  onReject,
  isLoading,
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  if (!expense) return null;

  const handleConfirm = () => {
    if (!reason.trim()) {
      setError('A rejection reason is strictly required so the in-charge can make corrections.');
      return;
    }
    setError('');
    onReject(expense._id || expense.id!, reason.trim());
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reject Expense Submission"
      description={`Provide corrective instructions for ${expense.vendor} (${formatINR(expense.amount)})`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            isLoading={isLoading}
            leftIcon={<XCircle className="w-4 h-4" />}
          >
            Confirm Rejection
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-900">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <p>
            The project in-charge will be notified and given the opportunity to correct the documented discrepancy and resubmit.
          </p>
        </div>

        <Textarea
          label="Documented Rejection Reason"
          placeholder="E.g., Missing vehicle registration on weighbridge slip; vendor GST number invalid; rate exceeds approved contractor schedule..."
          rows={4}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError('');
          }}
          error={error}
          required
        />
      </div>
    </Modal>
  );
};
