/**
 * GET /projects/:id/search?q=&types=work,payments&status=PAID,PART&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * One search over everything recorded on a project: daily work and work items,
 * labour, materials, machinery, payments and expenses. Every word typed must
 * match somewhere in the row (names, numbers, UTRs, dates, amounts).
 * Visible to anyone with access to the project (MD, or an assigned in-charge).
 */
import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { DailyReport } from '../models/DailyReport.js';
import { PaymentRequest } from '../models/PaymentRequest.js';
import { Expense } from '../models/Expense.js';
import { labourRowCost, machineRowCost } from '../services/reportService.js';
import { MODE_LABEL } from '../services/paymentSettlementService.js';
import { istDateString } from '../utils/istDates.js';

export type SearchType = 'work' | 'labour' | 'materials' | 'machinery' | 'payments' | 'expenses';
const TYPES: SearchType[] = ['work', 'labour', 'materials', 'machinery', 'payments', 'expenses'];

/** Payment status groups shown as chips */
const STATUS_GROUP: Record<string, string> = {
  SUBMITTED: 'WAITING',
  UNDER_REVIEW: 'WAITING',
  AWAITING_AUTHORIZATION: 'WAITING',
  AUTHORIZED: 'WAITING',
  PROCESSING: 'WAITING',
  PARTIALLY_PAID: 'PART',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
  CANCELLED: 'REJECTED',
  FAILED: 'REJECTED',
  REVERSED: 'REJECTED',
};
const STATUS_TEXT: Record<string, string> = { WAITING: 'Waiting for MD', PART: 'Part paid', PAID: 'Paid', REJECTED: 'Rejected' };
const MAX_RESULTS = 300;

export interface SearchResult {
  type: SearchType;
  id: string;
  date: string; // YYYY-MM-DD (IST)
  title: string;
  detail: string;
  amountPaise?: number;
  status?: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
  link?: string;
  /** payments only */
  paidPaise?: number;
  duePaise?: number;
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Words a date can be searched by: 2026-11-09, 09-11-2026, 09-nov, 9 nov, nov */
const dateWords = (d: string) => {
  const [y, m, dd] = d.split('-');
  const mon = MONTHS[Number(m) - 1];
  return `${d} ${dd}-${m}-${y} ${dd}/${m}/${y} ${dd}-${mon} ${Number(dd)}-${mon} ${dd} ${mon} ${Number(dd)} ${mon} ${mon}`;
};
/** Words an amount can be searched by: 45600, 45,600, 45600.00 */
const moneyWords = (paise?: number) => {
  if (!paise) return '';
  const r = paise / 100;
  return `${r} ${r.toFixed(2)} ${r.toLocaleString('en-IN')} ${r.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
};
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
const nm = (v: any, f = '') => (v && typeof v === 'object' ? v.name || f : f);
const cap = (s?: string) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export async function searchProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const access = await verifyUserProjectAccess(String(req.params.id), req.user!.userId, req.user!.role);
    if (!access.allowed || !access.project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }
    const projectId = access.project._id;

    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const words = norm(q).split(' ').filter(Boolean);
    const wantedTypes = new Set(
      String(req.query.types || '')
        .split(',')
        .filter((t): t is SearchType => TYPES.includes(t as SearchType))
    );
    const statuses = new Set(String(req.query.status || '').split(',').filter((s) => STATUS_TEXT[s]));
    const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
    const from = day(req.query.from);
    const to = day(req.query.to);

    // Nothing to search for yet
    if (!words.length && !statuses.size && !from && !to) {
      res.json({ success: true, results: [], counts: {}, total: 0, truncated: false, summary: null });
      return;
    }

    const all: Array<SearchResult & { hay: string }> = [];
    const push = (r: SearchResult, ...parts: Array<string | number | undefined | null>) =>
      all.push({ ...r, hay: norm(`${r.title} ${r.detail} ${r.status || ''} ${dateWords(r.date)} ${moneyWords(r.amountPaise)} ${parts.filter((p) => p !== undefined && p !== null && p !== '').join(' ')}`) });

    // When only payment status is picked, skip loading the rest
    const onlyPayments = statuses.size > 0;
    const [reports, payments, expenses] = await Promise.all([
      onlyPayments ? [] : DailyReport.find({ project: projectId, status: { $ne: 'DRAFT' } }).populate('submittedBy', 'name').lean(),
      PaymentRequest.find({ project: projectId }).populate('createdBy', 'name').lean(),
      onlyPayments ? [] : Expense.find({ project: projectId }).populate('submittedBy', 'name').lean(),
    ]);

    for (const r of reports as any[]) {
      const date = istDateString(new Date(r.workDate));
      const link = `/reports/${r._id}`;
      const by = nm(r.submittedBy, 'Site In-Charge');
      push(
        {
          type: 'work',
          id: `r-${r._id}`,
          date,
          title: r.titleOfWork,
          detail: [r.workLocation, r.workSummary, r.totalLabourCount ? `${r.totalLabourCount} workers` : '', `by ${by}`].filter(Boolean).join(' · '),
          link,
        },
        r.remarks,
        r.issuesAndDelays,
        r.equipmentDetails,
        cap(r.shift),
        'daily report'
      );
      (r.workItems || []).forEach((w: any, i: number) =>
        push(
          {
            type: 'work',
            id: `w-${r._id}-${i}`,
            date,
            title: w.description,
            detail: [w.location || r.workLocation, `${w.quantity} ${w.unit}`, w.rate ? `× ${inr(Math.round(w.rate * 100))}` : '', w.machineUsed ? `machine used: ${w.machineUsed}` : '']
              .filter(Boolean)
              .join(' · '),
            amountPaise: w.budget ? Math.round(w.budget * 100) : undefined,
            status: w.status ? cap(w.status) : undefined,
            tone: w.status === 'COMPLETED' ? 'success' : w.status === 'IN_PROGRESS' ? 'warning' : 'neutral',
            link,
          },
          w.remarks,
          r.titleOfWork,
          'work item'
        )
      );
      (r.labourBreakdown || []).forEach((l: any, i: number) => {
        const cost = labourRowCost(l);
        push(
          {
            type: 'labour',
            id: `l-${r._id}-${i}`,
            date,
            title: `${l.count} × ${l.role}`,
            detail: [l.contractor, cap(l.category), l.wagePerDay ? `${inr(Math.round(l.wagePerDay * 100))} per head` : '', l.otHours ? `OT ${l.otHours} h` : '', l.inTime && l.outTime ? `${l.inTime}–${l.outTime}` : '', l.workDone]
              .filter(Boolean)
              .join(' · '),
            amountPaise: cost ? Math.round(cost * 100) : undefined,
            link,
          },
          r.titleOfWork,
          'labour'
        );
      });
      (r.materials || []).forEach((m: any, i: number) => {
        const cost = (m.quantity || 0) * (m.rate || 0);
        push(
          {
            type: 'materials',
            id: `m-${r._id}-${i}`,
            date,
            title: `${m.name}${m.spec ? ` · ${m.spec}` : ''}`,
            detail: [
              `${m.quantity} ${m.unit} used`,
              m.received ? `${m.received} ${m.unit} received` : '',
              m.supplier,
              m.billNo ? `bill ${m.billNo}` : '',
              m.usedFor,
            ]
              .filter(Boolean)
              .join(' · '),
            amountPaise: cost ? Math.round(cost * 100) : undefined,
            link,
          },
          m.remarks,
          r.titleOfWork,
          'material'
        );
      });
      (r.machinery || []).forEach((m: any, i: number) => {
        const cost = machineRowCost(m);
        push(
          {
            type: 'machinery',
            id: `x-${r._id}-${i}`,
            date,
            title: `${m.quantity > 1 ? `${m.quantity} × ` : ''}${m.name}${m.model ? ` ${m.model}` : ''}`,
            detail: [
              m.regNo,
              m.ownership === 'HIRED' ? `hired${m.supplier ? ` from ${m.supplier}` : ''}` : m.ownership === 'OWN' ? 'own' : m.supplier,
              m.operator ? `operator ${m.operator}` : '',
              m.workDone,
              m.trips ? `${m.trips} trips` : m.hoursUsed ? `${m.hoursUsed} h` : '',
              m.dieselLitres ? `diesel ${m.dieselLitres} L` : '',
            ]
              .filter(Boolean)
              .join(' · '),
            amountPaise: cost ? Math.round(cost * 100) : undefined,
            link,
          },
          m.remarks,
          m.regNo ? String(m.regNo).replace(/\s+/g, '') : '',
          r.titleOfWork,
          'machine machinery'
        );
      });
    }

    for (const p of payments as any[]) {
      const group = STATUS_GROUP[p.status] || 'WAITING';
      const live = (p.settlements || []).filter((s: any) => !s.voided);
      const paid = live.reduce((s: number, x: any) => s + x.amountPaise, 0);
      const due = ['REJECTED', 'CANCELLED'].includes(p.status) ? 0 : Math.max(0, p.amount - paid);
      const last = live[live.length - 1];
      const date = istDateString(new Date(last?.paidOn || p.createdAt));
      if (statuses.size && !statuses.has(group)) continue;
      push(
        {
          type: 'payments',
          id: `p-${p._id}`,
          date,
          title: p.purpose,
          detail: [
            p.paymentReference,
            `to ${p.payeeNameSnapshot}`,
            p.quantity ? `${p.quantity} ${p.unit || ''}${p.rate ? ` × ${inr(Math.round(p.rate * 100))}` : ''}` : '',
            live.length ? live.map((s: any) => `${MODE_LABEL[s.mode as keyof typeof MODE_LABEL] || s.mode}${s.reference ? ` ${s.reference}` : ''}`).join(', ') : `raised by ${nm(p.createdBy, 'Site In-Charge')}`,
            paid && due ? `${inr(paid)} paid, ${inr(due)} due` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          amountPaise: p.amount,
          status: STATUS_TEXT[group],
          tone: group === 'PAID' ? 'success' : group === 'PART' ? 'warning' : group === 'REJECTED' ? 'danger' : 'neutral',
          link: `/payments?id=${p._id}`,
          paidPaise: paid,
          duePaise: due,
        },
        p.vpaSnapshot,
        p.accountNumberMaskedSnapshot,
        p.inchargeRemarks,
        p.rejectionReason,
        live.map((s: any) => `${s.reference || ''} ${moneyWords(s.amountPaise)} ${dateWords(istDateString(new Date(s.paidOn)))}`).join(' '),
        dateWords(istDateString(new Date(p.createdAt))),
        'payment'
      );
    }

    for (const e of expenses as any[]) {
      push(
        {
          type: 'expenses',
          id: `e-${e._id}`,
          date: istDateString(new Date(e.date)),
          title: e.description || cap(e.category),
          detail: [e.vendor, cap(e.category), e.gst?.isGstBill ? `GST ${e.gst.ratePercent}%` : '', e.receiptUrl ? 'bill attached' : 'no bill', `by ${nm(e.submittedBy, '')}`]
            .filter(Boolean)
            .join(' · '),
          amountPaise: e.amount,
          status: cap(e.status),
          tone: e.status === 'APPROVED' ? 'success' : e.status === 'REJECTED' ? 'danger' : 'warning',
          link: e.dailyReport ? `/reports/${e.dailyReport}` : undefined,
        },
        e.gst?.invoiceNumber,
        e.gst?.vendorGstin,
        e.rejectionReason,
        cap(e.paymentStatus),
        'expense'
      );
    }

    // Filter: every word, date range, then count per type before applying the type chips
    const matched = all.filter(
      (r) => (!from || r.date >= from) && (!to || r.date <= to) && words.every((w) => r.hay.includes(w))
    );
    const counts: Record<string, number> = {};
    for (const r of matched) counts[r.type] = (counts[r.type] || 0) + 1;
    const shown = matched
      .filter((r) => !wantedTypes.size || wantedTypes.has(r.type))
      .sort((a, b) => b.date.localeCompare(a.date) || TYPES.indexOf(a.type) - TYPES.indexOf(b.type));

    const summary = {
      paidPaise: shown.filter((r) => r.type === 'payments').reduce((s, r) => s + (r.paidPaise || 0), 0),
      duePaise: shown.filter((r) => r.type === 'payments').reduce((s, r) => s + (r.duePaise || 0), 0),
      machineryPaise: shown.filter((r) => r.type === 'machinery').reduce((s, r) => s + (r.amountPaise || 0), 0),
      labourPaise: shown.filter((r) => r.type === 'labour').reduce((s, r) => s + (r.amountPaise || 0), 0),
      materialsPaise: shown.filter((r) => r.type === 'materials').reduce((s, r) => s + (r.amountPaise || 0), 0),
      expensesPaise: shown.filter((r) => r.type === 'expenses').reduce((s, r) => s + (r.amountPaise || 0), 0),
    };

    res.json({
      success: true,
      results: shown.slice(0, MAX_RESULTS).map(({ hay, ...r }) => r),
      counts,
      total: shown.length,
      truncated: shown.length > MAX_RESULTS,
      summary,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Search failed', error: error.message });
  }
}
