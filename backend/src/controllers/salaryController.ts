/**
 * Monthly salaries for Site In-Charges.
 *
 * The MD pays each in-charge from their own UPI app / bank / cheque / cash and
 * records it here against a salary month. The in-charge is notified and can
 * download a salary receipt. Only the MD and the in-charge themself can see an
 * in-charge's salary history.
 */
import { Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { SalaryPayment, ISalaryPayment } from '../models/SalaryPayment.js';
import { PaymentRequest } from '../models/PaymentRequest.js';
import { AuthenticatedRequest, isMD } from '../types/index.js';
import { getCompanyInChargeIds, isInChargeInCompany } from '../services/tenantService.js';
import { sanitizeSettlement, SettlementError, MODE_LABEL } from '../services/paymentSettlementService.js';
import { createNotification } from '../services/notificationService.js';
import { logAudit } from '../services/auditService.js';
import { emitToUser } from '../services/socketService.js';
import { istMonthString } from '../utils/istDates.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Monthly salary in paise, or 0 when the in-charge is not on a monthly salary */
const monthlyOf = (u: { salary?: number; salaryFrequency?: string } | null) =>
  u && (u.salaryFrequency || 'MONTHLY') === 'MONTHLY' ? Math.max(0, u.salary || 0) : 0;

/** Due / paid / balance for one month from its (non-voided) entries */
function monthSummary(month: string, entries: ISalaryPayment[], currentMonthly: number) {
  const live = entries.filter((e) => !e.voided);
  const paidPaise = live.reduce((s, e) => s + e.amountPaise, 0);
  // The salary that applied when the month was first paid; otherwise today's salary
  const duePaise = live.length ? live[0].monthlySalaryPaise || currentMonthly : currentMonthly;
  const balancePaise = Math.max(0, duePaise - paidPaise);
  const status = paidPaise <= 0 ? 'UNPAID' : duePaise > 0 && paidPaise < duePaise ? 'PARTIAL' : 'PAID';
  return { month, label: monthLabel(month), duePaise, paidPaise, balancePaise, status, entries };
}

function fail(res: Response, err: any, fallback: string) {
  if (err instanceof SettlementError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }
  res.status(500).json({ success: false, message: fallback, error: err?.message });
}

/** Who may see this employee's salary: the MD whose company they belong to, or the employee */
async function resolveAccess(req: AuthenticatedRequest, employeeId: string) {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) throw new SettlementError(404, 'In-charge not found.');
  const me = req.user!.userId;
  if (isMD(req.user!.role)) {
    if (!(await isInChargeInCompany(me, employeeId))) throw new SettlementError(404, 'In-charge not found.');
  } else if (me !== employeeId) {
    throw new SettlementError(403, 'You can only see your own salary.');
  }
  const employee = await User.findById(employeeId).select('name email phone salary salaryFrequency createdAt role');
  if (!employee) throw new SettlementError(404, 'In-charge not found.');
  return employee;
}

const populateEntry = (q: any) => q.populate('recordedBy', 'name').populate('voidedBy', 'name');

/** GET /salaries/summary?month=YYYY-MM — MD: every in-charge's salary status for a month */
export async function salarySummary(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const month = MONTH_RE.test(String(req.query.month || '')) ? String(req.query.month) : istMonthString();
    const ids = await getCompanyInChargeIds(req.user!.userId);
    const [users, payments, vpas] = await Promise.all([
      User.find({ _id: { $in: ids }, email: { $not: /@deleted\.invalid$/ } }).select('name salary salaryFrequency').sort({ name: 1 }),
      SalaryPayment.find({ company: req.user!.userId, month, voided: { $ne: true } }).sort({ paidOn: 1 }),
      // A UPI ID the in-charge used before on a payment request, to prefill "Open UPI app"
      PaymentRequest.aggregate([
        { $match: { payeeUser: { $in: ids }, vpaSnapshot: { $nin: [null, ''] } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$payeeUser', vpa: { $first: '$vpaSnapshot' } } },
      ]),
    ]);
    const vpaOf = new Map(vpas.map((v: any) => [String(v._id), v.vpa]));
    const rows = users.map((u) => {
      const mine = payments.filter((p) => String(p.employee) === String(u._id));
      const s = monthSummary(month, mine, monthlyOf(u));
      return {
        employee: { _id: u._id, name: u.name, salary: u.salary, salaryFrequency: u.salaryFrequency, vpa: vpaOf.get(String(u._id)) },
        duePaise: s.duePaise,
        paidPaise: s.paidPaise,
        balancePaise: s.balancePaise,
        status: s.status,
        lastPaidOn: mine.length ? mine[mine.length - 1].paidOn : null,
      };
    });
    const totals = rows.reduce(
      (t, r) => ({
        duePaise: t.duePaise + r.duePaise,
        paidPaise: t.paidPaise + r.paidPaise,
        balancePaise: t.balancePaise + r.balancePaise,
        paidCount: t.paidCount + (r.status === 'PAID' ? 1 : 0),
      }),
      { duePaise: 0, paidPaise: 0, balancePaise: 0, paidCount: 0 }
    );
    res.json({ success: true, month, label: monthLabel(month), rows, totals: { ...totals, count: rows.length } });
  } catch (err) {
    fail(res, err, 'Could not load salaries');
  }
}

/** GET /salaries/employees/:id (or /salaries/me) — month-by-month history */
export async function salaryHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const employeeId = req.params.id || req.user!.userId;
    const employee = await resolveAccess(req, employeeId);
    const company = isMD(req.user!.role) ? { company: req.user!.userId } : {};
    const payments = await populateEntry(SalaryPayment.find({ employee: employee._id, ...company }).sort({ paidOn: 1, createdAt: 1 }));

    const current = istMonthString();
    const firstPaid = payments.length ? payments.map((p: ISalaryPayment) => p.month).sort()[0] : current;
    const joined = istMonthString(employee.createdAt || new Date());
    // From whichever is earlier (joining or first payment), at most 24 months back, plus any month already paid
    let start = [firstPaid, joined].sort()[0];
    if (start < addMonths(current, -23)) start = addMonths(current, -23);
    const months = new Set<string>(payments.map((p: ISalaryPayment) => p.month));
    for (let m = start; m <= current; m = addMonths(m, 1)) months.add(m);

    const monthly = monthlyOf(employee);
    const history = Array.from(months)
      .sort()
      .reverse()
      .map((m) => monthSummary(m, payments.filter((p: ISalaryPayment) => p.month === m), monthly));
    const totals = {
      paidPaise: history.reduce((s, h) => s + h.paidPaise, 0),
      pendingPaise: history.reduce((s, h) => s + h.balancePaise, 0),
    };
    res.json({
      success: true,
      employee: { _id: employee._id, name: employee.name, salary: employee.salary, salaryFrequency: employee.salaryFrequency },
      history,
      totals,
    });
  } catch (err) {
    fail(res, err, 'Could not load salary history');
  }
}

/** POST /salaries/employees/:id/payments — MD records a salary payment */
export async function paySalary(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const employee = await resolveAccess(req, req.params.id);
    const md = req.user!.userId;
    const month = String(req.body?.month || '');
    if (!MONTH_RE.test(month)) throw new SettlementError(400, 'Choose the salary month.');
    if (month > addMonths(istMonthString(), 1)) throw new SettlementError(400, 'You can pay at most one month in advance.');

    const clean = await sanitizeSettlement(req.body || {}, md);

    // Same tap again (network retry): return what was already recorded
    const existing = await SalaryPayment.findOne({ settlementKey: clean.settlementKey });
    if (existing) {
      res.json({ success: true, duplicate: true, message: 'Already recorded.', payment: existing });
      return;
    }

    const monthly = monthlyOf(employee);
    const already = await SalaryPayment.find({ company: md, employee: employee._id, month, voided: { $ne: true } }).sort({ createdAt: 1 });
    const due = already.length ? already[0].monthlySalaryPaise || monthly : monthly;
    const paid = already.reduce((s, p) => s + p.amountPaise, 0);
    if (due > 0 && paid + clean.amountPaise > due) {
      throw new SettlementError(
        400,
        paid >= due
          ? `${monthLabel(month)} salary is already fully paid (${inr(due)}).`
          : `That is more than the ${monthLabel(month)} balance (${inr(due - paid)}). To pay a bonus, raise the salary first or record it on another month.`
      );
    }

    if (clean.referenceKey) {
      const [salaryClash, paymentClash] = await Promise.all([
        SalaryPayment.findOne({ company: md, referenceKey: clean.referenceKey, voided: { $ne: true } }).select('month employee'),
        PaymentRequest.findOne({ company: md, settlements: { $elemMatch: { referenceKey: clean.referenceKey, voided: { $ne: true } } } }).select('paymentReference'),
      ]);
      if (salaryClash || paymentClash) {
        throw new SettlementError(
          409,
          `This ${clean.mode === 'CHEQUE' ? 'cheque number' : 'UTR'} is already recorded${
            paymentClash ? ` on payment ${paymentClash.paymentReference}` : ` on the ${monthLabel(salaryClash!.month)} salary`
          }. Check it is not the same payment entered twice.`
        );
      }
    }

    const payment = await SalaryPayment.create({
      company: md,
      employee: employee._id,
      month,
      monthlySalaryPaise: due,
      ...clean,
      recordedBy: md,
    });

    const nowPaid = paid + clean.amountPaise;
    const full = due > 0 && nowPaid >= due;
    await createNotification({
      recipient: employee._id,
      sender: md,
      type: 'SALARY_PAID',
      title: full ? `Salary paid · ${monthLabel(month)}` : `Salary ${due > 0 ? 'part payment' : 'paid'} · ${inr(clean.amountPaise)}`,
      message: `The MD paid your ${monthLabel(month)} salary: ${inr(clean.amountPaise)} by ${MODE_LABEL[clean.mode]}${
        clean.reference ? ` (ref ${clean.reference})` : ''
      }.${due > 0 && !full ? ` Balance ${inr(due - nowPaid)}.` : ''} Tap to download the salary receipt.`,
      relatedEntity: 'SALARY',
      relatedId: String(payment._id),
    });
    emitToUser(String(employee._id), 'salary:updated', { month });
    await logAudit('SALARY_PAID', md, 'SALARY', payment._id, {
      employee: String(employee._id),
      month,
      amountPaise: clean.amountPaise,
      mode: clean.mode,
      reference: clean.reference,
    }, req.ip);

    res.status(201).json({
      success: true,
      message: full ? `${monthLabel(month)} salary fully paid.` : `${inr(clean.amountPaise)} recorded for ${monthLabel(month)}.`,
      payment: await populateEntry(SalaryPayment.findById(payment._id)),
    });
  } catch (err) {
    fail(res, err, 'Could not record the salary payment');
  }
}

/** POST /salaries/payments/:pid/void — MD undoes a wrong entry (kept in history) */
export async function voidSalaryPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (!reason) throw new SettlementError(400, 'Say why this entry is being undone.');
    if (!mongoose.Types.ObjectId.isValid(req.params.pid)) throw new SettlementError(404, 'Salary payment not found.');
    const payment = await SalaryPayment.findOne({ _id: req.params.pid, company: req.user!.userId });
    if (!payment) throw new SettlementError(404, 'Salary payment not found.');
    if (payment.voided) throw new SettlementError(400, 'This entry is already undone.');
    payment.voided = true;
    payment.voidedBy = req.user!.userId as any;
    payment.voidedAt = new Date();
    payment.voidReason = reason;
    await payment.save();
    emitToUser(String(payment.employee), 'salary:updated', { month: payment.month });
    await logAudit('SALARY_PAYMENT_UNDONE', req.user!.userId, 'SALARY', payment._id, { month: payment.month, amountPaise: payment.amountPaise, reason }, req.ip);
    res.json({ success: true, message: 'Entry undone. It stays in the history.', payment });
  } catch (err) {
    fail(res, err, 'Could not undo the entry');
  }
}

/** POST /salaries/payments/:pid/confirm — the in-charge confirms the money arrived */
export async function confirmSalaryReceived(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.pid)) throw new SettlementError(404, 'Salary payment not found.');
    const payment = await SalaryPayment.findOne({ _id: req.params.pid, employee: req.user!.userId });
    if (!payment) throw new SettlementError(404, 'Salary payment not found.');
    if (payment.voided) throw new SettlementError(400, 'This entry was undone by the MD.');
    if (!payment.receivedConfirmedAt) {
      payment.receivedConfirmedAt = new Date();
      await payment.save();
      await createNotification({
        recipient: payment.company,
        sender: req.user!.userId,
        type: 'SALARY_PAID',
        title: 'Salary received',
        message: `${(await User.findById(req.user!.userId).select('name'))?.name || 'The in-charge'} confirmed receiving ${inr(payment.amountPaise)} for ${monthLabel(payment.month)}.`,
        relatedEntity: 'SALARY',
        relatedId: String(payment._id),
      });
      emitToUser(String(payment.company), 'salary:updated', { month: payment.month });
    }
    res.json({ success: true, message: 'Thanks — receipt confirmed.', payment });
  } catch (err) {
    fail(res, err, 'Could not confirm');
  }
}
