import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  X,
  Building2,
  Users,
  QrCode,
  FileText,
  Upload,
  Calendar,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../common/Button.js';
import { useToast } from '../../context/ToastContext.js';
import { Beneficiary, PaymentMethod, Expense } from '../../types/index.js';
import { UPIQRScannerModal } from './UPIQRScannerModal.js';
import { BeneficiaryModal } from './BeneficiaryModal.js';

interface PaymentRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultProjectId?: string;
  defaultExpenseId?: string;
}

export const PaymentRequestModal: React.FC<PaymentRequestModalProps> = ({
  isOpen,
  onClose,
  defaultProjectId,
  defaultExpenseId,
}) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  // Form states
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [amountInr, setAmountInr] = useState<number | ''>('');
  const [purpose, setPurpose] = useState('');
  const [preferredMethod, setPreferredMethod] = useState<PaymentMethod>('NEFT');
  const [relatedExpenseId, setRelatedExpenseId] = useState(defaultExpenseId || '');
  const [requestedDate, setRequestedDate] = useState(new Date().toISOString().split('T')[0]);
  const [remarks, setRemarks] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [invoiceFileName, setInvoiceFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Modals for QR scanner & Add Beneficiary
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [isBeneficiaryModalOpen, setIsBeneficiaryModalOpen] = useState(false);
  const [scannedInitialVpa, setScannedInitialVpa] = useState('');
  const [scannedInitialName, setScannedInitialName] = useState('');

  // Fetch projects
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ success: boolean; projects: any[] }>('/projects'),
  });
  const projects = projectsData?.projects || [];

  // Fetch beneficiaries
  const { data: beneficiariesData } = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: () => api.get<{ success: boolean; beneficiaries: Beneficiary[] }>('/payments/beneficiaries'),
  });
  const beneficiaries = beneficiariesData?.beneficiaries || [];

  // Fetch approved/unpaid expenses for the project to link
  const { data: expensesData } = useQuery({
    queryKey: ['project-expenses-unpaid', projectId],
    queryFn: () => api.get<{ success: boolean; expenses: Expense[] }>(`/expenses?project=${projectId}`),
    enabled: Boolean(projectId),
  });
  const expenses = expensesData?.expenses || [];

  // Submit payment request mutation
  const createRequestMutation = useMutation({
    mutationFn: (data: any) => api.post('/payments/requests', data),
    onSuccess: () => {
      showToast('Payment request submitted successfully for review', 'success');
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['payment-stats'] });
      onClose();
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to submit payment request', 'error');
    },
  });

  // Handle invoice file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('receipt', file);

      const res = await api.post<{ success: boolean; receiptUrl: string }>(
        '/expenses/upload-receipt',
        formData
      );

      if (res.success && res.receiptUrl) {
        setInvoiceUrl(res.receiptUrl);
        setInvoiceFileName(file.name);
        showToast('Invoice document uploaded', 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to upload invoice document', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // Callback from QR Scanner
  const handleBeneficiaryScanned = (scanned: {
    vpa: string;
    payeeName?: string;
    amountInr?: number;
    transactionNote?: string;
  }) => {
    if (scanned.amountInr && scanned.amountInr > 0) {
      setAmountInr(scanned.amountInr);
    }
    if (scanned.transactionNote) {
      setPurpose(scanned.transactionNote);
    }
    setPreferredMethod('UPI');

    // Check if beneficiary already exists with this VPA
    const matched = beneficiaries.find(
      (b) => b.vpa?.toLowerCase() === scanned.vpa.toLowerCase()
    );

    if (matched) {
      setBeneficiaryId(matched._id || matched.id || '');
      showToast(`Selected existing beneficiary: ${matched.name}`, 'info');
    } else {
      // Prompt user to add this new beneficiary
      setScannedInitialVpa(scanned.vpa);
      setScannedInitialName(scanned.payeeName || '');
      setIsBeneficiaryModalOpen(true);
    }
  };

  const selectedBeneficiary = beneficiaries.find(
    (b) => (b._id || b.id) === beneficiaryId
  );

  // Method suitability warnings
  const amountVal = Number(amountInr) || 0;
  const isHighValue = amountVal >= 100000;
  const rtgsUnderLimit = preferredMethod === 'RTGS' && amountVal > 0 && amountVal < 200000;
  const upiOverLimit = preferredMethod === 'UPI' && amountVal > 100000;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!projectId) {
      showToast('Please select a project', 'error');
      return;
    }
    if (!beneficiaryId) {
      showToast('Please select or add a beneficiary', 'error');
      return;
    }
    if (!amountInr || amountInr <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }
    if (rtgsUnderLimit) {
      showToast('RTGS requires a minimum amount of ₹2,00,000 as per RBI guidelines. Choose NEFT instead.', 'error');
      return;
    }
    if (upiOverLimit) {
      showToast('UPI standard limit is ₹1,00,000 per transaction as per NPCI guidelines. Choose NEFT or RTGS instead.', 'error');
      return;
    }

    createRequestMutation.mutate({
      project: projectId,
      beneficiary: beneficiaryId,
      amountPaise: Math.round(Number(amountInr) * 100),
      preferredMethod,
      purpose: purpose.trim(),
      relatedExpense: relatedExpenseId || undefined,
      requestedDate: requestedDate || undefined,
      invoiceUrl: invoiceUrl || undefined,
      remarks: remarks.trim() || undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-navy-950/70 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold">
                <CreditCard className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-navy-950">New Payment Request</h3>
                <p className="text-[11px] text-slate-500">Submit payout request to MD for authorization</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
            {/* Project Selection */}
            <div>
              <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                Target Project *
              </label>
              <select
                required
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 bg-white focus:ring-2 focus:ring-amber-500 outline-none"
              >
                <option value="">-- Select Project --</option>
                {projects.map((p) => (
                  <option key={p._id || p.id} value={p._id || p.id}>
                    [{p.code}] {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Beneficiary Header + Actions */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider">
                  Beneficiary (Contractor / Supplier / Labour) *
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsQrScannerOpen(true)}
                    className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg border border-amber-200 transition-colors"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Scan UPI QR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScannedInitialVpa('');
                      setScannedInitialName('');
                      setIsBeneficiaryModalOpen(true);
                    }}
                    className="text-[11px] font-bold text-navy-800 bg-navy-50 hover:bg-navy-100 px-2 py-1 rounded-lg border border-navy-200 transition-colors"
                  >
                    + Add New
                  </button>
                </div>
              </div>

              <select
                required
                value={beneficiaryId}
                onChange={(e) => setBeneficiaryId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 bg-white focus:ring-2 focus:ring-amber-500 outline-none"
              >
                <option value="">-- Choose Beneficiary --</option>
                {beneficiaries.map((b) => (
                  <option key={b._id || b.id} value={b._id || b.id}>
                    {b.name} ({b.payeeType}) — {b.vpa ? `UPI: ${b.vpa}` : `A/C: ${b.accountNumberMasked || 'Bank'}`}
                  </option>
                ))}
              </select>

              {/* Beneficiary Info preview card */}
              {selectedBeneficiary && (
                <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-navy-950">{selectedBeneficiary.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-navy-100 text-navy-800">
                      {selectedBeneficiary.payeeType}
                    </span>
                  </div>
                  <div className="text-slate-600 font-mono text-[11px]">
                    {selectedBeneficiary.vpa ? (
                      <span>VPA: {selectedBeneficiary.vpa}</span>
                    ) : (
                      <span>
                        A/C: {selectedBeneficiary.accountNumberMasked} | IFSC: {selectedBeneficiary.ifsc}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Amount (₹ INR) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                  Amount (₹ INR) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={amountInr}
                    onChange={(e) => setAmountInr(e.target.value ? Number(e.target.value) : '')}
                    className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-navy-950 focus:ring-2 focus:ring-amber-500 outline-none"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Preferred Transfer Method */}
              <div>
                <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                  Payment Mode *
                </label>
                <select
                  value={preferredMethod}
                  onChange={(e) => setPreferredMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 bg-white focus:ring-2 focus:ring-amber-500 outline-none font-semibold"
                >
                  <option value="NEFT">NEFT (All amounts / Standard)</option>
                  <option value="RTGS">RTGS (RBI Min ₹2,00,000 / Real-time)</option>
                  <option value="UPI">UPI Payout (NPCI Max ₹1,00,000 / Instant)</option>
                </select>
              </div>
            </div>

            {/* Method Limit Warnings */}
            {rtgsUnderLimit && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>RTGS requires a minimum of ₹2,00,000. Please select NEFT for smaller amounts.</span>
              </div>
            )}
            {upiOverLimit && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>UPI payouts cannot exceed ₹1,00,000. Please select NEFT or RTGS instead.</span>
              </div>
            )}

            {/* High-Value Dual Authorization Flag */}
            {isHighValue && (
              <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold">High-Value Transaction Policy:</span> This request exceeds ₹1,00,000.
                  Independent MD dual-authorization is mandatory before funds can be transferred.
                </div>
              </div>
            )}

            {/* Payment Purpose */}
            <div>
              <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                Purpose & Scope of Work *
              </label>
              <input
                type="text"
                required
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Foundation reinforcement rebar batch 2 delivery"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>

            {/* Link to Approved Expense (Optional) */}
            {expenses.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                  Link to Recorded Expense (Optional)
                </label>
                <select
                  value={relatedExpenseId}
                  onChange={(e) => setRelatedExpenseId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-700 bg-white focus:ring-2 focus:ring-amber-500 outline-none"
                >
                  <option value="">-- No expense linked --</option>
                  {expenses.map((exp) => (
                    <option key={exp._id || exp.id} value={exp._id || exp.id}>
                      [{exp.category}] ₹{(exp.amount / 100).toLocaleString('en-IN')} — {exp.description.substring(0, 40)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Invoice Attachment & Requested Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                  Requested Payment Date
                </label>
                <input
                  type="date"
                  value={requestedDate}
                  onChange={(e) => setRequestedDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 bg-white focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                  Invoice / Bill Document
                </label>
                <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-slate-300 hover:border-amber-500 hover:bg-amber-50/20 cursor-pointer transition-colors text-xs font-semibold text-slate-700">
                  <Upload className="w-4 h-4 text-slate-400" />
                  <span className="truncate">
                    {isUploading ? 'Uploading...' : invoiceFileName || 'Upload Invoice (PDF/Img)'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                  />
                </label>
              </div>
            </div>

            {/* Additional Remarks */}
            <div>
              <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
                Remarks for MD Review
              </label>
              <textarea
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Additional delivery confirmations or site notes"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs text-slate-800 focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="ghost" onClick={onClose} type="button">
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                isLoading={createRequestMutation.isPending}
                disabled={rtgsUnderLimit || upiOverLimit}
              >
                Submit Payment Request
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* QR Scanner Modal */}
      <UPIQRScannerModal
        isOpen={isQrScannerOpen}
        onClose={() => setIsQrScannerOpen(false)}
        onBeneficiaryScanned={handleBeneficiaryScanned}
      />

      {/* Add Beneficiary Modal */}
      <BeneficiaryModal
        isOpen={isBeneficiaryModalOpen}
        onClose={() => setIsBeneficiaryModalOpen(false)}
        initialVpa={scannedInitialVpa}
        initialName={scannedInitialName}
      />
    </>
  );
};
