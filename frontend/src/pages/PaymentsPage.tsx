import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Plus,
  QrCode,
  Users,
  Search,
  Filter,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertCircle,
  Building2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Button } from '../components/common/Button.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { PaymentRequest, Beneficiary, PaymentRequestStatus } from '../types/index.js';
import { formatDate } from '../utils/dates.js';

// Modals
import { PaymentRequestModal } from '../components/payments/PaymentRequestModal.js';
import { PaymentReviewModal } from '../components/payments/PaymentReviewModal.js';
import { UPIQRScannerModal } from '../components/payments/UPIQRScannerModal.js';
import { BeneficiaryModal } from '../components/payments/BeneficiaryModal.js';
import { PaymentQrModal } from '../components/payments/PaymentQrModal.js';

export const PaymentsPage: React.FC = () => {
  const { isOwner, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'requests' | 'beneficiaries'>('requests');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isBeneficiaryModalOpen, setIsBeneficiaryModalOpen] = useState(false);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [isCollectionQrOpen, setIsCollectionQrOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRequest | null>(null);

  // Initial scanned state for add beneficiary
  const [scannedInitialVpa, setScannedInitialVpa] = useState('');
  const [scannedInitialName, setScannedInitialName] = useState('');

  // Fetch Payment Requests
  const { data: paymentsData, isLoading: isLoadingPayments } = useQuery({
    queryKey: ['payment-requests', statusFilter, projectFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (projectFilter !== 'ALL') params.set('project', projectFilter);
      return api.get<{ success: boolean; payments: PaymentRequest[] }>(
        `/payments/requests?${params.toString()}`
      );
    },
    refetchInterval: 15000,
  });
  const payments = paymentsData?.payments || [];

  // Fetch Beneficiaries
  const { data: beneficiariesData, isLoading: isLoadingBeneficiaries } = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: () =>
      api.get<{ success: boolean; beneficiaries: Beneficiary[] }>('/payments/beneficiaries'),
  });
  const beneficiaries = beneficiariesData?.beneficiaries || [];

  // Fetch Projects for filter
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ success: boolean; projects: any[] }>('/projects'),
  });
  const projects = projectsData?.projects || [];

  // Penny Drop Validation Mutation
  const pennyDropMutation = useMutation({
    mutationFn: (beneficiaryId: string) =>
      api.post<{ success: boolean; message: string; verifiedName?: string }>(
        `/payments/beneficiaries/${beneficiaryId}/validate`,
        {}
      ),
    onSuccess: (data: any) => {
      showToast(data.message || 'Beneficiary verified successfully', 'success');
      queryClient.invalidateQueries({ queryKey: ['beneficiaries'] });
    },
    onError: (err: any) => {
      showToast(err.message || 'Penny drop verification failed', 'error');
    },
  });

  // Calculate high-level summary KPIs
  const totalAmountPaise = payments.reduce((sum: number, p: PaymentRequest) => sum + (p.amountPaise || p.amount || 0), 0);
  const pendingAuthPayments = payments.filter((p: PaymentRequest) =>
    ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_AUTHORIZATION'].includes(p.status)
  );
  const pendingAuthAmountPaise = pendingAuthPayments.reduce(
    (sum: number, p: PaymentRequest) => sum + (p.amountPaise || p.amount || 0),
    0
  );
  const processingPayments = payments.filter((p: PaymentRequest) =>
    ['PROCESSING', 'SUBMITTED_TO_PROVIDER'].includes(p.status)
  );
  const paidPayments = payments.filter((p: PaymentRequest) => p.status === 'PAID');
  const paidAmountPaise = paidPayments.reduce((sum: number, p: PaymentRequest) => sum + (p.amountPaise || p.amount || 0), 0);

  // Filter requests based on search
  const filteredPayments = payments.filter((p: PaymentRequest) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const ref = (p.referenceNumber || p.paymentReference || '').toLowerCase();
    const name = (p.beneficiarySnapshot?.name || p.payeeNameSnapshot || '').toLowerCase();
    const purpose = (p.purpose || '').toLowerCase();
    const projCode = (p.projectSnapshot?.code || p.project?.code || '').toLowerCase();
    return ref.includes(q) || name.includes(q) || purpose.includes(q) || projCode.includes(q);
  });

  // Handle scanned QR callback
  const handleBeneficiaryScanned = (scanned: {
    vpa: string;
    payeeName?: string;
    amountInr?: number;
    transactionNote?: string;
  }) => {
    // Check if beneficiary already registered
    const matched = beneficiaries.find(
      (b: Beneficiary) => b.vpa?.toLowerCase() === scanned.vpa.toLowerCase()
    );
    if (matched) {
      setIsRequestModalOpen(true);
      showToast(`Selected beneficiary: ${matched.name}`, 'info');
    } else {
      setScannedInitialVpa(scanned.vpa);
      setScannedInitialName(scanned.payeeName || '');
      setIsBeneficiaryModalOpen(true);
    }
  };

  const getStatusBadge = (status: PaymentRequestStatus) => {
    switch (status) {
      case 'PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3 h-3" /> Paid
          </span>
        );
      case 'AUTHORIZED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-sky-800">
            <ShieldCheck className="w-3 h-3" /> Authorized
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">
            <Clock className="w-3 h-3 animate-spin" /> Processing
          </span>
        );
      case 'AWAITING_AUTHORIZATION':
      case 'UNDER_REVIEW':
      case 'SUBMITTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
            <Clock className="w-3 h-3" /> Needs Review
          </span>
        );
      case 'REJECTED':
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
            <AlertCircle className="w-3 h-3" /> {status}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-navy-900 text-amber-500 flex items-center justify-center font-bold">
              <CreditCard className="w-4 h-4" />
            </div>
            <h1 className="text-2xl font-black text-navy-950 tracking-tight">
              Payments & Financial Transfers
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            NEFT, RTGS, and UPI payouts with RazorpayX bank integration and high-value dual authorization
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Scan Beneficiary QR */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsQrScannerOpen(true)}
            leftIcon={<QrCode className="w-4 h-4 text-amber-600" />}
          >
            Scan UPI QR
          </Button>

          {/* Add Beneficiary */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setScannedInitialVpa('');
              setScannedInitialName('');
              setIsBeneficiaryModalOpen(true);
            }}
            leftIcon={<Users className="w-4 h-4 text-slate-600" />}
          >
            Add Beneficiary
          </Button>

          {/* Dynamic Collection QR (MD only) */}
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCollectionQrOpen(true)}
              leftIcon={<QrCode className="w-4 h-4 text-navy-900" />}
            >
              Collection QR
            </Button>
          )}

          {/* New Payment Request */}
          <Button
            size="sm"
            variant="primary"
            onClick={() => setIsRequestModalOpen(true)}
            leftIcon={<Plus className="w-4 h-4 text-navy-950" />}
          >
            New Payment Request
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Payments */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Total Requests</span>
          <span className="text-xl font-black text-navy-950 mt-1 block">
            ₹{(totalAmountPaise / 100).toLocaleString('en-IN')}
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            {payments.length} requests recorded
          </span>
        </div>

        {/* Pending Authorization */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
          <span className="text-[10px] text-amber-700 uppercase font-bold block">Awaiting Review</span>
          <span className="text-xl font-black text-amber-600 mt-1 block">
            ₹{(pendingAuthAmountPaise / 100).toLocaleString('en-IN')}
          </span>
          <span className="text-[11px] text-amber-800 font-medium">
            {pendingAuthPayments.length} awaiting authorization
          </span>
        </div>

        {/* Processing */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
          <span className="text-[10px] text-indigo-700 uppercase font-bold block">In-Flight Processing</span>
          <span className="text-xl font-black text-indigo-600 mt-1 block">
            {processingPayments.length} Active
          </span>
          <span className="text-[11px] text-indigo-800 font-medium">With provider/bank</span>
        </div>

        {/* Total Paid */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
          <span className="text-[10px] text-emerald-700 uppercase font-bold block">Total Paid Out</span>
          <span className="text-xl font-black text-emerald-600 mt-1 block">
            ₹{(paidAmountPaise / 100).toLocaleString('en-IN')}
          </span>
          <span className="text-[11px] text-emerald-800 font-medium">
            {paidPayments.length} completed transfers
          </span>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('requests')}
          className={`py-3 px-6 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'requests'
              ? 'border-amber-500 text-navy-950 font-black'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Payment Requests ({payments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('beneficiaries')}
          className={`py-3 px-6 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'beneficiaries'
              ? 'border-amber-500 text-navy-950 font-black'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Beneficiaries ({beneficiaries.length})</span>
        </button>
      </div>

      {/* TAB 1: PAYMENT REQUESTS */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by reference, contractor, purpose, project..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 text-xs text-slate-800 focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>

            {/* Status Dropdown */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white text-slate-800 focus:ring-2 focus:ring-amber-500 outline-none"
              >
                <option value="ALL">All Statuses</option>
                <option value="SUBMITTED">Submitted / Needs Review</option>
                <option value="AUTHORIZED">Authorized (Ready to Transfer)</option>
                <option value="PROCESSING">Processing / In-Flight</option>
                <option value="PAID">Paid / Completed</option>
                <option value="REJECTED">Rejected</option>
                <option value="FAILED">Failed</option>
              </select>

              {/* Project Filter */}
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white text-slate-800 focus:ring-2 focus:ring-amber-500 outline-none"
              >
                <option value="ALL">All Projects</option>
                {projects.map((p: any) => (
                  <option key={p._id || p.id} value={p._id || p.id}>
                    [{p.code}] {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* List / Table */}
          {isLoadingPayments ? (
            <LoadingSkeleton rows={4} height="h-20" />
          ) : filteredPayments.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
              <CreditCard className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-navy-950">No payment requests found</p>
              <p className="text-xs text-slate-500">
                Submit a new request or adjust your filter parameters.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase tracking-wider">
                      <th className="py-3 px-4">Ref & Date</th>
                      <th className="py-3 px-4">Project</th>
                      <th className="py-3 px-4">Beneficiary</th>
                      <th className="py-3 px-4">Purpose</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4">Method</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPayments.map((p: PaymentRequest) => {
                      const id = p._id || p.id;
                      const amount = p.amountPaise || p.amount || 0;
                      const isHigh = p.isHighValue || p.requiresHighValueAuth || amount >= 10000000;
                      const ref = p.referenceNumber || p.paymentReference;
                      const payeeName = p.beneficiarySnapshot?.name || p.payeeNameSnapshot;
                      const vpa = p.beneficiarySnapshot?.vpa || p.vpaSnapshot;
                      const acMasked = p.beneficiarySnapshot?.accountNumberMasked || p.accountNumberMaskedSnapshot;
                      const projCode = p.projectSnapshot?.code || p.project?.code;
                      const projName = p.projectSnapshot?.name || p.project?.name;
                      const method = p.preferredMethod || p.paymentMethod;
                      return (
                        <tr
                          key={id}
                          className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                          onClick={() => setSelectedPayment(p)}
                        >
                          <td className="py-3 px-4 font-mono font-bold text-navy-900 whitespace-nowrap">
                            <div>{ref}</div>
                            <span className="text-[10px] text-slate-400 font-normal">
                              {formatDate(p.createdAt, 'dd MMM, hh:mm a')}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="font-mono text-[10px] font-bold text-navy-900 bg-navy-50 border border-navy-200 px-1.5 py-0.5 rounded mr-1">
                              {projCode}
                            </span>
                            <span className="font-semibold text-slate-700">{projName}</span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-navy-950">{payeeName}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {vpa ? `UPI: ${vpa}` : `A/C: ${acMasked}`}
                            </div>
                          </td>
                          <td className="py-3 px-4 max-w-xs truncate text-slate-600 font-medium">
                            {p.purpose}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <span className="font-black text-navy-950 text-sm">
                              ₹{(amount / 100).toLocaleString('en-IN')}
                            </span>
                            {isHigh && (
                              <span className="block text-[9px] font-bold text-amber-700">
                                High-Value
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-bold text-slate-700">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px]">
                              {method}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {getStatusBadge(p.status)}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant={isOwner && ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_AUTHORIZATION'].includes(p.status) ? 'primary' : 'ghost'}
                              onClick={() => setSelectedPayment(p)}
                              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                            >
                              {isOwner && ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_AUTHORIZATION'].includes(p.status)
                                ? 'Review'
                                : 'Details'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: BENEFICIARIES */}
      {activeTab === 'beneficiaries' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
            <div>
              <h3 className="text-sm font-bold text-navy-950">Registered Beneficiaries</h3>
              <p className="text-xs text-slate-500">
                Validated bank accounts & UPI VPAs for contractor, supplier, and labour payouts
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setScannedInitialVpa('');
                setScannedInitialName('');
                setIsBeneficiaryModalOpen(true);
              }}
              leftIcon={<Plus className="w-4 h-4 text-navy-950" />}
            >
              Add Beneficiary
            </Button>
          </div>

          {isLoadingBeneficiaries ? (
            <LoadingSkeleton rows={3} height="h-20" />
          ) : beneficiaries.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
              <Users className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-navy-950">No beneficiaries registered yet</p>
              <p className="text-xs text-slate-500">
                Click "Add Beneficiary" or scan a contractor's UPI QR code to get started.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {beneficiaries.map((b: Beneficiary) => {
                const id = b._id || b.id;
                return (
                  <div
                    key={id}
                    className="p-4 rounded-2xl bg-white border border-slate-200 shadow-card hover:shadow-card-hover transition-all space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-navy-100 text-navy-800 uppercase">
                          {b.payeeType}
                        </span>
                        <h4 className="text-sm font-black text-navy-950 mt-1 truncate">{b.name}</h4>
                      </div>
                      <div>
                        {b.verificationStatus === 'VERIFIED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            <Clock className="w-3 h-3" /> Unverified
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Account Details */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs font-mono text-slate-700 space-y-1">
                      {b.vpa ? (
                        <div>
                          <span className="text-[10px] text-slate-400 block font-sans uppercase font-bold">UPI ID</span>
                          <span className="font-bold text-navy-900 break-all">{b.vpa}</span>
                        </div>
                      ) : (
                        <>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-sans uppercase font-bold">Account</span>
                            <span className="font-bold text-navy-900">{b.accountNumberMasked}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block font-sans uppercase font-bold">IFSC</span>
                            <span className="font-bold text-navy-900">{b.ifsc}</span>
                          </div>
                          {b.bankName && (
                            <div className="text-[10px] text-slate-500 font-sans">{b.bankName}</div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Penny Drop Verification Button if unverified */}
                    {b.verificationStatus !== 'VERIFIED' && isOwner && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs"
                        onClick={() => pennyDropMutation.mutate(id || '')}
                        isLoading={pennyDropMutation.isPending}
                        leftIcon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />}
                      >
                        Run Penny Drop Verification
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODALS */}
      {/* Payment Request Creation Modal */}
      <PaymentRequestModal
        isOpen={isRequestModalOpen}
        onClose={() => setIsRequestModalOpen(false)}
      />

      {/* Payment Review / Authorize Modal */}
      <PaymentReviewModal
        isOpen={Boolean(selectedPayment)}
        payment={selectedPayment}
        onClose={() => setSelectedPayment(null)}
      />

      {/* UPI QR Scanner Modal */}
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

      {/* Dynamic Collection QR Modal */}
      <PaymentQrModal
        isOpen={isCollectionQrOpen}
        onClose={() => setIsCollectionQrOpen(false)}
      />
    </div>
  );
};
