import React, { useState } from 'react';
import { RefreshCw, Upload, FileText } from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Input, Textarea, Select } from '../common/Input.js';
import { Expense, ExpenseCategory } from '../../types/index.js';
import { paiseToRupees } from '../../utils/currency.js';
import { api } from '../../api/client.js';

interface ExpenseResubmitModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense: Expense | null;
  onResubmit: (updatedData: any) => void;
  isLoading: boolean;
}

const CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'CONSTRUCTION_MATERIALS', label: 'Construction Materials' },
  { value: 'LABOUR', label: 'Labour Payment' },
  { value: 'DIESEL_AND_FUEL', label: 'Diesel and Fuel' },
  { value: 'MACHINERY_AND_EQUIPMENT', label: 'Machinery & Equipment' },
  { value: 'TRANSPORTATION', label: 'Transportation & Logistics' },
  { value: 'FOOD_AND_ACCOMMODATION', label: 'Food & Accommodation' },
  { value: 'REPAIRS_AND_MAINTENANCE', label: 'Repairs & Maintenance' },
  { value: 'OTHER', label: 'Other Operational Expense' },
];

export const ExpenseResubmitModal: React.FC<ExpenseResubmitModalProps> = ({
  isOpen,
  onClose,
  expense,
  onResubmit,
  isLoading,
}) => {
  if (!expense) return null;

  const [category, setCategory] = useState<ExpenseCategory>(expense.category);
  const [description, setDescription] = useState(expense.description);
  const [amountRupees, setAmountRupees] = useState(String(paiseToRupees(expense.amount)));
  const [vendor, setVendor] = useState(expense.vendor);
  const [notes, setNotes] = useState('');
  const [receiptUrl, setReceiptUrl] = useState(expense.receiptUrl || '');
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    setIsUploading(true);

    try {
      const res = await api.post<{ success: boolean; fileUrl: string }>('/uploads/single', formData);
      if (res.success) {
        setReceiptUrl(res.fileUrl);
      }
    } catch (err) {
      console.error('File upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = () => {
    onResubmit({
      id: expense._id || expense.id,
      category,
      description,
      amount: parseFloat(amountRupees),
      vendor,
      receiptUrl,
      notes,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Correct & Resubmit Expense"
      description={`Original rejection: "${expense.rejectionReason}"`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="amber"
            onClick={handleSave}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="w-4 h-4" />}
          >
            Resubmit for Review
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Rejection notice box */}
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
          <span className="font-bold block mb-0.5">Managing Director Rejection Note:</span>
          <p className="italic">{expense.rejectionReason}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            options={CATEGORIES}
            required
          />

          <Input
            label="Amount (in ₹ Rupees)"
            type="number"
            step="0.01"
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            required
          />
        </div>

        <Input
          label="Vendor / Payee Name"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          required
        />

        <Textarea
          label="Expense Description & Work Reference"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />

        <Textarea
          label="Corrections & Resubmission Note to Owner"
          placeholder="E.g., Attached revised GST invoice with weighbridge slip as requested..."
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          required
        />

        {/* Upload replacement receipt */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">
            Updated Bill / Receipt Photo
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors">
              <Upload className="w-4 h-4 text-slate-500" />
              <span>{isUploading ? 'Uploading...' : 'Choose File / Take Photo'}</span>
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} />
            </label>
            {receiptUrl && (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                Receipt attached
              </span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
