import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode, Upload, CheckCircle2, X, UserRound, Store, Send } from 'lucide-react';
import { api } from '../../api/client.js';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Input, Select, Textarea } from '../common/Input.js';
import { useToast } from '../../context/ToastContext.js';
import { useAuth } from '../../context/AuthContext.js';
import type { Beneficiary, Expense, PayeeKind, ProjectAssignment } from '../../types/index.js';
import { localDateString } from '../../utils/dates.js';
import { uploadFileWithProgress } from '../../utils/upload.js';
import { inr, isValidVpa, newSettlementKey, rememberVpa, rememberedVpa } from '../../utils/payments.js';
import { UPIQRScannerModal } from './UPIQRScannerModal.js';
import { BeneficiaryModal } from './BeneficiaryModal.js';
import { PayFields, PayDraft, emptyPayDraft, payDraftProblems, payDraftToPayload } from './PayFields.js';

const NO_SPIN = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

interface PaymentRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultProjectId?: string;
  defaultExpenseId?: string;
}

/**
 * Site In-Charge: ask the MD to pay you (reimbursement / site advance) or a vendor.
 * MD: add a payment to make later, or record one already made ("I have paid this").
 */
export const PaymentRequestModal: React.FC<PaymentRequestModalProps> = ({
  isOpen,
  onClose,
  defaultProjectId,
  defaultExpenseId,
}) => {
  const { success, error: toastError, showToast } = useToast();
  const { isOwner, user } = useAuth();
  const queryClient = useQueryClient();

  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [payeeKind, setPayeeKind] = useState<PayeeKind>('INCHARGE');
  const [payeeUserId, setPayeeUserId] = useState('');
  const [payeeVpa, setPayeeVpa] = useState('');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('bags');
  const [rate, setRate] = useState('');
  const fillAmount = (q: string, r: string) => {
    const total = (parseFloat(q) || 0) * (parseFloat(r) || 0);
    if (total > 0) setAmount(String(Math.round(total * 100) / 100));
  };
  const [expenseId, setExpenseId] = useState(defaultExpenseId || '');
  const [neededBy, setNeededBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [bill, setBill] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [paidAlready, setPaidAlready] = useState(false);
  const [payDraft, setPayDraft] = useState<PayDraft>(() => emptyPayDraft(0, false));
  const [settlementKey, setSettlementKey] = useState(newSettlementKey);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [isBeneficiaryModalOpen, setIsBeneficiaryModalOpen] = useState(false);
  const [scannedVpa, setScannedVpa] = useState('');
  const [scannedName, setScannedName] = useState('');

  // Reset each time it opens
  useEffect(() => {
    if (!isOpen) return;
    setProjectId(defaultProjectId || '');
    setPayeeKind('INCHARGE');
    setPayeeUserId('');
    setPayeeVpa(isOwner ? '' : rememberedVpa());
    setBeneficiaryId('');
    setAmount('');
    setPurpose('');
    setQty('');
    setUnit('bags');
    setRate('');
    setExpenseId(defaultExpenseId || '');
    setNeededBy('');
    setRemarks('');
    setBill(null);
    setPaidAlready(false);
    setPayDraft(emptyPayDraft(0, false));
    setSettlementKey(newSettlementKey());
    setShowErrors(false);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: any[] }>('/projects'),
    enabled: isOpen,
  });
  const projects = projectsData?.projects || [];
  useEffect(() => {
    if (isOpen && !projectId && projects.length === 1) setProjectId(projects[0]._id || projects[0].id);
  }, [isOpen, projects, projectId]);

  const { data: beneficiariesData } = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: () => api.get<{ beneficiaries: Beneficiary[] }>('/payments/beneficiaries'),
    enabled: isOpen,
  });
  const beneficiaries = beneficiariesData?.beneficiaries || [];

  const { data: assignmentsData } = useQuery({
    queryKey: ['project-assignments', projectId],
    queryFn: () => api.get<{ assignments: ProjectAssignment[] }>(`/projects/${projectId}/assignments`),
    enabled: isOpen && isOwner && Boolean(projectId),
  });
  const inCharges = (assignmentsData?.assignments || []).filter((a) => a.assignmentStatus === 'ACTIVE' && a.siteInCharge);

  const { data: expensesData } = useQuery({
    queryKey: ['project-expenses-unpaid', projectId],
    queryFn: () => api.get<{ expenses: Expense[] }>(`/expenses?projectId=${projectId}`),
    enabled: isOpen && Boolean(projectId),
  });
  const linkableExpenses = (expensesData?.expenses || []).filter(
    (e: any) => e.status !== 'REJECTED' && (!e.paymentStatus || e.paymentStatus === 'UNPAID')
  );

  const selectedBeneficiary = beneficiaries.find((b) => (b._id || b.id) === beneficiaryId);
  const selectedInCharge = inCharges.find((a) => a.siteInCharge._id === payeeUserId)?.siteInCharge;
  const amountPaise = Math.round((parseFloat(amount) || 0) * 100);
  const payeeName =
    payeeKind === 'VENDOR' ? selectedBeneficiary?.name || '' : isOwner ? selectedInCharge?.name || '' : user?.name || '';
  const effectiveVpa = payeeKind === 'VENDOR' ? selectedBeneficiary?.vpa || '' : payeeVpa.trim().toLowerCase();

  // Pre-fill the amount paid with the full request amount
  useEffect(() => {
    if (paidAlready) setPayDraft((d) => ({ ...d, amount: amount, mode: effectiveVpa ? d.mode : d.mode === 'UPI' ? 'BANK_TRANSFER' : d.mode }));
  }, [paidAlready]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!projectId) p.push('choose the site');
    if (payeeKind === 'VENDOR' && !beneficiaryId) p.push('choose or add the vendor');
    if (payeeKind === 'INCHARGE' && isOwner && !payeeUserId) p.push('choose the Site In-Charge');
    if (payeeKind === 'INCHARGE' && payeeVpa.trim() && !isValidVpa(payeeVpa)) p.push('the UPI ID does not look right');
    if (amountPaise < 100) p.push('enter the amount');
    if (!purpose.trim()) p.push('say what the payment is for');
    if (paidAlready) p.push(...payDraftProblems(payDraft, amountPaise));
    return p;
  }, [projectId, payeeKind, beneficiaryId, isOwner, payeeUserId, payeeVpa, amountPaise, purpose, paidAlready, payDraft]);

  const onBill = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(1);
    try {
      const up = await uploadFileWithProgress(file, (pct) => setUploading(Math.max(1, pct)));
      setBill({ url: up.url, name: up.originalName });
    } catch (err: any) {
      toastError(err.message || 'Upload failed');
    } finally {
      setUploading(0);
    }
  };

  const handleScanned = (scanned: { vpa: string; payeeName?: string; amountInr?: number; transactionNote?: string }) => {
    if (scanned.amountInr && scanned.amountInr > 0) setAmount(String(scanned.amountInr));
    if (scanned.transactionNote && !purpose) setPurpose(scanned.transactionNote);
    setPayeeKind('VENDOR');
    const matched = beneficiaries.find((b) => b.vpa?.toLowerCase() === scanned.vpa.toLowerCase());
    if (matched) {
      setBeneficiaryId(matched._id || matched.id || '');
      showToast(`Selected ${matched.name}`, 'info');
    } else {
      setScannedVpa(scanned.vpa);
      setScannedName(scanned.payeeName || '');
      setIsBeneficiaryModalOpen(true);
    }
  };

  const submit = async () => {
    if (problems.length) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ message: string }>('/payments/requests', {
        projectId,
        payeeKind,
        payeeUserId: payeeKind === 'INCHARGE' && isOwner ? payeeUserId : undefined,
        payeeVpa: payeeKind === 'INCHARGE' && payeeVpa.trim() ? payeeVpa.trim().toLowerCase() : undefined,
        beneficiaryId: payeeKind === 'VENDOR' ? beneficiaryId : undefined,
        amountRupees: amount,
        paymentMethod: effectiveVpa ? 'UPI' : 'NEFT',
        purpose: purpose.trim(),
        quantity: parseFloat(qty) > 0 ? parseFloat(qty) : undefined,
        unit: parseFloat(qty) > 0 ? unit : undefined,
        rate: parseFloat(qty) > 0 && parseFloat(rate) > 0 ? parseFloat(rate) : undefined,
        expenseId: expenseId || undefined,
        requestedPaymentDate: neededBy || undefined,
        invoiceUrl: bill?.url,
        inchargeRemarks: remarks.trim() || undefined,
        payNow: isOwner && paidAlready ? payDraftToPayload(payDraft, settlementKey) : undefined,
      });
      if (payeeKind === 'INCHARGE' && !isOwner && payeeVpa.trim()) rememberVpa(payeeVpa.trim().toLowerCase());
      success(res.message || 'Saved');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payment-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['project-expenses-unpaid'] }),
      ]);
      onClose();
    } catch (err: any) {
      setSettlementKey(newSettlementKey());
      toastError(err.message || 'Could not save the payment request');
    } finally {
      setSaving(false);
    }
  };

  const submitLabel = isOwner ? (paidAlready ? 'Save & record payment' : 'Add payment to make') : 'Send to MD';

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={saving ? () => undefined : onClose}
        title={isOwner ? 'New payment' : 'Request a payment'}
        description={isOwner ? 'Pay a Site In-Charge or a vendor' : 'The MD approves by paying — you are notified when it is paid'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} isLoading={saving} leftIcon={<Send className="w-4 h-4" />}>
              {submitLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Site"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setPayeeUserId('');
              setExpenseId('');
            }}
            options={[
              { value: '', label: 'Choose the site' },
              ...projects.map((p: any) => ({ value: p._id || p.id, label: `${p.code} – ${p.name}` })),
            ]}
          />

          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1.5">Who gets the money?</span>
            <div role="radiogroup" aria-label="Who gets the money" className="grid grid-cols-2 gap-2">
              {[
                { kind: 'INCHARGE' as const, icon: UserRound, label: isOwner ? 'Site In-Charge' : 'Me', sub: isOwner ? 'Advance / reimbursement' : 'Reimburse me / site advance' },
                { kind: 'VENDOR' as const, icon: Store, label: 'Vendor', sub: 'Contractor, supplier, labour' },
              ].map((o) => (
                <button
                  key={o.kind}
                  type="button"
                  role="radio"
                  aria-checked={payeeKind === o.kind}
                  onClick={() => setPayeeKind(o.kind)}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition ${
                    payeeKind === o.kind ? 'border-navy-900 bg-navy-50 ring-1 ring-navy-900' : 'border-slate-300 bg-white hover:bg-slate-50'
                  }`}
                >
                  <o.icon className={`w-5 h-5 shrink-0 ${payeeKind === o.kind ? 'text-navy-900' : 'text-slate-400'}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-navy-950">{o.label}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{o.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {payeeKind === 'INCHARGE' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {isOwner && (
                <Select
                  label="Site In-Charge"
                  value={payeeUserId}
                  onChange={(e) => setPayeeUserId(e.target.value)}
                  disabled={!projectId}
                  options={[
                    { value: '', label: projectId ? (inCharges.length ? 'Choose' : 'No In-Charge on this site') : 'Choose the site first' },
                    ...inCharges.map((a) => ({ value: a.siteInCharge._id, label: a.siteInCharge.name })),
                  ]}
                />
              )}
              <Input
                label={isOwner ? 'Their UPI ID (optional)' : 'Your UPI ID (optional)'}
                value={payeeVpa}
                autoCapitalize="none"
                inputMode="email"
                maxLength={100}
                onChange={(e) => setPayeeVpa(e.target.value.replace(/\s+/g, ''))}
                error={payeeVpa && !isValidVpa(payeeVpa) && payeeVpa.includes('@') && payeeVpa.split('@')[1].length > 1 ? 'Check the UPI ID' : undefined}
                helperText="Lets the MD pay with one tap from their UPI app"
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <span className="text-xs font-semibold text-slate-700">Vendor</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsQrScannerOpen(true)}
                    className="inline-flex items-center gap-1 min-h-[32px] text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 px-2 rounded-lg border border-amber-200"
                  >
                    <QrCode className="w-3.5 h-3.5" /> Scan UPI QR
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScannedVpa('');
                      setScannedName('');
                      setIsBeneficiaryModalOpen(true);
                    }}
                    className="min-h-[32px] text-[11px] font-bold text-navy-800 bg-navy-50 hover:bg-navy-100 px-2 rounded-lg border border-navy-200"
                  >
                    + New vendor
                  </button>
                </div>
              </div>
              <Select
                aria-label="Vendor"
                value={beneficiaryId}
                onChange={(e) => setBeneficiaryId(e.target.value)}
                options={[
                  { value: '', label: beneficiaries.length ? 'Choose the vendor' : 'No vendors yet — add one' },
                  ...beneficiaries.map((b) => ({
                    value: b._id || b.id || '',
                    label: `${b.name}${b.vpa ? ` · ${b.vpa}` : b.accountNumberMasked ? ` · A/C ${b.accountNumberMasked.slice(-4)}` : ''}`,
                  })),
                ]}
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Amount"
              type="number"
              inputMode="decimal"
              min="1"
              step="0.01"
              className={NO_SPIN}
              leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              helperText={amountPaise >= 100 ? inr(amountPaise) : undefined}
            />
            <Input
              label="Needed by (optional)"
              type="date"
              min={localDateString()}
              value={neededBy}
              onChange={(e) => setNeededBy(e.target.value)}
            />
          </div>

          <Input label="What is it for?" maxLength={300} value={purpose} onChange={(e) => setPurpose(e.target.value)} />

          {/* Optional: quantity × rate (e.g. 120 bags × ₹380). Fills the amount when both are given. */}
          <div className="grid grid-cols-3 gap-2">
            <Input
              label="Qty (optional)"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className={NO_SPIN}
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                fillAmount(e.target.value, rate);
              }}
            />
            <Select
              label="Unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              options={['bags', 'trips', 'nos', 'kg', 'Tons', 'cu.m', 'sq.m', 'sq.ft', 'r.m', 'litres', 'hours', 'days', 'heads', 'sheets', 'units'].map((u) => ({ value: u, label: u }))}
            />
            <Input
              label="Rate"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className={NO_SPIN}
              leftIcon={<span className="text-xs font-bold text-slate-500">₹</span>}
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
                fillAmount(qty, e.target.value);
              }}
            />
          </div>
          {parseFloat(qty) > 0 && parseFloat(rate) > 0 && (
            <p className="-mt-1 text-xs text-slate-600">
              {qty} {unit} × {inr(Math.round(parseFloat(rate) * 100))} = <strong className="text-emerald-700">{inr(Math.round(parseFloat(qty) * parseFloat(rate) * 100))}</strong>
              {Math.round(parseFloat(qty) * parseFloat(rate) * 100) !== amountPaise && amountPaise > 0 && (
                <span className="text-amber-700"> · differs from the amount above</span>
              )}
            </p>
          )}

          {linkableExpenses.length > 0 && (
            <Select
              label="Link to a site expense (optional)"
              value={expenseId}
              onChange={(e) => setExpenseId(e.target.value)}
              options={[
                { value: '', label: 'Not linked' },
                ...linkableExpenses.map((exp: any) => ({
                  value: exp._id || exp.id,
                  label: `${inr(exp.amount)} · ${exp.vendor || exp.category} · ${String(exp.description || '').slice(0, 40)}`,
                })),
              ]}
            />
          )}

          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1.5">Bill / invoice (optional)</span>
            {bill ? (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-xs">
                <span className="flex items-center gap-1.5 min-w-0 text-emerald-800 font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="truncate">{bill.name}</span>
                </span>
                <button type="button" aria-label="Remove bill" onClick={() => setBill(null)} className="p-1.5 rounded-lg text-slate-500 hover:bg-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-xl border border-dashed border-slate-300 hover:border-amber-500 hover:bg-amber-50/30 cursor-pointer text-xs font-semibold text-slate-700">
                <Upload className="w-4 h-4 text-slate-400" />
                {uploading ? `Uploading… ${uploading}%` : 'Attach bill photo or PDF'}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onBill} disabled={uploading > 0} />
              </label>
            )}
          </div>

          <Textarea label={isOwner ? 'Note (optional)' : 'Note for the MD (optional)'} rows={2} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />

          {isOwner && (
            <div className="rounded-xl border border-slate-200">
              <label className="flex items-center gap-2.5 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-navy-900"
                  checked={paidAlready}
                  onChange={(e) => setPaidAlready(e.target.checked)}
                />
                <span className="text-sm font-semibold text-navy-950">I have already paid this</span>
              </label>
              {paidAlready && (
                <div className="px-3 pb-3 border-t border-slate-100 pt-3">
                  <PayFields
                    value={payDraft}
                    onChange={setPayDraft}
                    balancePaise={amountPaise}
                    payee={{ name: payeeName || 'payee', vpa: effectiveVpa || undefined }}
                    note={purpose || 'BKR INFRA payment'}
                    disabled={saving}
                  />
                </div>
              )}
            </div>
          )}

          {showErrors && problems.length > 0 && (
            <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5">
              Please fix: {problems.join(', ')}.
            </p>
          )}
        </div>
      </Modal>

      <UPIQRScannerModal isOpen={isQrScannerOpen} onClose={() => setIsQrScannerOpen(false)} onBeneficiaryScanned={handleScanned} />
      <BeneficiaryModal
        isOpen={isBeneficiaryModalOpen}
        onClose={() => setIsBeneficiaryModalOpen(false)}
        initialVpa={scannedVpa}
        initialName={scannedName}
      />
    </>
  );
};
