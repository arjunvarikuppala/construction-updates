/**
 * Daily report input validation and linked-expense handling.
 */
import mongoose from 'mongoose';
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
    const s = cleanText(body.workSummary, 2000);
    // Drafts may omit the description; it is required again on submission.
    if (!s && body.status !== 'DRAFT' && !opts.partial) errors.push('Detailed work description is required');
    else if (!s && opts.partial && has('workSummary') && body.status === 'SUBMITTED') errors.push('Detailed work description is required');
    else data.workSummary = s ?? '';
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
        };
      })
      .filter(Boolean) as any[];
    data.totalLabourCount = data.labourBreakdown.reduce((sum, l) => sum + l.count, 0);
    // Labour cost = workers × daily wage, always computed on the server
    data.totalLabourCost =
      Math.round(data.labourBreakdown.reduce((sum, l) => sum + l.count * ((l as any).wagePerDay || 0), 0) * 100) / 100;
  }

  if (has('materials') || !opts.partial) {
    data.materials = arr(body.materials)
      .map((m: any) => {
        const name = cleanText(m?.name, 150);
        if (!name) return null;
        return {
          name,
          quantity: nonNegativeNumber(m?.quantity),
          unit: cleanText(m?.unit, 30) || 'units',
          remarks: cleanText(m?.remarks, 300),
        };
      })
      .filter(Boolean) as any[];
  }

  if (has('machinery') || !opts.partial) {
    data.machinery = arr(body.machinery)
      .map((m: any) => {
        const name = cleanText(m?.name, 150);
        if (!name) return null;
        const hours = m?.hoursUsed;
        return {
          name,
          quantity: Math.max(1, Math.floor(nonNegativeNumber(m?.quantity, 1, 1000))),
          hoursUsed: hours === undefined || hours === null || hours === '' ? undefined : Math.min(24, nonNegativeNumber(hours)),
          remarks: cleanText(m?.remarks, 300),
        };
      })
      .filter(Boolean) as any[];
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

export interface ReportExpenseInput {
  _id?: string;
  category: ExpenseCategory;
  description: string;
  amountPaise: number;
  vendor: string;
  receiptUrl?: string;
}

/** Validate the `expenses` array of a report payload. Amounts accepted as rupees or integer paise. */
export function sanitizeReportExpenses(raw: unknown): { expenses: ReportExpenseInput[]; errors: string[] } {
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
