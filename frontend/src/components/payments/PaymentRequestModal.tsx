import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Receipt,
  UserCheck,
  AlertTriangle,
  ShieldCheck,
  CreditCard,
  Banknote,
  Send,
  Plus,
} from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';
import { Beneficiary, PaymentMethod, Expense } from '../../types/index.js';
import { formatINR } from '../../utils/currency.js';
import { useToast } from '../../context/ToastContext.js';
import { api } from '../../api/client.js';

interface PaymentRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedProjectId?: string;
  preselectedExpense?: Expense;
  onOpenAddBeneficiary?: () => void;
}

export const PaymentRequestModal: React.FC<PaymentRequestModalProps> = ({
  isOpen,
  onClose,
  preselectedProjectId,
  preselectedExpense,
  onOpenAddBeneficiary,
}) => {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [projectId, setProjectId] = useState<string>(preselectedProjectId || '');
  const [beneficiaryId, setBeneficiaryId] = useState<string>('');
  const [expenseId, setExpenseId] = useState<string>(preselectedExpense?._id || '');
  const [amountRupees, setAmountRupees] = useState<string>(
    preselectedExpense ? String(preselectedExpense.amount / 100) : ''
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('NEFT');
  const [purpose, setPurpose] = useState<string>(preselectedExpense?.description || '');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');

  useEffect(() => {
    if (preselectedProjectId) setProjectId(preselectedProjectId);
    if (preselectedExpense) {
      setExpenseId(preselectedExpense._id);
      setAmountRupees(String(preselectedExpense.amount / 100));
      setPurpose(preselectedExpense.description);
    }
  }, [preselectedProjectId, preselectedExpense]);

  // Fetch Projects
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ count: number; projects: any[] }>('/projects'),
  });

  // Fetch Beneficiaries
  const { data: beneficiariesData } = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: () => api.get<{ count: number; beneficiaries: Beneficiary[] }>('/payments/beneficiaries'),
  });

  // Fetch Approved Expenses for chosen project
  const { data: expensesData } = useQuery({
    queryKey: ['approved-expenses', projectId],
    queryFn: () => api.get<{ expenses: Expense[] }>(`/expenses?projectId=${projectId}&status=APPROVED`),
    enabled: Boolean(projectId),
  });

  const projects = projectsData?.projects || [];
  const beneficiaries = beneficiariesData?.beneficiaries || [];
  const approvedExpenses = (expensesData?.expenses || []).filter(
    (e) => e.paymentStatus !== 'PAID'
  );

  const selectedBeneficiary = beneficiaries.find((b) => (b._id || b.id) === beneficiaryId);
  const numericAmount = parseFloat(amountRupees) || 0;
  const amountPaise = Math.round(numericAmount * 100);
  const isHighValue = amountPaise > 10000000; // > ₹1,00,000

  // RTGS validation
  const isRTGSDisabled = numericAmount < 200000;

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      return api.post('/payments/requests', payload);
    },
    onSuccess: () => {
      success('Payment request submitted successfully!');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      handleReset();
      onClose();
    },
    onError: (err: any) => {
      toastError(err.message || 'Failed to submit payment request');
    },
  });

  const handleReset = () => {
    setProjectId(preselectedProjectId || '');
    setBeneficiaryId('');
    setExpenseId('');
    setAmountRupees('');
    setPaymentMethod('NEFT');
    setPurpose('');
    setInvoiceNumber('');
  };

  const handleExpenseSelect = (eId: string) => {
    setExpenseId(eId);
    const exp = approvedExpenses.find((e) => (e._id || e.id) === eId);
    if (exp) {
      setAmountRupees(String(exp.amount / 100));
      setPurpose(`Settlement for approved expense: ${exp.description}`);
      if (!invoiceNumber && exp.vendor) {
        setInvoiceNumber(`INV-${exp.vendor.slice(0, 4).toUpperCase()}`);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!projectId) {
      toastError('Please select a project');
      return;
    }

    if (!beneficiaryId) {
      toastError('Please select a beneficiary payee');
      return;
    }

    if (!numericAmount || numericAmount <= 0) {
      toastError('Please specify a valid payment amount');
      return;
    }

    if (paymentMethod === 'RTGS' && numericAmount < 200000) {
      toastError('RTGS minimum amount is ₹2,00,000 as per RBI regulations. Please switch to NEFT.');
      return;
    }

    if (!purpose.trim()) {
      toastError('Please provide a purpose or description for this transfer');
      return;
    }

    createMutation.mutate({
      projectId,
      beneficiaryId,
      expenseId: expenseId || undefined,
      amountRupees: numericAmount,
      paymentMethod,
      purpose: purpose.trim(),
      invoiceNumber: invoiceNumber.trim() || undefined,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        handleReset();
        onClose();
      }}
      title="Create Contractor / Supplier Payment Request"
      description="Prepare a verified bank transfer linked to a construction project and approved expense."
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Project & Beneficiary Selection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Construction Project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setExpenseId('');
            }}
            required
            options={[
              { value: '', label: '-- Select Construction Project --' },
              ...projects.map((p) => ({
                value: p._id || p.id,
                label: `${p.code} - ${p.name}`,
              })),
            ]}
          />

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Beneficiary Payee <span className="text-rose-500">*</span>
              </label>
              {onOpenAddBeneficiary && (
                <button
                  type="button"
                  onClick={onOpenAddBeneficiary}
                  className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add New Payee
                </button>
              )}
            </div>
            <select
              value={beneficiaryId}
              onChange={(e) => setBeneficiaryId(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-navy-900 focus:border-navy-900"
            >
              <option value="">-- Select Beneficiary --</option>
              {beneficiaries.map((b) => (
                <option key={b._id || b.id} value={b._id || b.id}>
                  {b.name} ({b.payeeType}) - {b.bankName} [{b.accountNumberMasked}]
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selected Beneficiary Details Preview */}
        {selectedBeneficiary && (
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Payee Type</span>
              <span className="font-semibold text-navy-950">{selectedBeneficiary.payeeType}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Bank Name</span>
              <span className="font-semibold text-navy-950">{selectedBeneficiary.bankName}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Account</span>
              <span className="font-mono font-semibold text-navy-950">
                {selectedBeneficiary.accountNumberMasked}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Verification</span>
              <span
                className={`inline-flex items-center gap-1 font-bold text-[11px] ${
                  selectedBeneficiary.verificationStatus === 'VERIFIED'
                    ? 'text-emerald-700'
                    : 'text-amber-600'
                }`}
              >
                {selectedBeneficiary.verificationStatus === 'VERIFIED' ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Penny Drop Verified
                  </>
                ) : (
                  'Unverified Account'
                )}
              </span>
            </div>
          </div>
        )}

        {/* Optional Link to Approved Expense */}
        {projectId && approvedExpenses.length > 0 && (
          <div>
            <Select
              label="Link to Approved Expense Voucher (Optional)"
              value={expenseId}
              onChange={(e) => handleExpenseSelect(e.target.value)}
              helperText="Auto-populates amount and marks expense as PAID upon completion."
              options={[
                { value: '', label: '-- None (Direct Contractor/Supplier Advance) --' },
                ...approvedExpenses.map((exp) => ({
                  value: exp._id || exp.id!,
                  label: `[₹${(exp.amount / 100).toLocaleString('en-IN')}] ${exp.vendor} - ${exp.description.slice(0, 40)}`,
                })),
              ]}
            />
          </div>
        )}

        {/* Amount & Payment Method */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Input
              label="Transfer Amount (₹ INR)"
              type="number"
              step="any"
              min="1"
              placeholder="e.g. 150000"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              required
              helperText={
                numericAmount > 0
                  ? `Equivalent to: ${formatINR(amountPaise)}`
                  : 'Enter amount in Indian Rupees'
              }
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Payment Clearing Method <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('NEFT')}
                className={`p-2.5 rounded-xl border text-xs font-bold transition-all text-left flex flex-col justify-between ${
                  paymentMethod === 'NEFT'
                    ? 'border-navy-900 bg-navy-50 text-navy-950 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="font-extrabold text-navy-950">NEFT</span>
                <span className="text-[10px] text-slate-500 font-normal mt-0.5">
                  No minimum limit (24x7)
                </span>
              </button>

              <button
                type="button"
                disabled={isRTGSDisabled}
                onClick={() => setPaymentMethod('RTGS')}
                className={`p-2.5 rounded-xl border text-xs font-bold transition-all text-left flex flex-col justify-between ${
                  paymentMethod === 'RTGS'
                    ? 'border-navy-900 bg-navy-50 text-navy-950 shadow-xs'
                    : isRTGSDisabled
                    ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="font-extrabold text-navy-950">RTGS</span>
                <span className="text-[10px] text-slate-500 font-normal mt-0.5">
                  Min. ₹2,00,000 (RBI rule)
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* High-Value Threshold Warning Alert */}
        {isHighValue && (
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-300 flex items-start gap-2.5 text-xs text-amber-900 animate-in fade-in">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold block">
                High-Value Transaction Threshold Triggered (&gt; ₹1,00,000)
              </span>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                This transaction exceeds ₹1,00,000. It will automatically enter the{' '}
                <strong>Awaiting Authorization</strong> queue and requires independent executive MD authorization before bank funds can be transferred.
              </p>
            </div>
          </div>
        )}

        {/* Invoice & Purpose */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Invoice / Bill Reference No. (Optional)"
            placeholder="e.g. INV-2026-089"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />

          <Input
            label="Purpose / Remittance Description"
            placeholder="e.g. Steel bar supply for Foundation Block A"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            required
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              handleReset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="amber"
            className="font-bold"
            isLoading={createMutation.isPending}
            leftIcon={<Send className="w-4 h-4 text-navy-950" />}
          >
            Submit Payment Request
          </Button>
        </div>
      </form>
    </Modal>
  );
};
