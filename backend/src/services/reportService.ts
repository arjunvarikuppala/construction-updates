/**
 * Daily report input validation and linked-expense handling.
 */
import mongoose from 'mongoose';
import { sanitizeGstBill, GstDetails } from './gstService.js';
import { Expense, IExpense } from '../models/Expense.js';
import { IDailyReport } from '../models/DailyReport.js';
import { ExpenseCategory } from '../types/index.js';
import { cleanText, nonNegativeNumber, parseDate } from '../utils/validation.js';
import { extractLocalFilename } from './fileAccessService.js';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'LABOUR',
  'CONSTRUCTION_MATERIALS',
  'DIESEL_AND_FUEL',
  'MACHINERY_AND_EQUIPMENT',
  'TRANSPORTATION',
  'FOOD_AND_ACCOMMODATION',
  'REPAIRS_AND_MAINTENANCE',
  'OTHER',
];

const WORK_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];
const LABOUR_CATEGORIES = ['SKILLED', 'UNSKILLED', 'SUPERVISOR', 'OTHER'];
const SHIFTS = ['DAY', 'NIGHT', 'GENERAL', 'DOUBLE'];
const MAX_ROWS = 100;

/** Allow only our own upload URLs or https URLs from storage providers. */
export function isAcceptableMediaUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url || url.length > 2048) return false;
  if (extractLocalFilename(url)) return true;
  return /^https:\/\//i.test(url);
}

function guessLabourCategory(role: string): string {
  const r = role.toLowerCase();
  if (r.includes('supervisor') || r.includes('foreman') || r.includes('engineer')) return 'SUPERVISOR';
  if (r.includes('helper') || r.includes('unskilled') || r.includes('coolie')) return 'UNSKILLED';
  return 'SKILLED';
}

function arr(value: unknown): any[] {
  return Array.isArray(value) ? value.slice(0, MAX_ROWS) : [];
}

export interface SanitizedReportFields {
  titleOfWork?: string;
  workDate?: Date;
  workSummary?: string;
  workItems?: any[];
  labourBreakdown?: any[];
  totalLabourCount?: number;
  totalLabourCost?: number;
  totalMaterialCost?: number;
  totalMachineryCost?: number;
  totalWorkBudget?: number;
  equipmentDetails?: string;
  issuesAndDelays?: string;
  nextDayPlan?: string;
  photos?: any[];
  shift?: string;
  workLocation?: string;
  remarks?: string;
  overallProgressPercent?: number;
  materials?: any[];
  machinery?: any[];
}

/**
 * Validate and normalise a report payload.
 * With `partial`, only keys present in the body are returned (for updates).
 */
const round2 = (n: number) => Math.round(n * 100) / 100;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const cleanTime = (v: unknown) => (typeof v === 'string' && TIME_RE.test(v.trim()) ? v.trim() : undefined);
const optNum = (v: unknown, max = 1e9) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, n) : undefined;
};

/** ₹ for one labour row: workers × daily wage + workers × overtime hours × overtime rate */
export const labourRowCost = (l: { count?: number; wagePerDay?: number; otHours?: number; otRate?: number }) =>
  round2((l.count || 0) * (l.wagePerDay || 0) + (l.count || 0) * (l.otHours || 0) * (l.otRate || 0));

/** ₹ hire for one machinery row: per day = machines × rate; per hour = machines × hours × rate; per trip = trips × rate */
export const machineRent = (m: { quantity?: number; rate?: number; rateBasis?: string; hoursUsed?: number; trips?: number }) => {
  if (!m.rate) return 0;
  if (m.rateBasis === 'TRIP') return round2((m.trips || 0) * m.rate);
  return round2((m.quantity || 0) * m.rate * (m.rateBasis === 'HOUR' ? m.hoursUsed || 0 : 1));
};

/** ₹ total for one machinery row: hire + diesel + operator bata */
export const machineRowCost = (m: Parameters<typeof machineRent>[0] & { dieselLitres?: number; dieselRate?: number; bata?: number }) =>
  round2(machineRent(m) + (m.dieselLitres || 0) * (m.dieselRate || 0) + (m.bata || 0));

export function sanitizeReportInput(
  body: any,
  opts: { partial: boolean }
): { data: SanitizedReportFields; errors: string[] } {
  const errors: string[] = [];
  const data: SanitizedReportFields = {};
  const has = (k: string) => body[k] !== undefined;
  const need = (k: string) => !opts.partial || has(k);

  if (need('titleOfWork')) {
    const t = cleanText(body.titleOfWork, 200);
    if (!t) errors.push('Title of work is required');
    else data.titleOfWork = t;
  }

  if (need('workDate')) {
    const d = parseDate(body.workDate);
    if (!d) errors.push('A valid work date is required');
    else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);
      if (d > tomorrow) errors.push('Work date cannot be in the future');
      else data.workDate = d;
    }
  }

  if (need('workSummary')) {
    // Optional: a report only needs *some* content (see reportHasContent) to be submitted.
    data.workSummary = cleanText(body.workSummary, 2000) ?? '';
  }

  if (has('workItems') || !opts.partial) {
    data.workItems = arr(body.workItems)
      .map((item: any) => {
        const description = cleanText(item?.description ?? item?.taskDescription, 300);
        if (!description) return null;
        const status = WORK_STATUSES.includes(item?.status) ? item.status : undefined;
        const progress = item?.progressPercent;
        const quantity = nonNegativeNumber(item?.quantity);
        const rate = nonNegativeNumber(item?.rate);
        return {
          description,
          quantity,
          unit: cleanText(item?.unit, 30) || 'units',
          rate: rate > 0 ? rate : undefined,
          // With a rate, the amount is always quantity × rate (never trusted from the client)
          budget: rate > 0 ? Math.round(quantity * rate * 100) / 100 : nonNegativeNumber(item?.budget ?? item?.budgetINR),
          location: cleanText(item?.location, 150),
          status,
          progressPercent:
            progress === undefined || progress === null || progress === ''
              ? status === 'COMPLETED'
                ? 100
                : undefined
              : Math.min(100, nonNegativeNumber(progress)),
          remarks: cleanText(item?.remarks, 500),
          machineUsed: cleanText(item?.machineUsed, 300),
        };
      })
      .filter(Boolean) as any[];
    data.totalWorkBudget = data.workItems.reduce((sum, i) => sum + (i.budget || 0), 0);
  }

  if (has('labourBreakdown') || !opts.partial) {
    data.labourBreakdown = arr(body.labourBreakdown)
      .map((item: any) => {
        const role = cleanText(item?.role, 80);
        const count = Math.floor(nonNegativeNumber(item?.count, 0, 10000));
        if (!role || count <= 0) return null;
        const hoursRaw = item?.hours;
        const wage = nonNegativeNumber(item?.wagePerDay);
        return {
          role,
          count,
          category: LABOUR_CATEGORIES.includes(item?.category) ? item.category : guessLabourCategory(role),
          hours: hoursRaw === undefined || hoursRaw === null || hoursRaw === '' ? undefined : Math.min(24, nonNegativeNumber(hoursRaw)),
          wagePerDay: wage > 0 ? wage : undefined,
          contractor: cleanText(item?.contractor, 120),
          inTime: cleanTime(item?.inTime),
          outTime: cleanTime(item?.outTime),
          otHours: optNum(item?.otHours, 16) || undefined,
          otRate: optNum(item?.otRate) || undefined,
          workDone: cleanText(item?.workDone, 300),
        };
      })
      .filter(Boolean) as any[];
    data.totalLabourCount = data.labourBreakdown.reduce((sum, l) => sum + l.count, 0);
    // Labour cost = workers × daily wage + overtime, always computed on the server
    data.totalLabourCost = round2(data.labourBreakdown.reduce((sum, l) => sum + labourRowCost(l), 0));
  }

  if (has('materials') || !opts.partial) {
    data.materials = arr(body.materials)
      .map((m: any) => {
        const name = cleanText(m?.name, 150);
        if (!name) return null;
        const rate = nonNegativeNumber(m?.rate);
        return {
          name,
          quantity: nonNegativeNumber(m?.quantity),
          unit: cleanText(m?.unit, 30) || 'units',
          rate: rate > 0 ? rate : undefined,
          remarks: cleanText(m?.remarks, 300),
          spec: cleanText(m?.spec, 150),
          received: optNum(m?.received),
          supplier: cleanText(m?.supplier, 150),
          billNo: cleanText(m?.billNo, 60),
          usedFor: cleanText(m?.usedFor, 200),
        };
      })
      .filter(Boolean) as any[];
    // Material cost = quantity × rate, always computed on the server
    data.totalMaterialCost = round2(data.materials.reduce((s, m) => s + m.quantity * (m.rate || 0), 0));
  }

  if (has('machinery') || !opts.partial) {
    data.machinery = arr(body.machinery)
      .map((m: any) => {
        const name = cleanText(m?.name, 150);
        if (!name) return null;
        const rate = nonNegativeNumber(m?.rate);
        const meterStart = optNum(m?.meterStart);
        const meterEnd = optNum(m?.meterEnd);
        const meterHours = meterStart !== undefined && meterEnd !== undefined && meterEnd >= meterStart ? round2(meterEnd - meterStart) : undefined;
        // Hours typed win; otherwise take them from the hour meter
        const hoursUsed = optNum(m?.hoursUsed, 24) ?? (meterHours !== undefined ? Math.min(24, meterHours) : undefined);
        const ownership = m?.ownership === 'OWN' || m?.ownership === 'HIRED' ? m.ownership : undefined;
        return {
          name,
          quantity: Math.max(1, Math.floor(nonNegativeNumber(m?.quantity, 1, 1000))),
          hoursUsed,
          rate: rate > 0 ? rate : undefined,
          rateBasis: rate > 0 ? (['HOUR', 'TRIP'].includes(m?.rateBasis) ? m.rateBasis : 'DAY') : undefined,
          remarks: cleanText(m?.remarks, 300),
          model: cleanText(m?.model, 120),
          regNo: cleanText(m?.regNo, 40)?.toUpperCase(),
          ownership,
          supplier: cleanText(m?.supplier, 150),
          operator: cleanText(m?.operator, 80),
          startTime: cleanTime(m?.startTime),
          endTime: cleanTime(m?.endTime),
          meterStart,
          meterEnd,
          idleHours: optNum(m?.idleHours, 24) || undefined,
          workDone: cleanText(m?.workDone, 300),
          workQty: optNum(m?.workQty) || undefined,
          workUnit: cleanText(m?.workUnit, 30),
          trips: optNum(m?.trips, 1000) || undefined,
          dieselLitres: optNum(m?.dieselLitres, 10000) || undefined,
          dieselRate: optNum(m?.dieselRate, 1000) || undefined,
          bata: optNum(m?.bata, 100000) || undefined,
        };
      })
      .filter(Boolean) as any[];
    // Machinery cost: hire (per day / hour / trip) + diesel + operator bata
    data.totalMachineryCost = round2(data.machinery.reduce((s, m) => s + machineRowCost(m), 0));
  }

  if (has('photos') || !opts.partial) {
    const photos = arr(body.photos);
    const bad = photos.filter((p: any) => !isAcceptableMediaUrl(p?.url));
    if (bad.length) errors.push('One or more photo attachments are invalid. Please re-upload them.');
    data.photos = photos
      .filter((p: any) => isAcceptableMediaUrl(p?.url))
      .map((p: any) => ({
        url: p.url,
        caption: cleanText(p.caption, 200),
        uploadedAt: parseDate(p.uploadedAt) || new Date(),
      }));
  }

  for (const key of ['equipmentDetails', 'issuesAndDelays', 'nextDayPlan', 'remarks', 'workLocation'] as const) {
    if (has(key)) (data as any)[key] = cleanText(body[key], key === 'workLocation' ? 200 : 1000) ?? '';
  }

  if (has('shift')) data.shift = SHIFTS.includes(body.shift) ? body.shift : undefined;

  if (has('overallProgressPercent')) {
    const v = body.overallProgressPercent;
    data.overallProgressPercent =
      v === null || v === '' || v === undefined ? undefined : Math.round(Math.min(100, nonNegativeNumber(v)));
  }

  return { data, errors };
}

export const EMPTY_REPORT_MESSAGE =
  'Add at least one entry before submitting — a work item, labour, material, machinery, expense, photo or work description.';

/** A submitted report needs at least one section filled in; no single section is mandatory. */
export function reportHasContent(
  r: {
    workSummary?: string;
    workItems?: unknown[];
    labourBreakdown?: unknown[];
    materials?: unknown[];
    machinery?: unknown[];
    photos?: unknown[];
  },
  expenseCount = 0
): boolean {
  return (
    Boolean(String(r.workSummary || '').trim()) ||
    (r.workItems?.length || 0) > 0 ||
    (r.labourBreakdown?.length || 0) > 0 ||
    (r.materials?.length || 0) > 0 ||
    (r.machinery?.length || 0) > 0 ||
    (r.photos?.length || 0) > 0 ||
    expenseCount > 0
  );
}

export interface ReportExpenseInput {
  _id?: string;
  category: ExpenseCategory;
  description: string;
  amountPaise: number;
  vendor: string;
  receiptUrl?: string;
  gst?: GstDetails;
}

/**
 * Validate the `expenses` array of a report payload. Amounts accepted as rupees or integer paise.
 * GST bills: the amount is taxable value + GST, computed from the `gst` block.
 */
export function sanitizeReportExpenses(
  raw: unknown,
  companyGstin?: string | null
): { expenses: ReportExpenseInput[]; errors: string[] } {
  const errors: string[] = [];
  const expenses: ReportExpenseInput[] = [];
  arr(raw).forEach((e: any, idx: number) => {
    const n = idx + 1;
    const description = cleanText(e?.description, 1000);
    const category = EXPENSE_CATEGORIES.includes(e?.category) ? (e.category as ExpenseCategory) : null;

    let amountPaise: number | null = null;
    if (e?.amountPaise !== undefined && e?.amountPaise !== '') {
      const p = Number(e.amountPaise);
      amountPaise = Number.isInteger(p) ? p : null;
    } else if (e?.amount !== undefined && e?.amount !== '') {
      const r = Number(e.amount);
      amountPaise = Number.isFinite(r) ? Math.round(r * 100) : null;
    }

    const gstResult = sanitizeGstBill(e?.gst, companyGstin, `Expense ${n}`);
    errors.push(...gstResult.errors);
    if (gstResult.totalPaise !== undefined) amountPaise = gstResult.totalPaise;

    if (!description && !amountPaise) return; // fully empty row: ignore
    if (!category) errors.push(`Expense ${n}: choose a category`);
    if (!description) errors.push(`Expense ${n}: description is required`);
    if (amountPaise === null || amountPaise < 100) errors.push(`Expense ${n}: amount must be at least ₹1`);
    if (amountPaise !== null && amountPaise > 100_000_000_00) errors.push(`Expense ${n}: amount is too large`);
    if (e?.receiptUrl && !isAcceptableMediaUrl(e.receiptUrl)) errors.push(`Expense ${n}: receipt attachment is invalid`);

    if (category && description && amountPaise !== null && amountPaise >= 100) {
      expenses.push({
        _id: mongoose.Types.ObjectId.isValid(String(e?._id || '')) ? String(e._id) : undefined,
        category,
        description,
        amountPaise,
        vendor: cleanText(e?.vendor, 200) || 'Not specified',
        receiptUrl: e?.receiptUrl || undefined,
        gst: gstResult.gst,
      });
    }
  });
  return { expenses, errors };
}

/**
 * Keep the report's linked expenses in sync.
 * - While the report is a DRAFT, linked expenses are DRAFT and fully editable
 *   (rows missing from the payload are removed).
 * - Once SUBMITTED, existing linked expenses follow the normal approval workflow
 *   and are never modified here; new rows are added as PENDING.
 */
export async function syncReportExpenses(
  report: IDailyReport,
  inputs: ReportExpenseInput[],
  actorUserId: string
): Promise<void> {
  const isDraft = report.status === 'DRAFT';
  const existing = await Expense.find({ dailyReport: report._id });
  const byId = new Map(existing.map((e) => [e._id.toString(), e]));
  const keep = new Set<string>();

  for (const input of inputs) {
    const current = input._id ? byId.get(input._id) : undefined;
    if (current) {
      keep.add(current._id.toString());
      if (current.status === 'DRAFT') {
        current.category = input.category;
        current.description = input.description;
        current.amount = input.amountPaise;
        current.vendor = input.vendor;
        current.receiptUrl = input.receiptUrl;
        current.gst = input.gst;
        current.date = report.workDate;
        await current.save();
      }
      continue;
    }
    const created = await Expense.create({
      project: report.project,
      submittedBy: actorUserId,
      date: report.workDate,
      category: input.category,
      description: input.description,
      amount: input.amountPaise,
      vendor: input.vendor,
      receiptUrl: input.receiptUrl,
      gst: input.gst,
      status: isDraft ? 'DRAFT' : 'PENDING',
      resubmissionCount: 0,
      dailyReport: report._id,
    });
    keep.add(created._id.toString());
  }

  // Remove draft rows the user deleted from the form (only while the report is a draft)
  if (isDraft) {
    const removable = existing.filter((e) => e.status === 'DRAFT' && !keep.has(e._id.toString()));
    if (removable.length) await Expense.deleteMany({ _id: { $in: removable.map((e) => e._id) } });
  }
}

/** When a draft report is submitted, its draft expenses enter the MD approval queue. */
export async function promoteDraftExpenses(report: IDailyReport): Promise<number> {
  const result = await Expense.updateMany(
    { dailyReport: report._id, status: 'DRAFT' },
    { $set: { status: 'PENDING', date: report.workDate } }
  );
  return result.modifiedCount || 0;
}

export async function getReportExpenses(reportId: mongoose.Types.ObjectId | string): Promise<IExpense[]> {
  return Expense.find({ dailyReport: reportId })
    .populate('reviewedBy', 'name email role')
    .sort({ createdAt: 1 });
}
