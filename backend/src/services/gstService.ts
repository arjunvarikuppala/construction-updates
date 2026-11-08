/**
 * GST on purchase bills (Input Tax Credit).
 *
 * For a GST bill the site enters the taxable value and the GST rate; the server
 * computes the tax and the bill total, and splits it into CGST + SGST (vendor in
 * the same state as BKR INFRA) or IGST (vendor in another state). The state is the
 * first two digits of each GSTIN.
 */
import mongoose from 'mongoose';
import { CompanySettings } from '../models/CompanySettings.js';
import { Project } from '../models/Project.js';

export const GST_RATES = [0, 5, 12, 18, 28] as const;

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Format + official mod-36 checksum of a 15-character GSTIN. */
export function isValidGstin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const g = value.trim().toUpperCase();
  if (!GSTIN_FORMAT.test(g)) return false;
  const state = Number(g.slice(0, 2));
  if (state < 1 || state > 38) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
}

export const gstinStateCode = (gstin?: string | null) => (gstin && gstin.length >= 2 ? gstin.slice(0, 2) : undefined);

export interface GstDetails {
  vendorGstin: string;
  invoiceNumber: string;
  invoiceDate: Date;
  taxablePaise: number;
  ratePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  interState: boolean;
}

/** Split GST for a taxable value. Inter-state only when both state codes are known and differ. */
export function computeGst(taxablePaise: number, ratePercent: number, vendorGstin: string, companyGstin?: string | null) {
  const totalGstPaise = Math.round((taxablePaise * ratePercent) / 100);
  const companyState = gstinStateCode(companyGstin);
  const vendorState = gstinStateCode(vendorGstin);
  const interState = Boolean(companyState && vendorState && companyState !== vendorState);
  const cgstPaise = interState ? 0 : Math.floor(totalGstPaise / 2);
  const sgstPaise = interState ? 0 : totalGstPaise - cgstPaise;
  const igstPaise = interState ? totalGstPaise : 0;
  return { totalGstPaise, cgstPaise, sgstPaise, igstPaise, interState, totalPaise: taxablePaise + totalGstPaise };
}

/**
 * Validate the `gst` block of a bill. Returns undefined `gst` for a non-GST (cash) bill.
 * `label` prefixes error messages (e.g. "Expense 2").
 */
export function sanitizeGstBill(
  raw: any,
  companyGstin: string | null | undefined,
  label = 'Bill'
): { gst?: GstDetails; totalPaise?: number; errors: string[] } {
  if (!raw || raw.isGstBill !== true) return { errors: [] };
  const errors: string[] = [];

  const vendorGstin = typeof raw.vendorGstin === 'string' ? raw.vendorGstin.trim().toUpperCase() : '';
  if (!isValidGstin(vendorGstin)) errors.push(`${label}: vendor GSTIN is invalid (15 characters, e.g. 36AABCU9603R1ZO)`);

  const invoiceNumber = typeof raw.invoiceNumber === 'string' ? raw.invoiceNumber.trim().slice(0, 40) : '';
  if (!invoiceNumber) errors.push(`${label}: GST invoice number is required`);

  const invoiceDate = raw.invoiceDate ? new Date(raw.invoiceDate) : null;
  if (!invoiceDate || isNaN(invoiceDate.getTime())) errors.push(`${label}: GST invoice date is required`);
  else if (invoiceDate.getTime() > Date.now() + 86400000) errors.push(`${label}: GST invoice date cannot be in the future`);

  let taxablePaise: number | null = null;
  if (raw.taxablePaise !== undefined && raw.taxablePaise !== '') {
    const p = Number(raw.taxablePaise);
    taxablePaise = Number.isInteger(p) ? p : null;
  } else if (raw.taxable !== undefined && raw.taxable !== '') {
    const r = Number(raw.taxable);
    taxablePaise = Number.isFinite(r) ? Math.round(r * 100) : null;
  }
  if (taxablePaise === null || taxablePaise < 100) errors.push(`${label}: taxable amount must be at least ₹1`);
  else if (taxablePaise > 100_000_000_00) errors.push(`${label}: taxable amount is too large`);

  const ratePercent = Number(raw.ratePercent);
  if (!(GST_RATES as readonly number[]).includes(ratePercent)) errors.push(`${label}: GST rate must be 0, 5, 12, 18 or 28%`);

  if (errors.length) return { errors };

  const split = computeGst(taxablePaise!, ratePercent, vendorGstin, companyGstin);
  return {
    gst: {
      vendorGstin,
      invoiceNumber,
      invoiceDate: invoiceDate!,
      taxablePaise: taxablePaise!,
      ratePercent,
      cgstPaise: split.cgstPaise,
      sgstPaise: split.sgstPaise,
      igstPaise: split.igstPaise,
      interState: split.interState,
    },
    totalPaise: split.totalPaise,
    errors,
  };
}

/** BKR INFRA's GSTIN for the company owning a project (the project's MD). */
export async function getCompanyGstinForProject(projectId: unknown): Promise<string | undefined> {
  if (!projectId || !mongoose.Types.ObjectId.isValid(String(projectId))) return undefined;
  const project = await Project.findById(String(projectId)).select('owner createdBy');
  if (!project) return undefined;
  const ownerIds = [project.owner, project.createdBy].filter(Boolean);
  const settings = await CompanySettings.findOne({ owner: { $in: ownerIds } }).select('gstin');
  return settings?.gstin || undefined;
}
