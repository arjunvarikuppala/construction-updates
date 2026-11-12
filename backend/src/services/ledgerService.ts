/**
 * Registers the MD keeps in Excel:
 *  - per project: payments (every payment entry, plus unpaid requests), daily work and expenses
 *  - per Site In-Charge: every rupee paid to them (salary + payment requests), by date
 * The same rows feed the on-screen tables and the .xlsx download, so they always match.
 */
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { PaymentRequest } from '../models/PaymentRequest.js';
import { DailyReport } from '../models/DailyReport.js';
import { Expense } from '../models/Expense.js';
import { SalaryPayment } from '../models/SalaryPayment.js';
import { User } from '../models/User.js';
import { CompanySettings } from '../models/CompanySettings.js';
import { getAccessibleProjectIds } from './tenantService.js';
import { MODE_LABEL } from './paymentSettlementService.js';
import { istDateString } from '../utils/istDates.js';

const name = (v: any, fallback = '') => (v && typeof v === 'object' ? v.name || fallback : fallback);
const day = (d?: Date | string | null) => (d ? istDateString(new Date(d)) : '');
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const STATUS_TEXT: Record<string, string> = {
  SUBMITTED: 'Waiting for MD',
  UNDER_REVIEW: 'Under review',
  AWAITING_AUTHORIZATION: 'Waiting for MD',
  AUTHORIZED: 'Approved',
  PROCESSING: 'Sending',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
  CANCELLED: 'Withdrawn',
  REVERSED: 'Reversed',
};

// ------------------------------------------------------------------ project

export interface ProjectPaymentRow {
  date: string; // paid on (or raised on, when nothing is paid yet)
  reference: string;
  raisedOn: string;
  raisedBy: string;
  purpose: string;
  payee: string;
  payeeType: string;
  requestAmountPaise: number;
  paidPaise: number; // this entry
  mode: string;
  utr: string;
  paidBy: string;
  received: string;
  status: string;
}

export interface ProjectWorkRow {
  date: string;
  title: string;
  summary: string;
  workItems: string;
  labour: number;
  labourBreakdown: string;
  materials: string;
  machinery: string;
  issues: string;
  photos: number;
  submittedBy: string;
  status: string;
}

export interface ProjectExpenseRow {
  date: string;
  category: string;
  vendor: string;
  description: string;
  amountPaise: number;
  status: string;
  submittedBy: string;
}

export async function buildProjectLedger(projectId: mongoose.Types.ObjectId) {
  const [payments, reports, expenses] = await Promise.all([
    PaymentRequest.find({ project: projectId })
      .populate('createdBy', 'name')
      .populate('settlements.recordedBy', 'name')
      .sort({ createdAt: 1 }),
    DailyReport.find({ project: projectId, status: { $ne: 'DRAFT' } })
      .populate('submittedBy', 'name')
      .sort({ workDate: 1, createdAt: 1 }),
    Expense.find({ project: projectId }).populate('submittedBy', 'name').sort({ date: 1 }),
  ]);

  const paymentRows: ProjectPaymentRow[] = [];
  for (const p of payments as any[]) {
    const base = {
      reference: p.paymentReference,
      raisedOn: day(p.createdAt),
      raisedBy: name(p.createdBy, 'Site In-Charge'),
      purpose: p.purpose,
      payee: p.payeeNameSnapshot,
      payeeType: p.payeeKind === 'INCHARGE' ? 'Site In-Charge' : String(p.payeeType || 'Vendor').toLowerCase().replace(/_/g, ' '),
      requestAmountPaise: p.amount,
      status: STATUS_TEXT[p.status] || p.status,
    };
    const live = (p.settlements || []).filter((s: any) => !s.voided);
    if (!live.length) {
      paymentRows.push({ ...base, date: base.raisedOn, paidPaise: 0, mode: '', utr: '', paidBy: '', received: '' });
      continue;
    }
    for (const s of live) {
      paymentRows.push({
        ...base,
        date: day(s.paidOn),
        paidPaise: s.amountPaise,
        mode: MODE_LABEL[s.mode as keyof typeof MODE_LABEL] || s.mode,
        utr: s.reference || (s.mode === 'CASH' ? 'Cash' : ''),
        paidBy: name(s.recordedBy, 'MD'),
        received: p.payeeKind === 'INCHARGE' ? (s.receivedConfirmedAt ? `Yes, ${day(s.receivedConfirmedAt)}` : 'Not yet') : '',
      });
    }
  }
  paymentRows.sort((a, b) => a.date.localeCompare(b.date));

  const workRows: ProjectWorkRow[] = (reports as any[]).map((r) => ({
    date: day(r.workDate),
    title: r.titleOfWork,
    summary: r.workSummary || '',
    workItems: (r.workItems || []).map((w: any) => `${w.description}: ${w.quantity} ${w.unit}`).join('; '),
    labour: r.totalLabourCount || 0,
    labourBreakdown: (r.labourBreakdown || []).map((l: any) => `${l.role} ${l.count}`).join(', '),
    materials: (r.materials || []).map((m: any) => `${m.name} ${m.quantity} ${m.unit}`).join(', '),
    machinery: [(r.machinery || []).map((m: any) => `${m.name} ×${m.quantity}`).join(', '), r.equipmentDetails].filter(Boolean).join('; '),
    issues: r.issuesAndDelays || '',
    photos: (r.photos || []).length,
    submittedBy: name(r.submittedBy, 'Site In-Charge'),
    status: String(r.status || '').replace(/_/g, ' ').toLowerCase(),
  }));

  const expenseRows: ProjectExpenseRow[] = (expenses as any[]).map((e) => ({
    date: day(e.date),
    category: String(e.category || '').replace(/_/g, ' ').toLowerCase(),
    vendor: e.vendor || '',
    description: e.description || '',
    amountPaise: e.amount,
    status: String(e.status || '').toLowerCase(),
    submittedBy: name(e.submittedBy, ''),
  }));

  const live = (payments as any[]).filter((p) => !['REJECTED', 'CANCELLED'].includes(p.status));
  const totals = {
    requestedPaise: live.reduce((s, p) => s + p.amount, 0),
    paidPaise: paymentRows.reduce((s, r) => s + r.paidPaise, 0),
    duePaise: live.reduce((s, p) => s + Math.max(0, p.amount - (p.paidPaise || 0)), 0),
    requests: payments.length,
    reports: workRows.length,
    labourDays: workRows.reduce((s, r) => s + r.labour, 0),
    expensesApprovedPaise: expenseRows.filter((e) => e.status === 'approved').reduce((s, e) => s + e.amountPaise, 0),
    expensesPendingPaise: expenseRows.filter((e) => e.status === 'pending').reduce((s, e) => s + e.amountPaise, 0),
  };
  return { payments: paymentRows, work: workRows, expenses: expenseRows, totals };
}

// ------------------------------------------------------------------ in-charge

export interface InChargePaymentRow {
  date: string;
  type: 'Salary' | 'Payment request';
  project: string;
  details: string;
  amountPaise: number;
  mode: string;
  utr: string;
  paidBy: string;
  received: string;
}

/** Everything the MD paid this in-charge: salaries and payment requests paid to them. */
export async function buildInChargeLedger(mdUserId: string, employeeId: mongoose.Types.ObjectId) {
  const projectIds = await getAccessibleProjectIds({ userId: mdUserId, role: 'MD' });
  const [salaries, requests] = await Promise.all([
    SalaryPayment.find({ company: mdUserId, employee: employeeId, voided: { $ne: true } }).populate('recordedBy', 'name').sort({ paidOn: 1 }),
    PaymentRequest.find({ payeeUser: employeeId, project: { $in: projectIds } })
      .populate('project', 'name code')
      .populate('settlements.recordedBy', 'name')
      .sort({ createdAt: 1 }),
  ]);

  const rows: InChargePaymentRow[] = [];
  for (const s of salaries as any[]) {
    rows.push({
      date: day(s.paidOn),
      type: 'Salary',
      project: '',
      details: `Salary for ${monthLabel(s.month)}${s.note ? ` · ${s.note}` : ''}`,
      amountPaise: s.amountPaise,
      mode: MODE_LABEL[s.mode as keyof typeof MODE_LABEL] || s.mode,
      utr: s.reference || (s.mode === 'CASH' ? 'Cash' : ''),
      paidBy: name(s.recordedBy, 'MD'),
      received: s.receivedConfirmedAt ? `Yes, ${day(s.receivedConfirmedAt)}` : 'Not yet',
    });
  }
  for (const p of requests as any[]) {
    for (const s of (p.settlements || []).filter((x: any) => !x.voided)) {
      rows.push({
        date: day(s.paidOn),
        type: 'Payment request',
        project: p.project ? `${p.project.code} – ${p.project.name}` : '',
        details: `${p.purpose} (${p.paymentReference})`,
        amountPaise: s.amountPaise,
        mode: MODE_LABEL[s.mode as keyof typeof MODE_LABEL] || s.mode,
        utr: s.reference || (s.mode === 'CASH' ? 'Cash' : ''),
        paidBy: name(s.recordedBy, 'MD'),
        received: s.receivedConfirmedAt ? `Yes, ${day(s.receivedConfirmedAt)}` : 'Not yet',
      });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const unpaidRequests = (requests as any[])
    .filter((p) => !['REJECTED', 'CANCELLED', 'PAID'].includes(p.status))
    .reduce((s, p) => s + Math.max(0, p.amount - (p.paidPaise || 0)), 0);
  const totals = {
    salaryPaise: rows.filter((r) => r.type === 'Salary').reduce((s, r) => s + r.amountPaise, 0),
    requestsPaise: rows.filter((r) => r.type === 'Payment request').reduce((s, r) => s + r.amountPaise, 0),
    totalPaise: rows.reduce((s, r) => s + r.amountPaise, 0),
    unpaidRequestsPaise: unpaidRequests,
  };
  return { rows, totals };
}

// ------------------------------------------------------------------ Excel

const NAVY = 'FF2A3384';
const rupees = (p: number) => Math.round(p) / 100;
/** Indian digit grouping (1,23,45,678.00) - Excel ignores comma positions, so lakh/crore need conditional sections */
const INR_FMT = '[>=10000000]"₹"##\,##\,##\,##0.00;[>=100000]"₹"##\,##\,##0.00;"₹"#,##0.00';
/** A real Excel date for an IST calendar day, so it sorts and filters as a date */
const xlDate = (s: string) => (s ? new Date(`${s}T00:00:00Z`) : null);

interface Col {
  header: string;
  key: string;
  width: number;
  kind?: 'date' | 'money' | 'number';
}

function addTable(wb: ExcelJS.Workbook, title: string, subtitle: string, cols: Col[], rows: Record<string, any>[], totals?: Record<string, any>) {
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.addRow([title]).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.addRow([subtitle]).font = { italic: true, color: { argb: 'FF64748B' } };
  const head = ws.addRow(cols.map((c) => c.header));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 22;
  head.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }));
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    if (c.kind === 'date') col.numFmt = 'dd-mmm-yyyy';
    if (c.kind === 'money') col.numFmt = INR_FMT;
  });
  rows.forEach((r, idx) => {
    const row = ws.addRow(
      cols.map((c) => (c.kind === 'date' ? xlDate(r[c.key]) : c.kind === 'money' ? rupees(r[c.key] || 0) : r[c.key] ?? ''))
    );
    row.alignment = { vertical: 'top', wrapText: true };
    if (idx % 2) row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F5FB' } }));
  });
  if (!rows.length) ws.addRow(['No entries yet']).font = { italic: true, color: { argb: 'FF94A3B8' } };
  if (rows.length) {
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: cols.length } };
  }
  if (totals) {
    const t = ws.addRow(cols.map((c, i) => (i === 0 ? 'TOTAL' : c.key in totals ? (c.kind === 'money' ? rupees(totals[c.key]) : totals[c.key]) : '')));
    t.font = { bold: true };
    t.eachCell((cell) => (cell.border = { top: { style: 'thin', color: { argb: NAVY } } }));
  }
  return ws;
}

function addSummary(wb: ExcelJS.Workbook, title: string, lines: Array<[string, string | number, ('money' | 'number')?]>) {
  const ws = wb.addWorksheet('Summary');
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 26;
  ws.addRow([title]).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.addRow([`Generated ${istDateString(new Date())}`]).font = { italic: true, color: { argb: 'FF64748B' } };
  ws.addRow([]);
  for (const [k, v, kind] of lines) {
    const r = ws.addRow([k, kind === 'money' ? rupees(Number(v)) : v]);
    r.getCell(1).font = { bold: true };
    if (kind === 'money') r.getCell(2).numFmt = INR_FMT;
  }
  return ws;
}

export async function inChargeWorkbook(mdUserId: string, employeeId: mongoose.Types.ObjectId) {
  const employee = await User.findById(employeeId).select('name salary salaryFrequency');
  const ledger = await buildInChargeLedger(mdUserId, employeeId);
  const company = await CompanySettings.findOne({ owner: mdUserId });
  const wb = new ExcelJS.Workbook();
  wb.creator = company?.legalName || 'BKR INFRA';
  wb.created = new Date();
  const who = employee?.name || 'Site In-Charge';
  const monthly = employee && (employee.salaryFrequency || 'MONTHLY') === 'MONTHLY' ? employee.salary || 0 : 0;
  const t = ledger.totals;
  addSummary(wb, `${company?.legalName || 'BKR INFRA'} · Payments to ${who}`, [
    ['Monthly salary', monthly, 'money'],
    ['Salary paid', t.salaryPaise, 'money'],
    ['Payment requests paid', t.requestsPaise, 'money'],
    ['Total paid', t.totalPaise, 'money'],
    ['Payment requests still due', t.unpaidRequestsPaise, 'money'],
    ['Payments listed', ledger.rows.length, 'number'],
  ]);
  const cols: Col[] = [
    { header: 'Date', key: 'date', width: 13, kind: 'date' },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Project', key: 'project', width: 24 },
    { header: 'Details', key: 'details', width: 40 },
    { header: 'Amount', key: 'amountPaise', width: 14, kind: 'money' },
    { header: 'Mode', key: 'mode', width: 14 },
    { header: 'UTR / cheque no.', key: 'utr', width: 18 },
    { header: 'Paid by', key: 'paidBy', width: 16 },
    { header: 'Received', key: 'received', width: 16 },
  ];
  addTable(wb, 'All payments', `${who} · every payment by date`, cols, ledger.rows, { amountPaise: t.totalPaise });
  addTable(wb, 'Salary', `${who} · salary payments`, cols, ledger.rows.filter((r) => r.type === 'Salary'), { amountPaise: t.salaryPaise });
  addTable(
    wb,
    'Payment requests',
    `${who} · payment requests paid to them`,
    cols,
    ledger.rows.filter((r) => r.type === 'Payment request'),
    { amountPaise: t.requestsPaise }
  );
  return { wb, name: who };
}
