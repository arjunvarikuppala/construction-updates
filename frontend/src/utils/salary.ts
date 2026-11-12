/** Monthly salaries for Site In-Charges: types and helpers. */
import type { SettlementMode } from '../types/index.js';

export type SalaryStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface SalaryPaymentEntry {
  _id: string;
  employee: string;
  month: string;
  monthlySalaryPaise: number;
  amountPaise: number;
  mode: SettlementMode;
  reference?: string;
  paidOn: string;
  proofUrl?: string;
  note?: string;
  recordedBy?: { _id: string; name: string } | string;
  receivedConfirmedAt?: string;
  voided?: boolean;
  voidedBy?: { _id: string; name: string } | string;
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
}

export interface SalaryMonth {
  month: string;
  label: string;
  duePaise: number;
  paidPaise: number;
  balancePaise: number;
  status: SalaryStatus;
  entries: SalaryPaymentEntry[];
}

export interface SalaryEmployee {
  _id: string;
  name: string;
  salary?: number;
  salaryFrequency?: 'MONTHLY' | 'DAILY' | 'PER_PROJECT';
  vpa?: string;
}

export interface SalaryHistoryResponse {
  employee: SalaryEmployee;
  history: SalaryMonth[];
  totals: { paidPaise: number; pendingPaise: number };
}

export interface SalarySummaryRow {
  employee: SalaryEmployee;
  duePaise: number;
  paidPaise: number;
  balancePaise: number;
  status: SalaryStatus;
  lastPaidOn: string | null;
}

export interface SalarySummaryResponse {
  month: string;
  label: string;
  rows: SalarySummaryRow[];
  totals: { duePaise: number; paidPaise: number; balancePaise: number; paidCount: number; count: number };
}

export const SALARY_STATUS: Record<SalaryStatus, { label: string; tone: string }> = {
  PAID: { label: 'Paid', tone: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  PARTIAL: { label: 'Part paid', tone: 'bg-amber-100 text-amber-800 border-amber-200' },
  UNPAID: { label: 'Not paid', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
};

export const monthLabel = (m: string, short = false) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' });
};

export const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Month options for the pay dialog: next month (advance), this month and the last 11 */
export const payableMonths = (current: string) => Array.from({ length: 13 }, (_, i) => addMonths(current, 1 - i));
