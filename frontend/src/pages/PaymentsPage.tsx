import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Building2,
  UserCheck,
  Send,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  FileText,
  DollarSign,
  Lock,
  Layers,
  Banknote,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { Input, Select } from '../components/common/Input.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { BeneficiaryModal } from '../components/payments/BeneficiaryModal.js';
import { PaymentRequestModal } from '../components/payments/PaymentRequestModal.js';
import { PaymentReviewModal } from '../components/payments/PaymentReviewModal.js';
import { PaymentRequest, Beneficiary, PaymentSummary } from '../types/index.js';
import { formatCompactINR, formatINR } from '../utils/currency.js';
import { formatDate } from '../utils/dates.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { api } from '../api/client.js';

export const PaymentsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { isMD } = useAuth();
  const { success, error: toastError } = useToast();

  const [activeTab, setActiveTab] = useState<'requests' | 'beneficiaries'>('requests');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [payeeTypeFilter, setPayeeTypeFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');

  // Modals state
  const [isAddBeneficiaryOpen, setIsAddBeneficiaryOpen] = useState(false);
  const [isNewPaymentOpen, setIsNewPaymentOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRequest | null>(null);

  // Fetch Payment Requests & Summary
  const { data: paymentsData, isLoading: isPaymentsLoading, refetch: refetchPayments } = useQuery({
    queryKey: ['payment-requests', statusFilter, payeeTypeFilter, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (payeeTypeFilter !== 'ALL') params.set('payeeType', payeeTypeFilter);
      if (search) params.set('search', search);
      return api.get<{ payments: PaymentRequest[]; summary: PaymentSummary }>(
        `/payments/requests?${params.toString()}`
      );
    },
    refetchInterval: 15000,
  });

  // Fetch Beneficiaries
  const { data: beneficiariesData, isLoading: isBeneficiariesLoading, refetch: refetchBeneficiaries } = useQuery({
    queryKey: ['beneficiaries', payeeTypeFilter, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (payeeTypeFilter !== 'ALL') params.set('payeeType', payeeTypeFilter);
      if (search) params.set('search', search);
      return api.get<{ count: number; beneficiaries: Beneficiary[] }>(
        `/payments/beneficiaries?${params.toString()}`
      );
    },
  });

  // Penny-drop Account Validation Mutation
  const validateMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.post(`/payments/beneficiaries/${id}/validate`, {});
    },
    onSuccess: (res: any) => {
      success(res.message || 'Account validated successfully!');
      queryClient.invalidateQueries({ queryKey: ['beneficiaries'] });
    },
    onError: (err: any) => {
      toastError(err.message || 'Validation failed');
    },
  });

  const payments = paymentsData?.payments || [];
  const summary = paymentsData?.summary || {
    totalDisbursedPaise: 0,
    awaitingAuthCount: 0,
    awaitingAuthPaise: 0,
    processingPaise: 0,
    highValueThresholdPaise: 10000000,
  };

  const beneficiaries = beneficiariesData?.beneficiaries || [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">
              Contractor, Supplier & Labour Payouts
            </h1>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
              RazorpayX Payouts Engine
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              NEFT / RTGS
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Disburse approved funds to verified vendor bank accounts with high-value authorization controls.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setIsAddBeneficiaryOpen(true)}
            leftIcon={<UserCheck className="w-4 h-4 text-navy-900" />}
          >
            Add Payee
          </Button>

          <Button
            variant="amber"
            onClick={() => setIsNewPaymentOpen(true)}
            leftIcon={<Plus className="w-4 h-4 text-navy-950" />}
            className="font-bold"
          >
            New Payment Request
          </Button>
        </div>
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Total Disbursed
          </span>
          <span className="text-xl sm:text-2xl font-extrabold text-navy-950 block mt-1 font-mono">
            {formatCompactINR(summary.totalDisbursedPaise)}
          </span>
          <span className="text-[11px] text-slate-500 mt-0.5 block">
            {formatINR(summary.totalDisbursedPaise)} settled
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-amber-300 shadow-card bg-amber-50/30">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider block">
              High-Value Approvals
            </span>
            {summary.awaitingAuthCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            )}
          </div>
          <span className="text-xl sm:text-2xl font-extrabold text-amber-700 block mt-1 font-mono">
            {summary.awaitingAuthCount}
          </span>
          <span className="text-[11px] text-amber-800 mt-0.5 block font-medium">
            {formatCompactINR(summary.awaitingAuthPaise)} awaiting MD authorization
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-sky-200 shadow-card bg-sky-50/20">
          <span className="text-[11px] font-bold text-sky-800 uppercase tracking-wider block">
            In-Flight Transfers
          </span>
          <span className="text-xl sm:text-2xl font-extrabold text-sky-700 block mt-1 font-mono">
            {formatCompactINR(summary.processingPaise)}
          </span>
          <span className="text-[11px] text-sky-600 mt-0.5 block">Processing in RBI cycle</span>
        </div>

        <div className="bg-navy-950 text-white p-4 rounded-2xl border border-navy-900 shadow-card flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">
              Gateway Safety Mode
            </span>
            <span className="text-sm font-bold block mt-1">Corporate Sandbox / Safe</span>
          </div>
          <span className="text-[11px] text-navy-300 block">
            Live transfers safeguarded until onboarding
          </span>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-colors ${
              activeTab === 'requests'
                ? 'bg-navy-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
            }`}
          >
            Payment Requests ({payments.length})
          </button>

          <button
            onClick={() => setActiveTab('beneficiaries')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'beneficiaries'
                ? 'bg-navy-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Verified Payees ({beneficiaries.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (activeTab === 'requests') refetchPayments();
              else refetchBeneficiaries();
            }}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-card flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
          <input
            type="text"
            placeholder={activeTab === 'requests' ? 'Search by reference, payee, UTR...' : 'Search payee, IFSC, bank...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-navy-900"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
          {activeTab === 'requests' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs rounded-xl border border-slate-200 px-3 py-1.5 bg-slate-50 text-slate-700 font-medium focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="AWAITING_AUTHORIZATION">Awaiting Authorization</option>
              <option value="AUTHORIZED">Authorized</option>
              <option value="DRAFT">Draft</option>
              <option value="PROCESSING">Processing / Submitted</option>
              <option value="PAID">Paid / Settled</option>
              <option value="REVERSED">Reversed</option>
              <option value="FAILED">Failed</option>
            </select>
          )}

          <select
            value={payeeTypeFilter}
            onChange={(e) => setPayeeTypeFilter(e.target.value)}
            className="text-xs rounded-xl border border-slate-200 px-3 py-1.5 bg-slate-50 text-slate-700 font-medium focus:outline-none"
          >
            <option value="ALL">All Payee Types</option>
            <option value="CONTRACTOR">Contractor</option>
            <option value="SUPPLIER">Supplier</option>
            <option value="LABOUR">Labour</option>
          </select>
        </div>
      </div>

      {/* TAB 1: Payment Requests List */}
      {activeTab === 'requests' && (
        <>
          {isPaymentsLoading ? (
            <LoadingSkeleton rows={4} height="h-20" />
          ) : payments.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-12 text-center shadow-card space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
                <Banknote className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-navy-950">No Payment Requests Found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No payment requests match the current filters. Create a new payout request linked to a project and approved expense.
              </p>
              <Button
                variant="amber"
                onClick={() => setIsNewPaymentOpen(true)}
                leftIcon={<Plus className="w-4 h-4" />}
                className="font-bold text-xs"
              >
                Create Payment Request
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {payments.map((req) => (
                <div
                  key={req._id || req.id}
                  onClick={() => setSelectedPayment(req)}
                  className="bg-white p-4 rounded-2xl border border-slate-200/90 hover:border-navy-400 hover:shadow-card transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                >
                  {/* Left: Info */}
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-navy-950 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {req.paymentReference}
                      </span>

                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          req.status === 'PAID'
                            ? 'bg-emerald-100 text-emerald-800'
                            : req.status === 'AUTHORIZED'
                            ? 'bg-blue-100 text-blue-800 border border-blue-300 font-extrabold'
                            : req.status === 'AWAITING_AUTHORIZATION'
                            ? 'bg-amber-100 text-amber-900 border border-amber-300 font-extrabold'
                            : req.status === 'PROCESSING' || req.status === 'SUBMITTED'
                            ? 'bg-sky-100 text-sky-800'
                            : req.status === 'REVERSED'
                            ? 'bg-purple-100 text-purple-800 border border-purple-300 font-extrabold'
                            : req.status === 'FAILED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {req.status === 'AWAITING_AUTHORIZATION'
                          ? '⚠️ Awaiting Authorization'
                          : req.status === 'AUTHORIZED'
                          ? '✓ Authorized'
                          : req.status.replace(/_/g, ' ')}
                      </span>

                      <span className="text-[10px] font-semibold bg-navy-50 text-navy-900 px-2 py-0.5 rounded border border-navy-100">
                        {req.paymentMethod}
                      </span>

                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                          req.providerName === 'RAZORPAYX' || !req.providerName
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        {req.providerName === 'RAZORPAYX' || !req.providerName
                          ? 'RazorpayX'
                          : `Legacy (${req.providerName})`}
                      </span>

                      <span className="text-xs text-slate-500">
                        {req.project?.code} - {req.project?.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-navy-950 group-hover:text-amber-800 transition-colors">
                        {req.payeeNameSnapshot}
                      </h4>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-600">
                        {req.bankNameSnapshot} [{req.accountNumberMaskedSnapshot}]
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 line-clamp-1">{req.purpose}</p>
                  </div>

                  {/* Right: Amount & Action */}
                  <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center border-t md:border-t-0 pt-2 md:pt-0 border-slate-100 gap-1 flex-shrink-0">
                    <span className="text-base sm:text-lg font-black text-navy-950 font-mono">
                      {formatINR(req.amount)}
                    </span>
                    <div className="flex items-center gap-1 text-xs font-semibold text-navy-900 group-hover:text-amber-600 transition-colors">
                      <span>Review Details</span>
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* TAB 2: Verified Payees (Beneficiaries) */}
      {activeTab === 'beneficiaries' && (
        <>
          {isBeneficiariesLoading ? (
            <LoadingSkeleton rows={3} height="h-32" />
          ) : beneficiaries.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-12 text-center shadow-card space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
                <UserCheck className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-navy-950">No Beneficiary Payees Registered</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Register bank accounts for contractors, materials suppliers, and labour gangs to facilitate direct electronic bank payouts.
              </p>
              <Button
                variant="amber"
                onClick={() => setIsAddBeneficiaryOpen(true)}
                leftIcon={<Plus className="w-4 h-4" />}
                className="font-bold text-xs"
              >
                Add First Payee
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {beneficiaries.map((b) => (
                <Card key={b._id || b.id} className="p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-navy-950 text-sm line-clamp-1">{b.name}</h4>
                        <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-block mt-0.5">
                          {b.payeeType}
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                          b.verificationStatus === 'VERIFIED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : b.verificationStatus === 'FAILED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {b.verificationStatus === 'VERIFIED' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Verified
                          </>
                        ) : b.verificationStatus === 'FAILED' ? (
                          <>
                            <XCircle className="w-3 h-3 text-rose-600" /> Failed
                          </>
                        ) : (
                          'Unverified'
                        )}
                      </span>
                    </div>

                    <div className="text-xs space-y-1 pt-2 border-t border-slate-100">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Bank:</span>
                        <span className="font-semibold text-slate-800">{b.bankName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Account:</span>
                        <span className="font-mono font-bold text-navy-950">{b.accountNumberMasked}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">IFSC:</span>
                        <span className="font-mono font-semibold text-slate-800">{b.ifsc}</span>
                      </div>
                      {b.verifiedName && (
                        <div className="flex justify-between pt-1 border-t border-slate-100">
                          <span className="text-slate-400">Registered Name:</span>
                          <span className="font-semibold text-emerald-700 truncate ml-2">
                            {b.verifiedName}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    {b.verificationStatus !== 'VERIFIED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => validateMutation.mutate(b._id || b.id!)}
                        isLoading={validateMutation.isPending}
                        leftIcon={<ShieldCheck className="w-3.5 h-3.5 text-amber-600" />}
                        className="text-xs py-1 px-2.5 h-7"
                      >
                        Verify Bank Account
                      </Button>
                    ) : (
                      <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Penny Drop Active
                      </span>
                    )}

                    <Button
                      size="sm"
                      variant="amber"
                      onClick={() => setIsNewPaymentOpen(true)}
                      leftIcon={<Send className="w-3.5 h-3.5 text-navy-950" />}
                      className="text-xs py-1 px-2.5 h-7 font-bold"
                    >
                      Pay
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <BeneficiaryModal
        isOpen={isAddBeneficiaryOpen}
        onClose={() => setIsAddBeneficiaryOpen(false)}
      />

      <PaymentRequestModal
        isOpen={isNewPaymentOpen}
        onClose={() => setIsNewPaymentOpen(false)}
        onOpenAddBeneficiary={() => {
          setIsNewPaymentOpen(false);
          setIsAddBeneficiaryOpen(true);
        }}
      />

      <PaymentReviewModal
        payment={selectedPayment}
        isOpen={Boolean(selectedPayment)}
        onClose={() => setSelectedPayment(null)}
      />
    </div>
  );
};
