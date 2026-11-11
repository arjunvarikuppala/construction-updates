/**
 * GST helpers mirroring the server (backend/src/services/gstService.ts).
 * The server recomputes everything; these only drive the live preview.
 */
import { useQuery } from '@tanstack/react-query';
import { localDateString } from './dates.js';
import { api } from '../api/client.js';
import type { GstBillDraft, ExpenseGst } from '../types/index.js';

export const GST_RATES = [0, 5, 12, 18, 28] as const;

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(value: string | undefined | null): boolean {
  const g = (value || '').trim().toUpperCase();
  if (!FORMAT.test(g)) return false;
  const state = Number(g.slice(0, 2));
  if (state < 1 || state > 38) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] === g[14];
}

/** GST split in paise. Inter-state (IGST) only when both state codes are known and differ. */
export function computeGst(taxablePaise: number, ratePercent: number, vendorGstin?: string, companyGstin?: string) {
  const gst = Math.round((taxablePaise * ratePercent) / 100);
  const vs = vendorGstin && vendorGstin.length >= 2 ? vendorGstin.slice(0, 2) : '';
  const cs = companyGstin && companyGstin.length >= 2 ? companyGstin.slice(0, 2) : '';
  const interState = Boolean(vs && cs && vs !== cs);
  const cgst = interState ? 0 : Math.floor(gst / 2);
  const sgst = interState ? 0 : gst - cgst;
  return { gst, cgst, sgst, igst: interState ? gst : 0, interState, total: taxablePaise + gst };
}

export const emptyGstDraft = (): GstBillDraft => ({
  isGstBill: true,
  vendorGstin: '',
  invoiceNumber: '',
  invoiceDate: localDateString(),
  taxable: '',
  ratePercent: 18,
});

/** Bill total in rupees for a GST draft (taxable + GST). */
export function gstDraftTotalRupees(d: GstBillDraft, companyGstin?: string): number {
  const taxablePaise = Math.round((parseFloat(d.taxable) || 0) * 100);
  return computeGst(taxablePaise, d.ratePercent, d.vendorGstin, companyGstin).total / 100;
}

/** GST amount (rupees) contained in a draft — the claimable input tax credit. */
export function gstDraftTaxRupees(d: GstBillDraft): number {
  const taxablePaise = Math.round((parseFloat(d.taxable) || 0) * 100);
  return Math.round((taxablePaise * d.ratePercent) / 100) / 100;
}

/** Problems that block submitting a GST bill (empty array = OK). */
export function gstDraftProblems(d: GstBillDraft, hasBillPhoto: boolean): string[] {
  const p: string[] = [];
  if (!isValidGstin(d.vendorGstin)) p.push('vendor GSTIN is invalid');
  if (!d.invoiceNumber.trim()) p.push('invoice number is required');
  if (!d.invoiceDate) p.push('invoice date is required');
  if (!(parseFloat(d.taxable) >= 1)) p.push('taxable amount must be at least ₹1');
  if (!hasBillPhoto) p.push('attach the GST invoice photo');
  return p;
}

export const gstDraftToPayload = (d?: GstBillDraft) =>
  d?.isGstBill
    ? {
        isGstBill: true,
        vendorGstin: d.vendorGstin.trim().toUpperCase(),
        invoiceNumber: d.invoiceNumber.trim(),
        invoiceDate: d.invoiceDate,
        taxable: d.taxable,
        ratePercent: d.ratePercent,
      }
    : undefined;

export const gstFromSaved = (g?: ExpenseGst | null): GstBillDraft | undefined =>
  g
    ? {
        isGstBill: true,
        vendorGstin: g.vendorGstin,
        invoiceNumber: g.invoiceNumber,
        invoiceDate: String(g.invoiceDate).slice(0, 10),
        taxable: String(g.taxablePaise / 100),
        ratePercent: g.ratePercent,
      }
    : undefined;

export interface CompanySettingsView {
  legalName: string;
  gstin: string;
  address: string;
  stateCode: string | null;
  reportReminders?: ReportReminderSettings;
}

/** Daily report reminders: In-Charge reminder, then MD alert, India time. */
export interface ReportReminderSettings {
  enabled: boolean;
  reminderTime: string; // "HH:MM"
  escalationTime: string; // "HH:MM"
  workDays: number[]; // 0 = Sunday … 6 = Saturday
}

/** BKR INFRA's company profile (GSTIN decides CGST+SGST vs IGST). */
export function useCompanySettings() {
  return useQuery({
    queryKey: ['company-settings'],
    queryFn: () => api.get<{ settings: CompanySettingsView }>('/company-settings').then((r) => r.settings),
    staleTime: 5 * 60 * 1000,
  });
}
