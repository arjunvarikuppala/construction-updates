import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, ShieldCheck, AlertCircle, CheckCircle2, UserCheck } from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../common/Button.js';
import { Input, Select } from '../common/Input.js';
import { PayeeType } from '../../types/index.js';
import { useToast } from '../../context/ToastContext.js';
import { api } from '../../api/client.js';

interface BeneficiaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (beneficiary: any) => void;
}

export const BeneficiaryModal: React.FC<BeneficiaryModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [name, setName] = useState('');
  const [payeeType, setPayeeType] = useState<PayeeType>('CONTRACTOR');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccount, setConfirmAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      return api.post<{ success: boolean; beneficiary: any }>('/payments/beneficiaries', payload);
    },
    onSuccess: (data) => {
      success('Beneficiary registered successfully!');
      queryClient.invalidateQueries({ queryKey: ['beneficiaries'] });
      if (onSuccess) onSuccess(data.beneficiary);
      handleReset();
      onClose();
    },
    onError: (err: any) => {
      toastError(err.message || 'Failed to register beneficiary');
    },
  });

  const handleReset = () => {
    setName('');
    setPayeeType('CONTRACTOR');
    setAccountNumber('');
    setConfirmAccount('');
    setIfsc('');
    setBankName('');
    setPhone('');
    setEmail('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !accountNumber.trim() || !ifsc.trim()) {
      toastError('Please fill in all required fields');
      return;
    }

    const cleanAcc = accountNumber.replace(/\s+/g, '');
    const cleanConfirm = confirmAccount.replace(/\s+/g, '');

    if (cleanAcc !== cleanConfirm) {
      toastError('Bank account numbers do not match');
      return;
    }

    if (!/^\d{8,22}$/.test(cleanAcc)) {
      toastError('Bank account must be between 8 and 22 numeric digits');
      return;
    }

    const cleanIFSC = ifsc.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIFSC)) {
      toastError('Invalid IFSC Code. Standard format: 4 letters, 0, 6 alphanumeric (e.g. HDFC0000240)');
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      payeeType,
      accountNumber: cleanAcc,
      ifsc: cleanIFSC,
      bankName: bankName.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    });
  };

  // IFSC auto-lookup helper
  const handleIfscChange = (val: string) => {
    const formatted = val.toUpperCase().trim();
    setIfsc(formatted);
    if (formatted.length >= 4 && !bankName) {
      const code = formatted.slice(0, 4);
      const bankMap: Record<string, string> = {
        SBIN: 'State Bank of India',
        HDFC: 'HDFC Bank',
        ICIC: 'ICICI Bank',
        UTIB: 'Axis Bank',
        PUNB: 'Punjab National Bank',
        BARB: 'Bank of Baroda',
        KKBK: 'Kotak Mahindra Bank',
        CNRB: 'Canara Bank',
        UBIN: 'Union Bank of India',
        YESB: 'Yes Bank',
        INDB: 'IndusInd Bank',
      };
      if (bankMap[code]) {
        setBankName(bankMap[code]);
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        handleReset();
        onClose();
      }}
      title="Add Contractor, Supplier or Labour Payee"
      description="Register verified bank account details for direct NEFT/RTGS corporate banking payouts."
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Beneficiary Full Name / Legal Entity"
            placeholder="e.g. Sri Lakshmi Earthmovers"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Select
            label="Payee Category"
            value={payeeType}
            onChange={(e) => setPayeeType(e.target.value as PayeeType)}
            options={[
              { value: 'CONTRACTOR', label: 'Contractor (Subcontract / Works)' },
              { value: 'SUPPLIER', label: 'Supplier (Raw Materials / Cement)' },
              { value: 'LABOUR', label: 'Labour (Gang / Direct Wages)' },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Bank Account Number"
            type="password"
            placeholder="Enter numeric account number"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            required
            helperText="8-22 digits. Kept secure and masked."
          />

          <Input
            label="Confirm Account Number"
            type="text"
            placeholder="Re-enter to confirm"
            value={confirmAccount}
            onChange={(e) => setConfirmAccount(e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="IFSC Code (11 characters)"
            placeholder="e.g. SBIN0001234"
            value={ifsc}
            onChange={(e) => handleIfscChange(e.target.value)}
            maxLength={11}
            required
          />

          <Input
            label="Bank Name"
            placeholder="e.g. State Bank of India"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
          <Input
            label="Phone (Optional - for SMS alerts)"
            placeholder="+91 98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <Input
            label="Email (Optional - for remittance advice)"
            type="email"
            placeholder="accounts@vendor.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-xs text-amber-900 space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <ShieldCheck className="w-4 h-4 text-amber-600" />
            <span>Bank Account Security Safeguard</span>
          </div>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            Account numbers are stored securely and presented with last 4 digits visible. Beneficiary accounts undergo automated Penny Drop verification before large transfers can be initiated.
          </p>
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
            variant="primary"
            className="font-bold"
            isLoading={createMutation.isPending}
            leftIcon={<UserCheck className="w-4 h-4 text-amber-400" />}
          >
            Register Payee
          </Button>
        </div>
      </form>
    </Modal>
  );
};
