import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  X,
  Building,
  CreditCard,
  QrCode,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../common/Button.js';
import { useToast } from '../../context/ToastContext.js';
import { PayeeType } from '../../types/index.js';

interface BeneficiaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialVpa?: string;
  initialName?: string;
}

export const BeneficiaryModal: React.FC<BeneficiaryModalProps> = ({
  isOpen,
  onClose,
  initialVpa = '',
  initialName = '',
}) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [payeeType, setPayeeType] = useState<PayeeType>('CONTRACTOR');
  const [name, setName] = useState(initialName);
  const [accountType, setAccountType] = useState<'BANK' | 'UPI'>(initialVpa ? 'UPI' : 'BANK');

  // Bank fields
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');

  // UPI fields
  const [vpa, setVpa] = useState(initialVpa);

  // Optional contact details
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/payments/beneficiaries', data),
    onSuccess: () => {
      showToast('Beneficiary registered successfully', 'success');
      queryClient.invalidateQueries({ queryKey: ['beneficiaries'] });
      onClose();
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to create beneficiary', 'error');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      showToast('Beneficiary name is required', 'error');
      return;
    }

    if (accountType === 'BANK') {
      if (!accountNumber.trim()) {
        showToast('Bank account number is required', 'error');
        return;
      }
      if (accountNumber !== confirmAccountNumber) {
        showToast('Account numbers do not match', 'error');
        return;
      }
      if (!ifsc.trim() || ifsc.trim().length !== 11) {
        showToast('Valid 11-character IFSC code is required', 'error');
        return;
      }

      createMutation.mutate({
        name: name.trim(),
        payeeType,
        accountNumber: accountNumber.trim(),
        ifsc: ifsc.trim().toUpperCase(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
    } else {
      if (!vpa.trim() || !vpa.includes('@')) {
        showToast('Please enter a valid UPI VPA (e.g. name@bank)', 'error');
        return;
      }

      createMutation.mutate({
        name: name.trim(),
        payeeType,
        vpa: vpa.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-navy-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-navy-950">Add Payment Beneficiary</h3>
              <p className="text-[11px] text-slate-500">Contractor, supplier, or labour bank details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {/* Payee Category */}
          <div>
            <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
              Payee Classification *
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['CONTRACTOR', 'SUPPLIER', 'LABOUR'] as PayeeType[]).map((type) => (
                <button
                  type="button"
                  key={type}
                  onClick={() => setPayeeType(type)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-colors ${
                    payeeType === type
                      ? 'bg-navy-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
              Beneficiary Legal Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="As registered with bank / PAN"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-800 focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          {/* Account Type Toggle */}
          <div>
            <label className="block text-xs font-bold text-navy-950 uppercase tracking-wider mb-1.5">
              Account Method *
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAccountType('BANK')}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                  accountType === 'BANK'
                    ? 'bg-amber-500 text-navy-950 shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span>Bank Account (NEFT/RTGS)</span>
              </button>
              <button
                type="button"
                onClick={() => setAccountType('UPI')}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                  accountType === 'UPI'
                    ? 'bg-amber-500 text-navy-950 shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <QrCode className="w-4 h-4" />
                <span>UPI ID / VPA</span>
              </button>
            </div>
          </div>

          {/* Bank Fields */}
          {accountType === 'BANK' ? (
            <div className="space-y-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Bank Account Number *
                </label>
                <input
                  type="password"
                  required
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="Enter account number"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-amber-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Confirm Bank Account Number *
                </label>
                <input
                  type="text"
                  required
                  value={confirmAccountNumber}
                  onChange={(e) => setConfirmAccountNumber(e.target.value)}
                  placeholder="Re-enter account number to verify"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-amber-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Bank IFSC Code *
                </label>
                <input
                  type="text"
                  required
                  maxLength={11}
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  placeholder="e.g. HDFC0001234"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-amber-500 outline-none font-mono uppercase"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  UPI ID (VPA) *
                </label>
                <input
                  type="text"
                  required
                  value={vpa}
                  onChange={(e) => setVpa(e.target.value.toLowerCase())}
                  placeholder="e.g. supplier@okhdfcbank or 9876543210@paytm"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-amber-500 outline-none font-mono"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                UPI payouts are limited to ₹1,00,000 per transaction per NPCI guidelines.
              </p>
            </div>
          )}

          {/* Optional Phone / Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Phone (Optional)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Email (Optional)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="accounts@..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
          </div>

          {/* Security Banner */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span className="text-[11px]">
              Account numbers are encrypted and masked. Bank details will be verified via penny drop.
            </span>
          </div>

          {/* Footer Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={createMutation.isPending}>
              Save Beneficiary
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
