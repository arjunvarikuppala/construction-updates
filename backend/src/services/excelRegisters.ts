/**
 * Day-by-day Excel registers for the MD (one file per topic):
 *   - Project · Payments  : Payments (one row per payment made) + Payment timeline
 *   - Project · Work      : Daily work (every calendar day) + Work items + Labour + Materials + Machinery
 *   - Project · Expenses  : Expenses
 *   - In-charge · Salary  : Salary payments + Month-wise
 * Every dated sheet is strictly in date order with a total line after each day
 * and a grand total. Project budget is never shown.
 */
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { PaymentRequest } from '../models/PaymentRequest.js';
import { DailyReport } from '../models/DailyReport.js';
import { Expense } from '../models/Expense.js';
import { SalaryPayment } from '../models/SalaryPayment.js';
import { User } from '../models/User.js';
import { CompanySettings } from '../models/CompanySettings.js';
import { MODE_LABEL } from './paymentSettlementService.js';
import { labourRowCost, machineRent, machineRowCost } from './reportService.js';
import { istDateString, istMonthString } from '../utils/istDates.js';

const NAVY = 'FF2A3384';
const AMBER = 'FFFEF3DC';
const DAY_FILL = 'FFE6E8F5';
const ZEBRA = 'FFF4F5FB';
/** Indian grouping (1,23,45,678.00): Excel ignores comma positions, so lakh/crore need conditional sections */
const INR = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"#,##0.00';
const IST_MS = 330 * 60000;
const DAY_MS = 86400000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const rupees = (paise: number) => round2((paise || 0) / 100);
const name = (v: any, fallback = '') => (v && typeof v === 'object' ? v.name || fallback : fallback);
/** Excel date for the IST calendar day of a timestamp */
const xlDay = (d: Date | string) => new Date(`${istDateString(new Date(d))}T00:00:00Z`);
/** Excel date-time showing IST wall-clock time */
const xlTime = (d?: Date | string | null) => (d ? new Date(new Date(d).getTime() + IST_MS) : '');
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const niceDay = (d: Date) =>
  `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-')} (${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })})`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const titleCase = (s?: string) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ period

export interface Period {
  from: string; // YYYY-MM-DD (IST)
  to: string;
}

/** from/to from the query (YYYY-MM-DD); defaults: first record → today. At most ~3 years of days. */
export function resolvePeriod(query: any, firstRecord?: Date | null): Period {
  const ok = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const today = istDateString(new Date());
  let to = ok(query?.to) ? String(query.to) : today;
  if (to > today) to = today;
  let from = ok(query?.from) ? String(query.from) : firstRecord ? istDateString(firstRecord) : to;
  if (from > to) from = to;
  const maxFrom = istDateString(new Date(Date.parse(`${to}T00:00:00Z`) - 1100 * DAY_MS));
  if (from < maxFrom) from = maxFrom;
  return { from, to };
}
const inPeriod = (p: Period, d: Date | string) => {
  const k = istDateString(new Date(d));
  return k >= p.from && k <= p.to;
};
/** UTC instant window covering the IST days of the period */
const periodWindow = (p: Period) => ({
  $gte: new Date(Date.parse(`${p.from}T00:00:00Z`) - IST_MS),
  $lt: new Date(Date.parse(`${p.to}T00:00:00Z`) + DAY_MS - IST_MS),
});
const periodText = (p: Period) => `${niceDay(new Date(`${p.from}T00:00:00Z`)).slice(0, 11)} to ${niceDay(new Date(`${p.to}T00:00:00Z`)).slice(0, 11)}`;

// ------------------------------------------------------------------ sheet writer

type Kind = 'date' | 'datetime' | 'money' | 'num';
type Col = [header: string, width: number, kind?: Kind];

interface SheetOpts {
  /** Column index holding the row's day: rows are grouped and sorted by it */
  day?: number;
  /** Secondary sort inside a day (e.g. a time column) */
  timeCol?: number;
  /** Columns added up in day totals and the grand total */
  sum?: number[];
  /** List every calendar day of this period; empty days get a red "emptyText" line */
  allDays?: Period;
  emptyText?: string;
  /** false: no "Total <day>" line (sheet already has one row per day) */
  dayTotals?: boolean;
}

function addSheet(wb: ExcelJS.Workbook, title: string, subtitle: string, cols: Col[], rows: any[][], opts: SheetOpts = {}) {
  const { day, timeCol, sum: sumCols = [], allDays, emptyText = 'No entries', dayTotals = true } = opts;
  // Freeze the 3 header rows and the first (date) column. Both topLeftCell and the selected cell
  // must be inside the scrolling (bottom-right) pane: if either points into the frozen area,
  // Excel scrolls that pane back to A1 and shows column A and rows 1-3 twice.
  const ws = wb.addWorksheet(title.slice(0, 31), {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 3, topLeftCell: 'B4', activeCell: 'B4' }],
  });
  ws.addRow([title]).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.addRow([subtitle]).font = { italic: true, color: { argb: 'FF64748B' } };
  const head = ws.addRow(cols.map((c) => c[0]));
  head.height = 34;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  cols.forEach(([, width, kind], i) => {
    const col = ws.getColumn(i + 1);
    // The day column also holds "Total 09-Nov-2026 (Mon)" / "GRAND TOTAL": keep it wide enough
    col.width = i === day ? Math.max(width, 25) : width;
    if (kind === 'date') col.numFmt = 'dd-mmm-yyyy (ddd)';
    if (kind === 'datetime') col.numFmt = 'dd-mmm-yyyy hh:mm';
    if (kind === 'money') col.numFmt = INR;
    if (kind === 'num') col.numFmt = '#,##0.##';
  });
  const fill = (row: ExcelJS.Row, argb: string) =>
    row.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }));
  const addData = (r: any[], shade: boolean) => {
    // Values past the last column are sort keys only, never written
    const row = ws.addRow(r.slice(0, cols.length).map((v) => (v === undefined || v === null ? '' : v)));
    row.alignment = { vertical: 'top', wrapText: true };
    if (shade) fill(row, ZEBRA);
  };
  const total = (label: string, group: any[][], strong: boolean) => {
    const row = ws.addRow(
      cols.map((_, i) => (i === (day ?? 0) ? label : sumCols.includes(i) ? round2(group.reduce((s, r) => s + (Number(r[i]) || 0), 0)) : ''))
    );
    row.font = { bold: true, color: { argb: strong ? 'FF000000' : NAVY } };
    fill(row, strong ? AMBER : DAY_FILL);
    row.eachCell({ includeEmpty: true }, (c) => (c.border = { top: { style: strong ? 'medium' : 'thin', color: { argb: NAVY } } }));
  };

  if (day === undefined) {
    rows.forEach((r, i) => addData(r, i % 2 === 1));
  } else {
    const sorted = rows
      .map((r, i) => ({ r, i }))
      .sort(
        (a, b) =>
          a.r[day] - b.r[day] ||
          (timeCol !== undefined ? (Number(a.r[timeCol]) || 0) - (Number(b.r[timeCol]) || 0) : 0) ||
          a.i - b.i
      )
      .map((x) => x.r);
    const groups = new Map<string, any[][]>();
    for (const r of sorted) {
      const k = dayKey(r[day]);
      groups.set(k, [...(groups.get(k) || []), r]);
    }
    let keys = [...groups.keys()];
    if (allDays) {
      keys = [];
      for (let t = Date.parse(`${allDays.from}T00:00:00Z`); t <= Date.parse(`${allDays.to}T00:00:00Z`); t += DAY_MS) keys.push(dayKey(new Date(t)));
    }
    for (const k of keys) {
      const g = groups.get(k) || [];
      const date = new Date(`${k}T00:00:00Z`);
      if (!g.length) {
        const row = ws.addRow(cols.map((_, i) => (i === day ? date : i === day + 1 ? emptyText : '')));
        row.font = { italic: true, color: { argb: 'FFB91C1C' } };
        fill(row, 'FFFDF2F2');
        continue;
      }
      g.forEach((r) => addData(r, false));
      if (sumCols.length && dayTotals) total(`Total ${niceDay(date)}`, g, false);
    }
  }
  if (!rows.length && !allDays) ws.addRow(['No entries in this period']).font = { italic: true, color: { argb: 'FF94A3B8' } };
  if (sumCols.length) total(day === undefined ? 'TOTAL' : 'GRAND TOTAL', rows, true);
  if (ws.rowCount > 3) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: ws.rowCount, column: cols.length } };
  return ws;
}

async function newBook(ownerId: string) {
  const company = await CompanySettings.findOne({ owner: ownerId }).select('legalName');
  const wb = new ExcelJS.Workbook();
  wb.creator = company?.legalName || 'BKR INFRA';
  wb.created = new Date();
  return { wb, company: company?.legalName || 'BKR INFRA' };
}

interface ProjectLike {
  _id: mongoose.Types.ObjectId | string;
  name: string;
  code: string;
  startDate?: Date;
}

// ------------------------------------------------------------------ 1. Payments

const ACTION_TEXT: Record<string, string> = {
  PAYMENT_REQUEST_CREATED: 'Raised',
  PAYMENT_REVIEWED: 'Reviewed',
  PAYMENT_AUTHORIZED: 'Approved',
  PAYMENT_PAID: 'Paid (full)',
  PAYMENT_PART_PAID: 'Part paid',
  PAYMENT_ENTRY_UNDONE: 'Payment undone',
  PAYMENT_REJECTED: 'Rejected',
  PAYMENT_CANCELLED: 'Withdrawn',
  PAYMENT_RECEIPT_CONFIRMED: 'Receipt confirmed',
  RAZORPAYX_PAYOUT_STARTED: 'Payout sent (RazorpayX)',
  RAZORPAYX_PAYOUT_FAILED: 'Payout failed',
  RAZORPAYX_PAYOUT_REVERSED: 'Payout reversed',
};

export async function paymentsWorkbook(project: ProjectLike, ownerId: string, query: any) {
  const requests = await PaymentRequest.find({ project: project._id })
    .populate('createdBy', 'name')
    .populate('authorizedBy', 'name')
    .populate('settlements.recordedBy', 'name')
    .populate('auditTrail.performedBy', 'name')
    .sort({ createdAt: 1 });
  const firstPaid = requests
    .flatMap((p: any) => (p.settlements || []).filter((s: any) => !s.voided).map((s: any) => new Date(s.paidOn)))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const period = resolvePeriod(query, firstPaid || (requests[0] as any)?.createdAt || project.startDate);
  const { wb, company } = await newBook(ownerId);
  const heading = `${project.code} – ${project.name}`;

  const rows: any[][] = [];
  for (const p of requests as any[]) {
    let paidSoFar = 0;
    const live = (p.settlements || []).filter((s: any) => !s.voided).sort((a: any, b: any) => +new Date(a.paidOn) - +new Date(b.paidOn) || +new Date(a.recordedAt) - +new Date(b.recordedAt));
    for (const s of live) {
      paidSoFar += s.amountPaise;
      if (!inPeriod(period, s.paidOn)) continue;
      const balance = Math.max(0, p.amount - paidSoFar);
      rows.push([
        xlDay(s.paidOn),
        p.paymentReference,
        p.purpose,
        p.quantity ?? '',
        p.quantity ? p.unit || '' : '',
        p.rate ?? '',
        rupees(p.amount),
        rupees(s.amountPaise),
        rupees(balance),
        MODE_LABEL[s.mode as keyof typeof MODE_LABEL] || s.mode,
        s.reference || (s.mode === 'CASH' ? 'Cash' : ''),
        p.payeeNameSnapshot,
        p.payeeKind === 'INCHARGE' ? 'Site In-Charge' : titleCase(p.payeeType || 'Vendor'),
        p.vpaSnapshot ? `UPI ${p.vpaSnapshot}` : p.accountNumberMaskedSnapshot ? `A/C ${p.accountNumberMaskedSnapshot} · ${p.ifscSnapshot || ''}` : '',
        xlTime(p.createdAt),
        name(p.createdBy, 'Site In-Charge'),
        p.invoiceUrl ? 'Yes' : 'No',
        name(p.authorizedBy, name(s.recordedBy, 'MD')),
        xlTime(p.authorizedAt || s.recordedAt),
        name(s.recordedBy, 'MD'),
        p.payeeKind === 'INCHARGE' ? (s.receivedConfirmedAt ? xlTime(s.receivedConfirmedAt) : 'Not yet') : '—',
        balance > 0 ? 'Part paid' : 'Paid',
        xlTime(s.recordedAt), // hidden sort key (same-day order)
      ]);
    }
  }
  const payCols: Col[] = [
    ['Paid on', 17, 'date'], ['Request no.', 15], ['Purpose', 28], ['Qty', 7, 'num'], ['Unit', 8], ['Rate', 11, 'money'], ['Request amount', 14, 'money'],
    ['Amount paid', 13, 'money'], ['Balance after', 13, 'money'], ['Mode', 13], ['UTR / cheque no.', 18], ['Paid to', 20], ['Payee type', 13], ['UPI / bank', 24],
    ['Raised on', 17, 'datetime'], ['Raised by', 13], ['Bill', 6], ['Approved by', 14], ['Approved on', 17, 'datetime'], ['Paid by', 14], ['Received by payee', 17, 'datetime'], ['Status', 11],
  ];
  addSheet(wb, 'Payments', `${company} · ${heading} · ${periodText(period)} · day by day: one row per payment made, total after each day`, payCols, rows, {
    day: 0,
    timeCol: 22,
    sum: [7],
  });

  const timeline: any[][] = [];
  for (const p of requests as any[]) {
    for (const a of p.auditTrail || []) {
      if (!inPeriod(period, a.timestamp)) continue;
      timeline.push([
        xlTime(a.timestamp),
        p.paymentReference,
        p.purpose,
        ACTION_TEXT[a.action] || titleCase(String(a.action).replace(/^PAYMENT_/, '')),
        name(a.performedBy, ''),
        a.action === 'PAYMENT_REQUEST_CREATED' ? rupees(p.amount) : '',
        a.note || '',
      ]);
    }
  }
  timeline.sort((a, b) => +a[0] - +b[0]);
  addSheet(
    wb,
    'Payment timeline',
    `${heading} · ${periodText(period)} · every step of every request, in time order: who did what, and when`,
    [['Date & time', 18, 'datetime'], ['Request no.', 15], ['Purpose', 28], ['What happened', 20], ['By', 16], ['Amount', 13, 'money'], ['Note', 50]],
    timeline
  );
  return { wb, file: `${project.code}-Payments-${period.from}-to-${period.to}.xlsx` };
}

// ------------------------------------------------------------------ 2. Work

export async function workWorkbook(project: ProjectLike, ownerId: string, query: any) {
  const all = await DailyReport.find({ project: project._id, status: { $ne: 'DRAFT' } })
    .populate('submittedBy', 'name')
    .sort({ workDate: 1, submittedAt: 1, createdAt: 1 });
  const period = resolvePeriod(query, (all[0] as any)?.workDate || project.startDate);
  const reports = (all as any[]).filter((r) => inPeriod(period, r.workDate));
  const { wb, company } = await newBook(ownerId);
  const heading = `${project.code} – ${project.name}`;
  const by = (r: any) => name(r.submittedBy, 'Site In-Charge');

  const machineLabel = (m: any) =>
    `${m.name}${m.model ? `: ${m.model}` : ''}${m.regNo ? ` (${m.regNo})` : ''}${m.quantity > 1 ? ` ×${m.quantity}` : ''} – ${
      m.rateBasis === 'TRIP' || m.trips ? `${m.trips || 0} trips` : m.hoursUsed ? `${m.hoursUsed} h` : '1 day'
    }`;
  const matCost = (m: any) => round2((m.quantity || 0) * (m.rate || 0));

  // Daily work: one row per report, every calendar day listed
  addSheet(
    wb,
    'Daily work',
    `${company} · ${heading} · ${periodText(period)} · every calendar day; days without a report are marked in red`,
    [
      ['Date', 17, 'date'], ['Shift', 8], ['Location', 14], ['Work', 22], ['Summary', 32], ['Workers', 8], ['Labour cost', 12, 'money'],
      ['Material used', 12, 'money'], ['Machinery cost', 12, 'money'], ['Machines used', 44], ['Total cost', 12, 'money'], ['Submitted by', 13], ['Submitted at', 17, 'datetime'],
    ],
    reports.map((r) => {
      const lab = round2((r.labourBreakdown || []).reduce((s: number, l: any) => s + labourRowCost(l), 0));
      const mat = round2((r.materials || []).reduce((s: number, m: any) => s + matCost(m), 0));
      const mac = round2((r.machinery || []).reduce((s: number, m: any) => s + machineRowCost(m), 0));
      return [
        xlDay(r.workDate), titleCase(r.shift), r.workLocation || '', r.titleOfWork, r.workSummary || '', r.totalLabourCount || 0, lab, mat, mac,
        (r.machinery || []).map(machineLabel).join('\n') || 'No machine', round2(lab + mat + mac), by(r), xlTime(r.submittedAt || r.createdAt),
      ];
    }),
    { day: 0, sum: [5, 6, 7, 8, 10], allDays: period, emptyText: 'No daily report submitted', dayTotals: false }
  );

  // Work items
  addSheet(
    wb,
    'Work items',
    `${heading} · ${periodText(period)} · day by day: work done with quantity × rate`,
    [['Date', 17, 'date'], ['Block / location', 16], ['Work item', 30], ['Quantity', 10, 'num'], ['Unit', 8], ['Rate per unit', 13, 'money'], ['Amount', 14, 'money'], ['Status', 12], ['Machine used', 40], ['Remarks', 28], ['Entered by', 13]],
    reports.flatMap((r) =>
      (r.workItems || []).map((w: any) => [
        xlDay(r.workDate), w.location || r.workLocation || '', w.description, w.quantity || 0, w.unit, w.rate ?? '',
        w.budget ? round2(w.budget) : w.rate ? round2((w.quantity || 0) * w.rate) : '', titleCase(w.status), w.machineUsed || '', w.remarks || '', by(r),
      ])
    ),
    { day: 0, sum: [6] }
  );

  // Labour
  addSheet(
    wb,
    'Labour',
    `${heading} · ${periodText(period)} · day by day: each gang / trade · cost = heads × wage per head + overtime`,
    [
      ['Date', 17, 'date'], ['Contractor / gang', 18], ['Trade', 16], ['Skill', 11], ['Heads', 7, 'num'], ['In', 7], ['Out', 7], ['Hours', 7, 'num'], ['OT hours', 8, 'num'],
      ['Wage per head / day', 13, 'money'], ['Wages', 12, 'money'], ['OT rate per hour', 11, 'money'], ['OT pay', 11, 'money'], ['Total cost', 13, 'money'], ['Man-hours', 10, 'num'], ['Work done', 30], ['Entered by', 13],
    ],
    reports.flatMap((r) =>
      (r.labourBreakdown || []).map((l: any) => {
        const wages = round2((l.count || 0) * (l.wagePerDay || 0));
        const ot = round2((l.count || 0) * (l.otHours || 0) * (l.otRate || 0));
        return [
          xlDay(r.workDate), l.contractor || '', l.role, titleCase(l.category), l.count || 0, l.inTime || '', l.outTime || '', l.hours ?? '', l.otHours ?? '',
          l.wagePerDay ?? '', wages, l.otRate ?? '', ot || '', labourRowCost(l), round2((l.count || 0) * ((l.hours || 0) + (l.otHours || 0))), l.workDone || '', by(r),
        ];
      })
    ),
    { day: 0, sum: [4, 10, 12, 13, 14] }
  );

  // Materials: stock is tracked over the project's whole history so the opening balance is right
  const stock = new Map<string, number>();
  const matRows: any[][] = [];
  for (const r of all as any[]) {
    for (const m of r.materials || []) {
      const key = `${String(m.name).trim().toLowerCase()}|${String(m.unit || '').toLowerCase()}`;
      const opening = round2(stock.get(key) || 0);
      const closing = round2(opening + (m.received || 0) - (m.quantity || 0));
      stock.set(key, closing);
      if (!inPeriod(period, r.workDate)) continue;
      matRows.push([
        xlDay(r.workDate), m.name, m.spec || '', m.unit, opening, m.received ?? '', m.supplier || '', m.billNo || '', m.quantity || 0, m.usedFor || '',
        closing, m.rate ?? '', m.received && m.rate ? round2(m.received * m.rate) : '', matCost(m), m.remarks || '', by(r),
      ]);
    }
  }
  addSheet(
    wb,
    'Materials',
    `${heading} · ${periodText(period)} · day by day stock register: opening + received − used = closing`,
    [
      ['Date', 17, 'date'], ['Material', 16], ['Specification', 22], ['Unit', 8], ['Opening stock', 10, 'num'], ['Received', 10, 'num'], ['Supplier', 20], ['Bill no.', 14],
      ['Used', 9, 'num'], ['Used for', 24], ['Closing stock', 10, 'num'], ['Rate per unit', 12, 'money'], ['Received value', 13, 'money'], ['Used value', 13, 'money'], ['Remarks', 24], ['Entered by', 13],
    ],
    matRows,
    { day: 0, sum: [12, 13] }
  );

  // Machinery
  addSheet(
    wb,
    'Machinery',
    `${heading} · ${periodText(period)} · day by day machine log · total = hire + diesel + operator bata`,
    [
      ['Date', 17, 'date'], ['Machine', 18], ['Nos', 5, 'num'], ['Make / model', 20], ['Reg. / ID no.', 15], ['Own / hired', 9], ['Owner / supplier', 20], ['Operator', 12],
      ['Start', 7], ['End', 7], ['Hour meter start', 10, 'num'], ['Hour meter end', 10, 'num'], ['Working hours', 9, 'num'], ['Idle / breakdown hrs', 10, 'num'],
      ['Work done', 30], ['Work qty', 9, 'num'], ['Unit', 7], ['Rate', 11, 'money'], ['Rate per', 8], ['Trips', 6, 'num'], ['Hire', 12, 'money'],
      ['Diesel (L)', 9, 'num'], ['Diesel cost', 11, 'money'], ['Operator bata', 11, 'money'], ['Total cost', 13, 'money'], ['Cost per unit of work', 12, 'money'], ['Per', 11], ['Remarks', 26], ['Entered by', 13],
    ],
    reports.flatMap((r) =>
      (r.machinery || []).map((m: any) => {
        const total = machineRowCost(m);
        const diesel = round2((m.dieselLitres || 0) * (m.dieselRate || 0));
        return [
          xlDay(r.workDate), m.name, m.quantity || 1, m.model || '', m.regNo || '', m.ownership ? titleCase(m.ownership) : '', m.supplier || '', m.operator || '',
          m.startTime || '', m.endTime || '', m.meterStart ?? '', m.meterEnd ?? '', m.hoursUsed ?? '', m.idleHours ?? '',
          m.workDone || '', m.workQty ?? '', m.workQty ? m.workUnit || '' : '', m.rate ?? '', m.rate ? ({ DAY: 'day', HOUR: 'hour', TRIP: 'trip' } as any)[m.rateBasis || 'DAY'] : '',
          m.trips ?? '', machineRent(m), m.dieselLitres ?? '', diesel || '', m.bata ?? '', total,
          m.workQty ? round2(total / m.workQty) : '', m.workQty && m.workUnit ? `₹ per ${m.workUnit}` : '', m.remarks || '', by(r),
        ];
      })
    ),
    { day: 0, sum: [12, 20, 21, 22, 23, 24] }
  );

  return { wb, file: `${project.code}-Work-${period.from}-to-${period.to}.xlsx` };
}

// ------------------------------------------------------------------ 3. Expenses

export async function expensesWorkbook(project: ProjectLike, ownerId: string, query: any) {
  const first = await Expense.findOne({ project: project._id }).sort({ date: 1 }).select('date');
  const period = resolvePeriod(query, first?.date || project.startDate);
  const expenses = await Expense.find({ project: project._id, date: periodWindow(period) })
    .populate('submittedBy', 'name')
    .populate('reviewedBy', 'name')
    .sort({ date: 1, createdAt: 1 });
  const { wb, company } = await newBook(ownerId);
  addSheet(
    wb,
    'Expenses',
    `${company} · ${project.code} – ${project.name} · ${periodText(period)} · day by day, with GST split and approval`,
    [
      ['Date', 17, 'date'], ['Category', 16], ['Vendor', 20], ['Description', 30], ['Taxable', 12, 'money'], ['GST %', 7, 'num'], ['GST', 11, 'money'],
      ['Amount', 12, 'money'], ['Bill', 6], ['Submitted by', 13], ['Approved / rejected by', 16], ['On', 17, 'datetime'], ['Status', 11], ['Payment', 11], ['Rejection reason', 26],
    ],
    (expenses as any[]).map((e) => {
      const g = e.gst?.isGstBill ? e.gst : null;
      const gstPaise = g ? (g.cgstPaise || 0) + (g.sgstPaise || 0) + (g.igstPaise || 0) : 0;
      return [
        xlDay(e.date), titleCase(e.category), e.vendor || '', e.description || '', rupees(g ? g.taxablePaise : e.amount), g ? g.ratePercent : '', gstPaise ? rupees(gstPaise) : '',
        rupees(e.amount), e.receiptUrl ? 'Yes' : 'No', name(e.submittedBy, ''), e.reviewedBy ? name(e.reviewedBy, 'MD') : '', xlTime(e.reviewedAt),
        titleCase(e.status), titleCase(e.paymentStatus || 'Unpaid'), e.rejectionReason || '',
      ];
    }),
    { day: 0, sum: [4, 6, 7] }
  );
  return { wb, file: `${project.code}-Expenses-${period.from}-to-${period.to}.xlsx` };
}

// ------------------------------------------------------------------ 4. Salary (one in-charge)

const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export async function salaryWorkbook(ownerId: string, employeeId: mongoose.Types.ObjectId) {
  const employee = await User.findById(employeeId).select('name salary salaryFrequency createdAt');
  const all = await SalaryPayment.find({ company: ownerId, employee: employeeId }).populate('recordedBy', 'name').sort({ paidOn: 1, createdAt: 1 });
  const { wb, company } = await newBook(ownerId);
  const who = employee?.name || 'Site In-Charge';
  const monthly = employee && (employee.salaryFrequency || 'MONTHLY') === 'MONTHLY' ? employee.salary || 0 : 0;
  const idTail = String(employeeId).slice(-4).toUpperCase();

  // Receipt numbers match the app: position of the entry within its month (undone entries keep their number)
  const byMonth = new Map<string, any[]>();
  for (const p of all as any[]) byMonth.set(p.month, [...(byMonth.get(p.month) || []), p]);
  const live = (all as any[]).filter((p) => !p.voided);
  const paidTill = new Map<string, number>();

  const payRows = live.map((p) => {
    const monthEntries = byMonth.get(p.month) || [];
    const due = monthEntries.find((e) => !e.voided)?.monthlySalaryPaise || monthly;
    const sofar = (paidTill.get(p.month) || 0) + p.amountPaise;
    paidTill.set(p.month, sofar);
    return [
      xlDay(p.paidOn), monthLabel(p.month), rupees(due), rupees(p.amountPaise), due ? rupees(Math.max(0, due - sofar)) : '',
      MODE_LABEL[p.mode as keyof typeof MODE_LABEL] || p.mode, p.reference || (p.mode === 'CASH' ? 'Cash' : ''), name(p.recordedBy, 'MD'),
      p.receivedConfirmedAt ? xlDay(p.receivedConfirmedAt) : 'Not yet',
      `SAL-${p.month.replace('-', '')}-${idTail}-${monthEntries.indexOf(p) + 1}`, p.note || '',
    ];
  });
  addSheet(
    wb,
    'Salary payments',
    `${company} · ${who} · Site In-Charge · ${monthly ? `monthly salary ₹${(monthly / 100).toLocaleString('en-IN')}` : 'no monthly salary set'} · every payment by date, total after each day`,
    [
      ['Paid on', 17, 'date'], ['Salary month', 15], ['Monthly salary', 13, 'money'], ['Amount paid', 13, 'money'], ['Balance for month', 13, 'money'],
      ['Mode', 13], ['UTR / cheque no.', 18], ['Paid by', 15], ['Received on', 15, 'date'], ['Receipt no.', 20], ['Note', 34],
    ],
    payRows,
    { day: 0, sum: [3] }
  );

  // Month-wise: from joining (or first payment) to this month, at most 24 months back
  const current = istMonthString();
  let start = [live[0]?.month || current, istMonthString(employee?.createdAt || new Date())].sort()[0];
  if (start < addMonths(current, -23)) start = addMonths(current, -23);
  const months = new Set<string>(live.map((p) => p.month));
  for (let m = start; m <= current; m = addMonths(m, 1)) months.add(m);
  const monthRows = [...months].sort().map((m) => {
    const e = live.filter((p) => p.month === m);
    const due = e[0]?.monthlySalaryPaise || monthly;
    const paid = e.reduce((s, p) => s + p.amountPaise, 0);
    const status = paid <= 0 ? 'Not paid' : due > 0 && paid < due ? 'Part paid' : 'Paid';
    return [monthLabel(m), rupees(due), rupees(paid), rupees(Math.max(0, due - paid)), status, e.length, e.map((p) => istDateString(new Date(p.paidOn)).split('-').reverse().join('-')).join(', ')];
  });
  const ws = addSheet(
    wb,
    'Month-wise',
    `${who} · salary due vs paid, month by month`,
    [['Month', 16], ['Monthly salary', 13, 'money'], ['Paid', 13, 'money'], ['Balance', 13, 'money'], ['Status', 11], ['Payments', 9, 'num'], ['Paid on', 32]],
    monthRows,
    { sum: [1, 2, 3] }
  );
  ws.eachRow((row, i) => {
    if (i < 4) return;
    const argb = ({ 'Part paid': 'FFB45309', 'Not paid': 'FFB91C1C', Paid: 'FF15803D' } as Record<string, string>)[String(row.getCell(5).value)];
    if (argb) row.getCell(5).font = { bold: true, color: { argb } };
  });
  return { wb, file: `Salary-${who.replace(/[^A-Za-z0-9]+/g, '-')}.xlsx` };
}
