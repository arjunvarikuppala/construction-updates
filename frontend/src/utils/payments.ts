/**
 * Payment helpers for BKR INFRA: the MD approves a request by paying it from
 * their own UPI app / bank / cheque / cash and records it here.
 */
import type { PaymentRequest, PaymentRequestStatus, SettlementMode } from '../types/index.js';

export const MODE_OPTIONS: { value: Exclude<SettlementMode, 'RAZORPAYX'>; label: string; refLabel: string; refHint: string }[] = [
  { value: 'UPI', label: 'UPI', refLabel: 'UPI reference (UTR)', refHint: '12-digit number on the payment receipt in GPay / PhonePe / Paytm' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer', refLabel: 'UTR / transaction ref', refHint: 'From your net-banking receipt (NEFT / IMPS / RTGS)' },
  { value: 'CHEQUE', label: 'Cheque', refLabel: 'Cheque number', refHint: 'The 6-digit number on the cheque leaf' },
  { value: 'CASH', label: 'Cash', refLabel: '', refHint: '' },
];

export const MODE_LABEL: Record<SettlementMode, string> = {
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  CASH: 'Cash',
  RAZORPAYX: 'RazorpayX payout',
};

/** Statuses the MD can still pay against */
export const PAYABLE_STATUSES: PaymentRequestStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'AWAITING_AUTHORIZATION',
  'AUTHORIZED',
  'PARTIALLY_PAID',
];

export const isPayable = (p: Pick<PaymentRequest, 'status'>) => PAYABLE_STATUSES.includes(p.status);

// Requests marked PAID before part payments existed carry no entries: treat them as paid in full
export const paidPaiseOf = (p: Pick<PaymentRequest, 'paidPaise' | 'status' | 'amount'>) =>
  p.status === 'PAID' && !p.paidPaise ? p.amount || 0 : p.paidPaise || 0;
export const balancePaiseOf = (p: Pick<PaymentRequest, 'amount' | 'paidPaise' | 'status'>) =>
  Math.max(0, (p.amount || 0) - paidPaiseOf(p));

/** ₹ with Indian digit grouping and paise only when needed */
export const inr = (paise: number) =>
  `₹${((paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Unique key per "Pay" attempt so a double tap never records twice */
export function newSettlementKey(): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `pay-${rnd}`.slice(0, 60);
}

/**
 * upi:// link that opens GPay / PhonePe / Paytm / BHIM with the payee,
 * amount and note filled in. The MD still confirms inside their own app.
 */
export function upiPayLink(opts: { vpa: string; name: string; amountPaise: number; note: string }): string {
  // Plain ASCII and %20 (not "+") — some UPI apps show "+" or garble other characters
  const ascii = (v: string) => v.replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
  const params: [string, string][] = [
    ['pa', opts.vpa.trim()],
    ['pn', ascii(opts.name).slice(0, 50)],
    ['am', (opts.amountPaise / 100).toFixed(2)],
    ['cu', 'INR'],
    ['tn', ascii(opts.note).slice(0, 50)],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, '@')}`).join('&')}`;
}

export const isValidVpa = (v: string) => /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/i.test(v.trim());

export const STATUS_META: Record<string, { label: string; tone: string }> = {
  SUBMITTED: { label: 'Waiting for payment', tone: 'bg-amber-100 text-amber-800' },
  UNDER_REVIEW: { label: 'Waiting for payment', tone: 'bg-amber-100 text-amber-800' },
  AWAITING_AUTHORIZATION: { label: 'Waiting for payment', tone: 'bg-amber-100 text-amber-800' },
  AUTHORIZED: { label: 'Approved – to pay', tone: 'bg-sky-100 text-sky-800' },
  PARTIALLY_PAID: { label: 'Part paid', tone: 'bg-violet-100 text-violet-800' },
  PROCESSING: { label: 'Sending via RazorpayX', tone: 'bg-indigo-100 text-indigo-800' },
  PAID: { label: 'Paid', tone: 'bg-emerald-100 text-emerald-800' },
  REJECTED: { label: 'Rejected', tone: 'bg-rose-100 text-rose-800' },
  FAILED: { label: 'Failed', tone: 'bg-rose-100 text-rose-800' },
  REVERSED: { label: 'Reversed', tone: 'bg-rose-100 text-rose-800' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-slate-200 text-slate-700' },
};

export const payeeKindOf = (p: Pick<PaymentRequest, 'payeeKind' | 'payeeType'>) =>
  p.payeeKind || (p.payeeType === 'SITE_INCHARGE' ? 'INCHARGE' : 'VENDOR');

export const idOf = (v: unknown): string =>
  v && typeof v === 'object' ? String((v as any)._id || (v as any).id || '') : String(v || '');

export const nameOf = (v: unknown, fallback = ''): string =>
  v && typeof v === 'object' ? String((v as any).name || fallback) : fallback;

const REMEMBERED_VPA_KEY = 'bkr-my-upi-id';
export function rememberedVpa(): string {
  try {
    return localStorage.getItem(REMEMBERED_VPA_KEY) || '';
  } catch {
    return '';
  }
}
export function rememberVpa(v: string) {
  try {
    if (v) localStorage.setItem(REMEMBERED_VPA_KEY, v);
  } catch {
    /* private mode */
  }
}
