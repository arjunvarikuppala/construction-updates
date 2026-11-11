import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Plus,
  QrCode,
  Users,
  Search,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Download,
  Wallet,
  UserRound,
  Store,
  ArrowRight,
} from 'lucide-react';
import { api, API_ORIGIN } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Button } from '../components/common/Button.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import type { Beneficiary, PaymentDashboardSummary, PaymentRequest, PaymentSummary } from '../types/index.js';
import { formatDate, localMonthString } from '../utils/dates.js';
import { STATUS_META, balancePaiseOf, idOf, inr, isPayable, paidPaiseOf, payeeKindOf } from '../utils/payments.js';

import { PaymentRequestModal } from '../components/payments/PaymentRequestModal.js';
import { PaymentReviewModal } from '../components/payments/PaymentReviewModal.js';
import { PayModal } from '../components/payments/PayModal.js';
import { UPIQRScannerModal } from '../components/payments/UPIQRScannerModal.js';
import { BeneficiaryModal } from '../components/payments/BeneficiaryModal.js';

type View = 'TO_PAY' | 'PART' | 'PAID' | 'CLOSED' | 'ALL';

const VIEWS: { id: View; label: string; match: (p: PaymentRequest) => boolean }[] = [
  { id: 'TO_PAY', label: 'To pay', match: (p) => (isPayable(p) && p.status !== 'PARTIALLY_PAID') || p.status === 'PROCESSING' },
  { id: 'PART', label: 'Part paid', match: (p) => p.status === 'PARTIALLY_PAID' },
  { id: 'PAID', label: 'Paid', match: (p) => p.status === 'PAID' },
  { id: 'CLOSED', label: 'Rejected / cancelled', match: (p) => ['REJECTED', 'CANCELLED', 'FAILED', 'REVERSED'].includes(p.status) },
  { id: 'ALL', label: 'All', match: () => true },
];

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const meta = STATUS_META[status] || { label: status, tone: 'bg-slate-100 text-slate-700' };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${meta.tone}`}>{meta.label}</span>;
};

export const PaymentsPage: React.FC = () => {
  const { isOwner } = useAuth();
  const { showToast, error: toastError } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<'requests' | 'beneficiaries'>('requests');
  const [view, setView] = useState<View>('TO_PAY');
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [month, setMonth] = useState(localMonthString());
  const [downloading, setDownloading] = useState(false);

  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isBeneficiaryModalOpen, setIsBeneficiaryModalOpen] = useState(false);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRequest | null>(null);
  const [quickPay, setQuickPay] = useState<PaymentRequest | null>(null);
  const [scannedInitialVpa, setScannedInitialVpa] = useState('');
  const [scannedInitialName, setScannedInitialName] = useState('');

  const { data: paymentsData, isLoading: isLoadingPayments } = useQuery({
    queryKey: ['payment-requests', projectFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (projectFilter !== 'ALL') params.set('projectId', projectFilter);
      return api.get<{ payments: PaymentRequest[]; summary: PaymentSummary }>(`/payments/requests?${params.toString()}`);
    },
    refetchInterval: 20000,
  });
  const payments = paymentsData?.payments || [];
  const payoutsEnabled = Boolean(paymentsData?.summary?.payoutsEnabled);

  const { data: summaryData } = useQuery({
    queryKey: ['payment-summary', month],
    queryFn: () => api.get<{ summary: PaymentDashboardSummary; month: string }>(`/payments/summary?month=${month}`),
    refetchInterval: 30000,
  });
  const summary = summaryData?.summary;

  const { data: beneficiariesData, isLoading: isLoadingBeneficiaries } = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: () => api.get<{ beneficiaries: Beneficiary[] }>('/payments/beneficiaries'),
  });
  const beneficiaries = beneficiariesData?.beneficiaries || [];

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: any[] }>('/projects'),
  });
  const projects = projectsData?.projects || [];

  // Open a request straight from a notification link (?id=...)
  const linkedId = searchParams.get('id') || searchParams.get('paymentId');
  useEffect(() => {
    if (!linkedId || !payments.length) return;
    const found = payments.find((p) => p._id === linkedId);
    if (found) {
      setSelectedPayment(found);
      searchParams.delete('id');
      searchParams.delete('paymentId');
      setSearchParams(searchParams, { replace: true });
    }
  }, [linkedId, payments]); // eslint-disable-line react-hooks/exhaustive-deps

  const pennyDropMutation = useMutation({
    mutationFn: (beneficiaryId: string) => api.post<{ message: string }>(`/payments/beneficiaries/${beneficiaryId}/validate`, {}),
    onSuccess: (data: any) => {
      showToast(data.message || 'Bank account verified', 'success');
      queryClient.invalidateQueries({ queryKey: ['beneficiaries'] });
    },
    onError: (err: any) => showToast(err.message || 'Verification failed', 'error'),
  });

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.id, payments.filter(v.match).length])) as Record<View, number>, [payments]);

  const visible = useMemo(() => {
    const matcher = VIEWS.find((v) => v.id === view)!.match;
    const q = searchQuery.trim().toLowerCase();
    return payments.filter((p) => {
      if (!matcher(p)) return false;
      if (!q) return true;
      const hay = [
        p.paymentReference,
        p.payeeNameSnapshot,
        p.purpose,
        p.project?.code,
        p.project?.name,
        ...(p.settlements || []).map((s) => s.reference || ''),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [payments, view, searchQuery]);

  const handleBeneficiaryScanned = (scanned: { vpa: string; payeeName?: string }) => {
    const matched = beneficiaries.find((b) => b.vpa?.toLowerCase() === scanned.vpa.toLowerCase());
    if (matched) {
      showToast(`${matched.name} is already saved`, 'info');
      setIsRequestModalOpen(true);
    } else {
      setScannedInitialVpa(scanned.vpa);
      setScannedInitialName(scanned.payeeName || '');
      setIsBeneficiaryModalOpen(true);
    }
  };

  const downloadRegister = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_ORIGIN}/api/v1/payments/register?month=${month}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('sitetrack_token') || ''}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Download failed');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `BKR-INFRA-Payments-${month}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toastError(err.message || 'Could not download the payments register');
    } finally {
      setDownloading(false);
    }
  };

  const monthLabel = formatDate(`${month}-01`, 'MMM yyyy');
  const kpis = isOwner
    ? [
        { label: 'Waiting for payment', value: inr(summary?.awaitingPaise || 0), sub: `${summary?.awaitingCount || 0} request(s)`, tone: 'text-amber-600' },
        { label: 'Part-paid balance', value: inr(summary?.partialBalancePaise || 0), sub: `${summary?.partialCount || 0} request(s)`, tone: 'text-violet-600' },
        { label: `Paid in ${monthLabel}`, value: inr(summary?.paidThisMonthPaise || 0), sub: `In-Charges ${inr(summary?.paidToInChargesPaise || 0)} · Vendors ${inr(summary?.paidToVendorsPaise || 0)}`, tone: 'text-emerald-600' },
        { label: 'Due within 7 days', value: String(summary?.dueThisWeekCount || 0), sub: `${summary?.unconfirmedReceipts || 0} receipt(s) not confirmed`, tone: 'text-rose-600' },
      ]
    : [
        { label: 'Waiting for MD', value: inr(summary?.awaitingPaise || 0), sub: `${summary?.awaitingCount || 0} request(s)`, tone: 'text-amber-600' },
        { label: 'Balance still due', value: inr(summary?.partialBalancePaise || 0), sub: `${summary?.partialCount || 0} part paid`, tone: 'text-violet-600' },
        { label: `Paid in ${monthLabel}`, value: inr(summary?.paidThisMonthPaise || 0), sub: 'On your sites', tone: 'text-emerald-600' },
        { label: 'To confirm', value: String(summary?.unconfirmedReceipts || 0), sub: 'Tap “I received it” on paid items', tone: 'text-rose-600' },
      ];

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-navy-900 text-brand-400 flex items-center justify-center shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-navy-950 tracking-tight">Payments</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {isOwner
              ? payoutsEnabled
                ? 'Site In-Charges request money; you approve by paying — send it straight from RazorpayX, or record a payment made from your UPI app, bank, cheque or cash.'
                : 'Site In-Charges request money; you approve by paying from your UPI app, bank, cheque or cash and record it here.'
              : 'Ask the MD to pay you or a vendor. You are notified as soon as it is paid.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 [&>button]:flex-1 [&>button]:sm:flex-initial">
          <Button size="sm" variant="outline" onClick={() => setIsQrScannerOpen(true)} leftIcon={<QrCode className="w-4 h-4 text-brand-600" />}>
            Scan vendor UPI QR
          </Button>
          <Button size="sm" onClick={() => setIsRequestModalOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
            {isOwner ? 'New payment' : 'Request payment'}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-card min-w-0">
            <span className="text-[10px] text-slate-500 uppercase font-bold block truncate">{k.label}</span>
            <span className={`text-lg sm:text-xl font-black mt-1 block truncate ${k.tone}`}>{k.value}</span>
            <span className="text-[11px] text-slate-500 block truncate" title={k.sub}>
              {k.sub}
            </span>
          </div>
        ))}
      </div>

      {/* Site breakdown + register (MD) */}
      {isOwner && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-card p-4 min-w-0">
            <h3 className="text-sm font-bold text-navy-950 mb-2">By site — {monthLabel}</h3>
            {summary?.bySite?.length ? (
              <ul className="divide-y divide-slate-100 text-xs">
                {summary.bySite.slice(0, 6).map((s) => (
                  <li key={s.project?._id || 'none'} className="py-2 flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold text-navy-950">
                      <span className="font-mono text-[10px] bg-navy-50 border border-navy-200 text-navy-900 px-1.5 py-0.5 rounded mr-1.5">{s.project?.code || '—'}</span>
                      {s.project?.name}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="text-emerald-700 font-bold">{inr(s.paidPaise)} paid</span>
                      {s.duePaise > 0 && <span className="text-amber-700 font-semibold"> · {inr(s.duePaise)} due</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">No payments yet this month.</p>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-4 space-y-2.5">
            <h3 className="text-sm font-bold text-navy-950">Payments register</h3>
            <p className="text-[11px] text-slate-500">Every payment of the month with UTR / cheque no. — Excel for your accountant.</p>
            <input
              type="month"
              aria-label="Month"
              value={month}
              max={localMonthString()}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-navy-500 outline-none"
            />
            <Button size="sm" variant="outline" className="w-full" onClick={downloadRegister} isLoading={downloading} leftIcon={<Download className="w-4 h-4" />}>
              Download Excel
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="-mx-3 px-3 sm:mx-0 sm:px-0 flex border-b border-slate-200 overflow-x-auto scrollbar-none">
        {[
          { id: 'requests' as const, icon: CreditCard, label: `Payments (${payments.length})` },
          { id: 'beneficiaries' as const, icon: Users, label: `Vendors (${beneficiaries.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`py-2.5 px-4 sm:px-6 text-xs font-bold border-b-2 whitespace-nowrap flex items-center gap-2 shrink-0 ${
              activeTab === t.id ? 'border-brand-600 text-navy-950' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'requests' && (
        <div className="space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0" role="tablist" aria-label="Payment status">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={view === v.id}
                  onClick={() => setView(v.id)}
                  className={`shrink-0 min-h-[36px] px-3 rounded-full text-xs font-bold border transition ${
                    view === v.id ? 'bg-navy-900 border-navy-900 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {v.label} <span className={view === v.id ? 'text-brand-300' : 'text-slate-400'}>{counts[v.id]}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 lg:ml-auto">
              <div className="relative sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search payments"
                  placeholder="Search name, purpose, UTR…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs bg-white focus:ring-2 focus:ring-navy-500 outline-none"
                />
              </div>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                aria-label="Filter by site"
                className="sm:max-w-[220px] truncate px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white focus:ring-2 focus:ring-navy-500 outline-none"
              >
                <option value="ALL">All sites</option>
                {projects.map((p: any) => (
                  <option key={p._id || p.id} value={p._id || p.id}>
                    {p.code} – {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isLoadingPayments ? (
            <LoadingSkeleton rows={4} height="h-20" />
          ) : visible.length === 0 ? (
            <div className="p-10 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
              <Wallet className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-navy-950">{view === 'TO_PAY' ? 'Nothing waiting to be paid' : 'No payments here'}</p>
              <p className="text-xs text-slate-500">
                {isOwner ? 'New requests from your Site In-Charges appear under “To pay”.' : 'Use “Request payment” to ask the MD to pay you or a vendor.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {visible.map((p) => {
                const paid = paidPaiseOf(p);
                const balance = balancePaiseOf(p);
                const pct = p.amount ? Math.min(100, Math.round((paid / p.amount) * 100)) : 0;
                const kind = payeeKindOf(p);
                const unconfirmed = kind === 'INCHARGE' && (p.settlements || []).some((s) => !s.voided && !s.receivedConfirmedAt);
                return (
                  <li key={p._id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedPayment(p)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSelectedPayment(p))}
                      className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-card hover:shadow-card-hover hover:border-slate-300 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-navy-500"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${kind === 'INCHARGE' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                          {kind === 'INCHARGE' ? <UserRound className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-bold text-navy-950 text-sm truncate max-w-full">{p.payeeNameSnapshot}</span>
                            <StatusBadge status={p.status} />
                            {unconfirmed && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700">
                                <Clock className="w-3 h-3" /> receipt not confirmed
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 truncate mt-0.5">{p.purpose}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            <span className="font-mono">{p.project?.code}</span> · {formatDate(p.createdAt, 'dd MMM, hh:mm a')}
                            {p.requestedPaymentDate && isPayable(p) && <> · needed by {formatDate(p.requestedPaymentDate, 'dd MMM')}</>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="block text-base sm:text-lg font-black text-navy-950">{inr(p.amount)}</span>
                          {paid > 0 && balance > 0 && <span className="block text-[11px] font-semibold text-violet-700">{inr(balance)} due</span>}
                        </div>
                      </div>
                      {paid > 0 && (
                        <div className="mt-2.5 h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
                          <div className={`h-full rounded-full ${balance ? 'bg-violet-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      {isOwner && isPayable(p) && (
                        <div className="mt-3 flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" onClick={() => setSelectedPayment(p)} rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                            Details
                          </Button>
                          <Button size="sm" onClick={() => setQuickPay(p)} leftIcon={<Wallet className="w-3.5 h-3.5" />}>
                            {paid > 0 ? 'Pay balance' : 'Approve & pay'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'beneficiaries' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
            <div>
              <h3 className="text-sm font-bold text-navy-950">Saved vendors</h3>
              <p className="text-xs text-slate-500">Contractors, suppliers and labour with their UPI ID or bank account</p>
            </div>
            <Button
              size="sm"
              className="w-full sm:w-auto shrink-0"
              onClick={() => {
                setScannedInitialVpa('');
                setScannedInitialName('');
                setIsBeneficiaryModalOpen(true);
              }}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Add vendor
            </Button>
          </div>

          {isLoadingBeneficiaries ? (
            <LoadingSkeleton rows={3} height="h-20" />
          ) : beneficiaries.length === 0 ? (
            <div className="p-10 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
              <Users className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-navy-950">No vendors saved yet</p>
              <p className="text-xs text-slate-500">Add one, or scan their UPI QR code.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {beneficiaries.map((b) => {
                const id = b._id || b.id || '';
                const vendorPayments = payments.filter((p) => idOf(p.beneficiary) === id);
                const vendorPaid = vendorPayments.reduce((s, p) => s + paidPaiseOf(p), 0);
                const vendorDue = vendorPayments.filter(isPayable).reduce((s, p) => s + balancePaiseOf(p), 0);
                return (
                  <div key={id} className="p-4 rounded-2xl bg-white border border-slate-200 shadow-card space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-navy-100 text-navy-800 uppercase">{b.payeeType}</span>
                        <h4 className="text-sm font-black text-navy-950 mt-1 truncate">{b.name}</h4>
                      </div>
                      {b.verificationStatus === 'VERIFIED' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3" /> Verified
                        </span>
                      )}
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs font-mono text-slate-700 space-y-0.5 break-all">
                      {b.vpa && <div>UPI {b.vpa}</div>}
                      {b.accountNumberMasked && (
                        <div>
                          A/C {b.accountNumberMasked} · {b.ifsc}
                        </div>
                      )}
                      {!b.vpa && !b.accountNumberMasked && <div className="font-sans text-slate-500">No UPI / bank saved</div>}
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-emerald-700 font-semibold">Paid {inr(vendorPaid)}</span>
                      <span className={vendorDue ? 'text-amber-700 font-semibold' : 'text-slate-400'}>Due {inr(vendorDue)}</span>
                    </div>
                    {isOwner && payoutsEnabled && b.verificationStatus !== 'VERIFIED' && b.accountNumberMasked && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs"
                        onClick={() => pennyDropMutation.mutate(id)}
                        isLoading={pennyDropMutation.isPending}
                        leftIcon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />}
                      >
                        Verify bank account (₹1 test)
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <PaymentRequestModal isOpen={isRequestModalOpen} onClose={() => setIsRequestModalOpen(false)} />
      <PaymentReviewModal
        isOpen={Boolean(selectedPayment)}
        payment={selectedPayment}
        onClose={() => setSelectedPayment(null)}
        payoutsEnabled={payoutsEnabled}
      />
      <PayModal payment={quickPay} isOpen={Boolean(quickPay)} onClose={() => setQuickPay(null)} />
      <UPIQRScannerModal isOpen={isQrScannerOpen} onClose={() => setIsQrScannerOpen(false)} onBeneficiaryScanned={handleBeneficiaryScanned} />
      <BeneficiaryModal
        isOpen={isBeneficiaryModalOpen}
        onClose={() => setIsBeneficiaryModalOpen(false)}
        initialVpa={scannedInitialVpa}
        initialName={scannedInitialName}
      />
    </div>
  );
};
