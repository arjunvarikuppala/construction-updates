/**
 * Recording money the MD actually paid against a payment request.
 *
 * BKR INFRA's MD approves a request by paying it — from their own UPI app or
 * bank, by cheque or in cash — and records the UTR / cheque number and a proof
 * screenshot here. A request can be paid in parts; every entry is kept and a
 * wrong entry is voided (never deleted) so the trail stays complete.
 */
import mongoose from 'mongoose';
import {
  PaymentRequest,
  IPaymentRequest,
  SettlementMode,
  SETTLEMENT_MODES,
} from '../models/PaymentRequest.js';
import { Expense } from '../models/Expense.js';
import { UploadedFile } from '../models/UploadedFile.js';
import { extractLocalFilename } from './fileAccessService.js';
import { localDayEnd } from '../utils/istDates.js';

/** Statuses the MD can still pay against */
export const PAYABLE_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_AUTHORIZATION', 'AUTHORIZED', 'PARTIALLY_PAID'];

/** Modes the MD records by hand (RazorpayX entries are written by the payout flow) */
const MANUAL_MODES: SettlementMode[] = SETTLEMENT_MODES.filter((m) => m !== 'RAZORPAYX');

export const MODE_LABEL: Record<SettlementMode, string> = {
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  CASH: 'Cash',
  RAZORPAYX: 'RazorpayX payout',
};

export class SettlementError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface SettlementInput {
  settlementKey?: unknown;
  amountRupees?: unknown;
  amountPaise?: unknown;
  mode?: unknown;
  reference?: unknown;
  paidOn?: unknown;
  proofUrl?: unknown;
  note?: unknown;
}

export interface CleanSettlement {
  settlementKey: string;
  amountPaise: number;
  mode: SettlementMode;
  reference?: string;
  referenceKey?: string;
  paidOn: Date;
  proofUrl?: string;
  note?: string;
}

const formatINR = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Remaining amount still to be paid on a request */
export const balancePaise = (p: Pick<IPaymentRequest, 'amount' | 'paidPaise'>) => Math.max(0, p.amount - (p.paidPaise || 0));

/**
 * Validates what the MD typed. Money is taken in rupees (2 decimals) or paise,
 * the reference is required for everything except cash, and the payment date
 * cannot be in the future.
 */
export async function sanitizeSettlement(raw: SettlementInput, userId: string): Promise<CleanSettlement> {
  const settlementKey = typeof raw.settlementKey === 'string' ? raw.settlementKey.trim().slice(0, 80) : '';
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(settlementKey)) {
    throw new SettlementError(400, 'Missing payment key. Refresh the page and try again.');
  }

  let amountPaise: number;
  if (raw.amountPaise !== undefined && raw.amountPaise !== null && raw.amountPaise !== '') {
    amountPaise = Number(raw.amountPaise);
  } else {
    const rupees = Number(raw.amountRupees);
    amountPaise = Number.isFinite(rupees) ? Math.round(rupees * 100) : NaN;
  }
  if (!Number.isInteger(amountPaise) || amountPaise < 100) {
    throw new SettlementError(400, 'Enter the amount paid (at least ₹1).');
  }

  const mode = String(raw.mode || '') as SettlementMode;
  if (!MANUAL_MODES.includes(mode)) {
    throw new SettlementError(400, 'Choose how you paid: UPI, bank transfer, cheque or cash.');
  }

  const reference = typeof raw.reference === 'string' ? raw.reference.trim().replace(/\s+/g, '').slice(0, 40) : '';
  if (mode !== 'CASH') {
    if (!reference) {
      throw new SettlementError(
        400,
        mode === 'CHEQUE' ? 'Enter the cheque number.' : 'Enter the UTR / transaction reference from your bank or UPI app.'
      );
    }
    if (!/^[A-Za-z0-9/-]{4,40}$/.test(reference)) {
      throw new SettlementError(400, 'The reference should be 4–40 letters or digits (no spaces or symbols).');
    }
    if (mode === 'UPI' && !/^\d{12}$/.test(reference) && !/^[A-Za-z0-9]{12,35}$/.test(reference)) {
      throw new SettlementError(400, 'A UPI reference (UTR) is usually 12 digits — copy it from the payment receipt in your UPI app.');
    }
  }

  const paidOnStr = typeof raw.paidOn === 'string' ? raw.paidOn.trim() : '';
  const paidOn = paidOnStr ? new Date(paidOnStr.length === 10 ? `${paidOnStr}T12:00:00+05:30` : paidOnStr) : new Date();
  if (Number.isNaN(paidOn.getTime())) throw new SettlementError(400, 'Enter a valid payment date.');
  if (paidOn.getTime() > localDayEnd().getTime()) throw new SettlementError(400, 'The payment date cannot be in the future.');
  if (paidOn.getTime() < Date.now() - 400 * 24 * 3600 * 1000) {
    throw new SettlementError(400, 'The payment date is more than a year ago — check the date.');
  }

  let proofUrl: string | undefined;
  if (raw.proofUrl !== undefined && raw.proofUrl !== null && raw.proofUrl !== '') {
    const filename = extractLocalFilename(raw.proofUrl);
    // Only a file this MD uploaded can be attached as proof
    const owned = filename
      ? await UploadedFile.exists({ filename, uploadedBy: new mongoose.Types.ObjectId(userId) })
      : null;
    if (!owned) throw new SettlementError(400, 'The payment proof file could not be found. Upload it again.');
    proofUrl = String(raw.proofUrl).split('?')[0];
  }

  const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 300) : undefined;

  return {
    settlementKey,
    amountPaise,
    mode,
    reference: reference || undefined,
    // A UTR is unique whether it came from UPI or net banking; cheque numbers are their own series
    referenceKey: reference ? `${mode === 'CHEQUE' ? 'CHQ' : 'TXN'}:${reference.toUpperCase()}` : undefined,
    paidOn,
    proofUrl,
    note,
  };
}

/**
 * Records one payment against the request.
 * - Idempotent on settlementKey (a retried request returns the same result).
 * - Refuses paying more than the balance — checked atomically so two taps
 *   from two devices cannot overpay.
 * - Refuses a UTR / cheque number already recorded elsewhere in the company.
 */
export async function applySettlement(
  paymentId: mongoose.Types.ObjectId | string,
  input: CleanSettlement,
  actor: { userId: string; ip?: string }
): Promise<{ payment: IPaymentRequest; duplicate: boolean; fullyPaid: boolean }> {
  const current = await PaymentRequest.findById(paymentId);
  if (!current) throw new SettlementError(404, 'Payment request not found.');

  // Same key again (double tap / network retry): nothing new to record
  if (current.settlements?.some((s) => s.settlementKey === input.settlementKey)) {
    return { payment: current, duplicate: true, fullyPaid: current.status === 'PAID' };
  }

  if (!PAYABLE_STATUSES.includes(current.status)) {
    throw new SettlementError(
      400,
      current.status === 'PAID'
        ? 'This request is already fully paid.'
        : `A ${current.status.replace(/_/g, ' ').toLowerCase()} request cannot be paid.`
    );
  }

  const balance = balancePaise(current);
  if (input.amountPaise > balance) {
    throw new SettlementError(400, `That is more than the balance due (${formatINR(balance)}).`);
  }

  if (input.referenceKey) {
    const companyScope = current.company ? { company: current.company } : { project: current.project };
    const clash = await PaymentRequest.findOne({
      ...companyScope,
      settlements: { $elemMatch: { referenceKey: input.referenceKey, voided: { $ne: true } } },
    }).select('paymentReference');
    if (clash) {
      throw new SettlementError(
        409,
        `This ${input.mode === 'CHEQUE' ? 'cheque number' : 'UTR'} is already recorded on ${clash.paymentReference}. Check it is not the same payment entered twice.`
      );
    }
  }

  const now = new Date();
  const newPaid = (current.paidPaise || 0) + input.amountPaise;
  const fullyPaid = newPaid >= current.amount;
  const nextStatus = fullyPaid ? 'PAID' : 'PARTIALLY_PAID';
  const label = MODE_LABEL[input.mode];

  const set: Record<string, any> = { status: nextStatus, lastPaidAt: now };
  // Paying is the MD's approval
  if (!current.authorizedBy) {
    set.authorizedBy = actor.userId;
    set.authorizedAt = now;
    set.authorizationNotes = 'Approved by paying';
  }
  if (fullyPaid) set.reconciledAt = now;
  if (input.mode !== 'RAZORPAYX') set.providerName = 'MANUAL';
  if (input.reference && !current.providerUtr) set.providerUtr = input.reference;

  // Atomic guard: only apply if nobody else paid in between (paidPaise unchanged)
  const updated = await PaymentRequest.findOneAndUpdate(
    {
      _id: current._id,
      paidPaise: current.paidPaise || 0,
      status: { $in: PAYABLE_STATUSES },
      'settlements.settlementKey': { $ne: input.settlementKey },
    },
    {
      $set: set,
      $inc: { paidPaise: input.amountPaise },
      $push: {
        settlements: {
          ...input,
          recordedBy: actor.userId,
          recordedAt: now,
        },
        auditTrail: {
          timestamp: now,
          action: fullyPaid ? 'PAYMENT_PAID' : 'PAYMENT_PART_PAID',
          performedBy: actor.userId,
          note: `${formatINR(input.amountPaise)} paid by ${label}${input.reference ? ` (ref ${input.reference})` : ''}. ${
            fullyPaid ? 'Fully paid.' : `Balance ${formatINR(current.amount - newPaid)}.`
          }`,
          ip: actor.ip,
        },
      },
    },
    { new: true }
  );

  if (!updated) {
    // Lost a race: re-read and report what happened
    const fresh = await PaymentRequest.findById(current._id);
    if (fresh?.settlements?.some((s) => s.settlementKey === input.settlementKey)) {
      return { payment: fresh, duplicate: true, fullyPaid: fresh.status === 'PAID' };
    }
    throw new SettlementError(409, 'This request was just updated by someone else. Refresh and check the balance.');
  }

  await syncLinkedExpense(updated);
  return { payment: updated, duplicate: false, fullyPaid };
}

/** Undo a wrongly recorded entry (kept, but no longer counted). */
export async function voidSettlement(
  paymentId: string,
  settlementId: string,
  reason: string,
  actor: { userId: string; ip?: string }
): Promise<IPaymentRequest> {
  const payment = await PaymentRequest.findById(paymentId);
  if (!payment) throw new SettlementError(404, 'Payment request not found.');
  const entry = mongoose.Types.ObjectId.isValid(settlementId) ? (payment.settlements as any).id(settlementId) : null;
  if (!entry) throw new SettlementError(404, 'Payment entry not found.');
  if (entry.voided) throw new SettlementError(400, 'This entry is already undone.');
  if (entry.mode === 'RAZORPAYX') throw new SettlementError(400, 'RazorpayX payouts are reversed by the bank, not here.');

  const now = new Date();
  entry.voided = true;
  entry.voidedBy = actor.userId as any;
  entry.voidedAt = now;
  entry.voidReason = reason;

  payment.paidPaise = payment.settlements.filter((s) => !s.voided).reduce((sum, s) => sum + s.amountPaise, 0);
  payment.status = payment.paidPaise <= 0 ? (payment.authorizedBy ? 'AUTHORIZED' : 'SUBMITTED') : payment.paidPaise >= payment.amount ? 'PAID' : 'PARTIALLY_PAID';
  if (payment.status !== 'PAID') payment.reconciledAt = undefined;
  payment.auditTrail.push({
    timestamp: now,
    action: 'PAYMENT_ENTRY_UNDONE',
    performedBy: actor.userId as any,
    note: `${formatINR(entry.amountPaise)} ${MODE_LABEL[entry.mode as SettlementMode]} entry undone: ${reason}`,
    ip: actor.ip,
  });
  await payment.save();
  await syncLinkedExpense(payment);
  return payment;
}

/** Keeps the linked expense's payment status in step with the request. */
export async function syncLinkedExpense(payment: IPaymentRequest) {
  if (!payment.expense) return;
  if (payment.status === 'PAID') {
    await Expense.findByIdAndUpdate(payment.expense, { paymentStatus: 'PAID', paidAt: payment.lastPaidAt || new Date() });
  } else {
    await Expense.findByIdAndUpdate(payment.expense, { paymentStatus: 'PAYMENT_REQUESTED', $unset: { paidAt: 1 } });
  }
}
