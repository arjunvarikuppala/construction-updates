/**
 * RazorpayX payout lifecycle for a payment request.
 *
 *   payable ──start──▶ PROCESSING (pendingPayout set) ──processed──▶ PAID / PARTIALLY_PAID
 *                                   │                                   │
 *                                   └──failed/rejected──▶ back to the   └──reversed──▶ entry undone,
 *                                        previous status                    back to payable
 *
 * Every update (API response, "check status", webhook) goes through
 * applyPayoutUpdate, which is idempotent: the same event twice changes nothing.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { PaymentRequest, IPaymentRequest } from '../../models/PaymentRequest.js';
import { Beneficiary } from '../../models/Beneficiary.js';
import {
  razorpayXService,
  RazorpayXError,
  PayoutEntity,
  PayoutMode,
  PAYOUT_MODES,
  PAYOUT_LIMITS,
  mapPayoutState,
} from './razorpayXService.js';
import { PAYABLE_STATUSES, SettlementError, balancePaise, syncLinkedExpense } from '../paymentSettlementService.js';

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export type PayoutOutcome = 'paid' | 'pending' | 'failed' | 'reversed' | 'unknown' | 'unchanged';

export interface PayoutResult {
  payment: IPaymentRequest;
  outcome: PayoutOutcome;
  message: string;
  /** Amount that just became paid (for notifications) */
  paidNowPaise?: number;
}

/** Which payout modes this request can use, given the payee details on file. */
export async function availablePayoutModes(payment: IPaymentRequest): Promise<PayoutMode[]> {
  if (payment.payeeKind === 'INCHARGE') return payment.vpaSnapshot ? ['UPI'] : [];
  if (!payment.beneficiary) return [];
  const b = await Beneficiary.findById(payment.beneficiary).select('+accountNumber vpa ifsc');
  if (!b) return [];
  const modes: PayoutMode[] = [];
  if (b.vpa) modes.push('UPI');
  if (b.accountNumber && b.ifsc) modes.push('IMPS', 'NEFT', 'RTGS');
  return modes;
}

/** Finds or creates the RazorpayX contact + fund account to pay into. */
async function resolveFundAccount(payment: IPaymentRequest, mode: PayoutMode): Promise<string> {
  if (payment.payeeKind === 'INCHARGE') {
    if (mode !== 'UPI' || !payment.vpaSnapshot) {
      throw new SettlementError(400, 'This Site In-Charge has no UPI ID on the request. Ask them to add one, or pay them yourself and record it.');
    }
    const contactId = await razorpayXService.createContact({
      name: payment.payeeNameSnapshot,
      type: 'employee',
      referenceId: `user-${String(payment.payeeUser)}`,
    });
    return razorpayXService.createVpaFundAccount(contactId, payment.vpaSnapshot);
  }

  const b = payment.beneficiary ? await Beneficiary.findById(payment.beneficiary).select('+accountNumber') : null;
  if (!b) throw new SettlementError(400, 'This vendor is not saved with UPI or bank details, so RazorpayX cannot pay them.');

  if (!b.razorpayxContactId) {
    b.razorpayxContactId = await razorpayXService.createContact({
      name: b.name,
      type: 'vendor',
      referenceId: `vendor-${String(b._id)}`,
      phone: b.phone,
      email: b.email,
    });
    await b.save();
  }

  if (mode === 'UPI') {
    if (!b.vpa) throw new SettlementError(400, `${b.name} has no UPI ID saved. Choose IMPS / NEFT, or add their UPI ID.`);
    if (!b.razorpayxVpaFundAccountId || b.razorpayxVpaFor !== b.vpa) {
      b.razorpayxVpaFundAccountId = await razorpayXService.createVpaFundAccount(b.razorpayxContactId, b.vpa);
      b.razorpayxVpaFor = b.vpa;
      await b.save();
    }
    return b.razorpayxVpaFundAccountId;
  }

  if (!b.accountNumber || !b.ifsc) throw new SettlementError(400, `${b.name} has no bank account saved. Choose UPI, or add their bank details.`);
  if (!b.razorpayxBankFundAccountId) {
    b.razorpayxBankFundAccountId = await razorpayXService.createBankFundAccount(b.razorpayxContactId, {
      name: b.name,
      ifsc: b.ifsc,
      accountNumber: b.accountNumber,
    });
    await b.save();
  }
  return b.razorpayxBankFundAccountId;
}

/**
 * MD sends money through RazorpayX. Locks the request first so a second click
 * (or a manual "Pay") cannot run alongside it.
 */
export async function startPayout(
  paymentId: string | mongoose.Types.ObjectId,
  input: { amountPaise: number; mode: string },
  actor: { userId: string; ip?: string }
): Promise<PayoutResult> {
  const provider = razorpayXService.status();
  if (!provider.enabled) throw new SettlementError(400, `RazorpayX payouts are not switched on. ${provider.reason || ''}`.trim());

  const payment = await PaymentRequest.findById(paymentId);
  if (!payment) throw new SettlementError(404, 'Payment request not found.');
  if (payment.pendingPayout) throw new SettlementError(409, 'A RazorpayX payout is already in progress for this request. Use "Check status".');
  if (!PAYABLE_STATUSES.includes(payment.status)) {
    throw new SettlementError(400, payment.status === 'PAID' ? 'This request is already fully paid.' : `A ${payment.status.replace(/_/g, ' ').toLowerCase()} request cannot be paid.`);
  }

  const mode = String(input.mode || '').toUpperCase() as PayoutMode;
  if (!PAYOUT_MODES.includes(mode)) throw new SettlementError(400, 'Choose UPI, IMPS, NEFT or RTGS for the payout.');
  const amountPaise = Number(input.amountPaise);
  const balance = balancePaise(payment);
  if (!Number.isInteger(amountPaise) || amountPaise < 100) throw new SettlementError(400, 'Enter the amount to send (at least ₹1).');
  if (amountPaise > balance) throw new SettlementError(400, `That is more than the balance due (${inr(balance)}).`);
  const lim = PAYOUT_LIMITS[mode];
  if (amountPaise < lim.min) throw new SettlementError(400, `${mode} needs at least ${inr(lim.min)}. Use IMPS or NEFT.`);
  if (amountPaise > lim.max) throw new SettlementError(400, `${mode} allows at most ${inr(lim.max)} per payout. Use ${mode === 'UPI' ? 'IMPS / NEFT' : 'NEFT / RTGS'}, or send it in parts.`);

  const modes = await availablePayoutModes(payment);
  if (!modes.includes(mode)) {
    throw new SettlementError(400, mode === 'UPI' ? 'No UPI ID is saved for this payee.' : 'No bank account is saved for this payee.');
  }

  const attempt = (payment.payoutAttempts || 0) + 1;
  const idempotencyKey = `bkr-${String(payment._id)}-${attempt}-${crypto.randomBytes(4).toString('hex')}`;
  const referenceId = `${payment.paymentReference}-${attempt}`.slice(0, 40);
  const prevStatus = payment.status;

  // Lock: only one payout at a time, and only if nobody changed the balance meanwhile
  const locked = await PaymentRequest.findOneAndUpdate(
    { _id: payment._id, pendingPayout: null, paidPaise: payment.paidPaise || 0, status: { $in: PAYABLE_STATUSES } },
    {
      $set: {
        status: 'PROCESSING',
        pendingPayout: {
          idempotencyKey,
          referenceId,
          amountPaise,
          mode,
          fundAccountId: 'pending',
          prevStatus,
          initiatedBy: actor.userId,
          initiatedAt: new Date(),
        },
        payoutAttempts: attempt,
        initiatedBy: actor.userId,
        initiatedAt: new Date(),
        failureReason: undefined,
        ...(payment.authorizedBy ? {} : { authorizedBy: actor.userId, authorizedAt: new Date(), authorizationNotes: 'Approved by paying (RazorpayX)' }),
      },
      $push: {
        auditTrail: {
          timestamp: new Date(),
          action: 'RAZORPAYX_PAYOUT_STARTED',
          performedBy: actor.userId,
          note: `Sending ${inr(amountPaise)} by ${mode} through RazorpayX (${provider.mode} mode)`,
          ip: actor.ip,
        },
      },
    },
    { new: true }
  );
  if (!locked) throw new SettlementError(409, 'This request was just updated by someone else. Refresh and try again.');

  const unlock = async (reason: string) => {
    const back = await PaymentRequest.findOneAndUpdate(
      { _id: payment._id, 'pendingPayout.idempotencyKey': idempotencyKey },
      {
        $set: { status: prevStatus, pendingPayout: null, failureReason: reason },
        $push: { auditTrail: { timestamp: new Date(), action: 'RAZORPAYX_PAYOUT_NOT_SENT', performedBy: actor.userId, note: reason, ip: actor.ip } },
      },
      { new: true }
    );
    return back || locked;
  };

  // 1. Where to send it (contact + fund account). Nothing has been paid yet if this fails.
  let fundAccountId: string;
  try {
    fundAccountId = await resolveFundAccount(locked, mode);
  } catch (err: any) {
    const reason = err instanceof RazorpayXError || err instanceof SettlementError ? err.message : 'Could not prepare the payee in RazorpayX.';
    await unlock(reason);
    throw new SettlementError(err instanceof SettlementError ? err.status : 400, reason);
  }
  await PaymentRequest.updateOne({ _id: payment._id, 'pendingPayout.idempotencyKey': idempotencyKey }, { $set: { 'pendingPayout.fundAccountId': fundAccountId } });

  // 2. Send the payout
  try {
    const payout = await razorpayXService.createPayout({
      fundAccountId,
      amountPaise,
      mode,
      purpose: locked.payeeKind === 'INCHARGE' ? 'payout' : 'vendor bill',
      referenceId,
      narration: `BKR INFRA ${locked.paymentReference}`,
      idempotencyKey,
      notes: {
        paymentId: String(locked._id),
        reference: locked.paymentReference,
        purpose: locked.purpose.slice(0, 200),
      },
    });
    return applyPayoutUpdate(payout, { source: 'api', actorId: actor.userId });
  } catch (err: any) {
    if (err instanceof RazorpayXError && err.isDefinite) {
      // Razorpay refused it outright (bad details, insufficient permissions…): nothing was sent
      const fresh = await unlock(`RazorpayX refused the payout: ${err.message}`);
      return { payment: fresh, outcome: 'failed', message: `RazorpayX refused the payout: ${err.message}` };
    }
    // Timeout / 5xx: the payout may or may not exist. Keep it locked; "Check status" retries safely.
    const fresh = await PaymentRequest.findByIdAndUpdate(
      payment._id,
      {
        $push: {
          auditTrail: {
            timestamp: new Date(),
            action: 'RAZORPAYX_PAYOUT_UNCONFIRMED',
            performedBy: actor.userId,
            note: `${err.message} The payout may have gone through — check its status before paying again.`,
            ip: actor.ip,
          },
        },
      },
      { new: true }
    );
    return {
      payment: fresh!,
      outcome: 'unknown',
      message: 'RazorpayX did not confirm the payout. Do NOT pay again — tap "Check status" in a minute.',
    };
  }
}

/** Find the request a payout belongs to (notes.paymentId, the pending payout, or a recorded entry). */
export async function findPaymentForPayout(payout: PayoutEntity): Promise<IPaymentRequest | null> {
  const byNotes = payout.notes?.paymentId && mongoose.Types.ObjectId.isValid(String(payout.notes.paymentId))
    ? await PaymentRequest.findById(String(payout.notes.paymentId))
    : null;
  if (byNotes) return byNotes;
  return PaymentRequest.findOne({
    $or: [{ 'pendingPayout.payoutId': payout.id }, { 'settlements.settlementKey': `rzpx-${payout.id}` }, { razorpayxPayoutId: payout.id }],
  });
}

/**
 * Apply what RazorpayX says about a payout. Safe to call any number of times
 * with the same data (API response, "check status" and webhooks all land here).
 */
export async function applyPayoutUpdate(
  payout: PayoutEntity,
  ctx: { source: 'api' | 'reconcile' | 'webhook'; actorId?: string }
): Promise<PayoutResult> {
  const payment = await findPaymentForPayout(payout);
  if (!payment) throw new SettlementError(404, 'No payment request matches this payout.');

  const state = mapPayoutState(payout.status);
  const key = `rzpx-${payout.id}`;
  const pending = payment.pendingPayout;
  const isOurPending = Boolean(pending && (pending.payoutId === payout.id || (!pending.payoutId && payout.reference_id === pending.referenceId)));
  const existing = payment.settlements.find((s) => s.settlementKey === key);
  const actor = (ctx.actorId || pending?.initiatedBy || payment.createdBy) as any;
  const reason = payout.status_details?.description || payout.failure_reason || `Payout ${payout.status}`;
  const now = new Date();

  payment.razorpayxPayoutId = payout.id;
  payment.providerTransactionId = payout.id;
  payment.razorpayxStatus = payout.status;
  payment.providerStatus = payout.status;
  if (payout.fees !== undefined) payment.fees = payout.fees;
  if (payout.tax !== undefined) payment.tax = payout.tax;

  if (state === 'processed') {
    if (existing) {
      // Already counted. A later webhook may bring the UTR.
      if (payout.utr && !existing.reference) {
        existing.reference = payout.utr;
        existing.referenceKey = `TXN:${payout.utr.toUpperCase()}`;
        payment.providerUtr = payout.utr;
        await payment.save();
      }
      return { payment, outcome: 'unchanged', message: 'Payout already recorded as paid.' };
    }
    if (!pending || !isOurPending) {
      return { payment, outcome: 'unchanged', message: 'This payout does not match the request any more.' };
    }
    const amount = Math.min(payout.amount, Math.max(0, payment.amount - (payment.paidPaise || 0)));
    payment.settlements.push({
      settlementKey: key,
      amountPaise: amount,
      mode: 'RAZORPAYX',
      reference: payout.utr || undefined,
      referenceKey: payout.utr ? `TXN:${payout.utr.toUpperCase()}` : undefined,
      paidOn: now,
      note: `RazorpayX ${pending.mode} payout ${payout.id}`,
      recordedBy: pending.initiatedBy,
      recordedAt: now,
    } as any);
    payment.paidPaise = (payment.paidPaise || 0) + amount;
    payment.status = payment.paidPaise >= payment.amount ? 'PAID' : 'PARTIALLY_PAID';
    payment.pendingPayout = null;
    payment.lastPaidAt = now;
    payment.providerName = 'RAZORPAYX';
    if (payout.utr) payment.providerUtr = payout.utr;
    if (payment.status === 'PAID') payment.reconciledAt = now;
    payment.failureReason = undefined;
    payment.auditTrail.push({
      timestamp: now,
      action: payment.status === 'PAID' ? 'PAYMENT_PAID' : 'PAYMENT_PART_PAID',
      performedBy: actor,
      note: `RazorpayX ${pending.mode} payout of ${inr(amount)} processed${payout.utr ? ` (UTR ${payout.utr})` : ''} [${ctx.source}]`,
    });
    // Atomic guard against a webhook and "check status" landing together
    const saved = await PaymentRequest.findOneAndUpdate(
      { _id: payment._id, 'settlements.settlementKey': { $ne: key } },
      {
        $set: {
          settlements: payment.settlements,
          paidPaise: payment.paidPaise,
          status: payment.status,
          pendingPayout: null,
          lastPaidAt: now,
          providerName: 'RAZORPAYX',
          providerUtr: payment.providerUtr,
          reconciledAt: payment.reconciledAt,
          failureReason: undefined,
          razorpayxPayoutId: payout.id,
          providerTransactionId: payout.id,
          razorpayxStatus: payout.status,
          providerStatus: payout.status,
          fees: payment.fees,
          tax: payment.tax,
          auditTrail: payment.auditTrail,
        },
      },
      { new: true }
    );
    if (!saved) {
      const fresh = (await PaymentRequest.findById(payment._id))!;
      return { payment: fresh, outcome: 'unchanged', message: 'Payout already recorded as paid.' };
    }
    await syncLinkedExpense(saved);
    return {
      payment: saved,
      outcome: 'paid',
      paidNowPaise: amount,
      message: saved.status === 'PAID' ? `${inr(amount)} sent through RazorpayX. Paid in full.` : `${inr(amount)} sent through RazorpayX. Balance ${inr(balancePaise(saved))}.`,
    };
  }

  if (state === 'pending') {
    if (pending && isOurPending) {
      payment.set('pendingPayout.payoutId', payout.id);
      payment.set('pendingPayout.providerStatus', payout.status);
      payment.status = 'PROCESSING';
      await payment.save();
      const waiting =
        payout.status === 'queued'
          ? 'queued — your RazorpayX balance is too low. Add funds and it will go out automatically.'
          : payout.status === 'pending'
          ? 'waiting for approval in your RazorpayX dashboard.'
          : 'with the bank. It usually completes within minutes.';
      return { payment, outcome: 'pending', message: `Payout sent to RazorpayX and is ${waiting}` };
    }
    return { payment, outcome: 'unchanged', message: `Payout is ${payout.status}.` };
  }

  if (state === 'failed') {
    if (pending && isOurPending) {
      payment.status = pending.prevStatus as any;
      payment.pendingPayout = null;
      payment.failureReason = `RazorpayX payout failed: ${reason}`;
      payment.auditTrail.push({ timestamp: now, action: 'RAZORPAYX_PAYOUT_FAILED', performedBy: actor, note: `${reason} [${ctx.source}]` });
      await payment.save();
      return { payment, outcome: 'failed', message: `The payout failed: ${reason}. Nothing was paid — you can try again or pay another way.` };
    }
    return { payment, outcome: 'unchanged', message: `Payout is ${payout.status}.` };
  }

  // reversed: money came back after being processed
  if (existing && !existing.voided) {
    existing.voided = true;
    existing.voidedAt = now;
    existing.voidedBy = actor;
    existing.voidReason = `Reversed by the bank: ${reason}`;
    payment.paidPaise = payment.settlements.filter((s) => !s.voided).reduce((sum, s) => sum + s.amountPaise, 0);
    payment.status = payment.paidPaise <= 0 ? 'AUTHORIZED' : payment.paidPaise >= payment.amount ? 'PAID' : 'PARTIALLY_PAID';
    payment.reconciledAt = undefined;
    payment.reversalReason = reason;
    payment.reversedAt = now;
    payment.auditTrail.push({ timestamp: now, action: 'RAZORPAYX_PAYOUT_REVERSED', performedBy: actor, note: `${inr(existing.amountPaise)} returned: ${reason}` });
    await payment.save();
    await syncLinkedExpense(payment);
    return { payment, outcome: 'reversed', message: `The bank returned ${inr(existing.amountPaise)}: ${reason}. The balance is due again.` };
  }
  if (pending && isOurPending) {
    payment.status = pending.prevStatus as any;
    payment.pendingPayout = null;
    payment.failureReason = `RazorpayX payout reversed: ${reason}`;
    await payment.save();
    return { payment, outcome: 'failed', message: `The payout was reversed: ${reason}.` };
  }
  return { payment, outcome: 'unchanged', message: `Payout is ${payout.status}.` };
}

/**
 * "Check status": asks RazorpayX about the payout in progress. When the first
 * call never got an answer, re-sends the same request with the same
 * idempotency key — RazorpayX returns the original payout, never a second one.
 */
export async function reconcilePayout(payment: IPaymentRequest, actorId: string): Promise<PayoutResult> {
  if (!razorpayXService.status().enabled) throw new SettlementError(400, 'RazorpayX payouts are not switched on.');
  const pending = payment.pendingPayout;
  try {
    if (pending?.payoutId) {
      return applyPayoutUpdate(await razorpayXService.getPayout(pending.payoutId), { source: 'reconcile', actorId });
    }
    if (pending && pending.fundAccountId && pending.fundAccountId !== 'pending') {
      const payout = await razorpayXService.createPayout({
        fundAccountId: pending.fundAccountId,
        amountPaise: pending.amountPaise,
        mode: pending.mode,
        purpose: payment.payeeKind === 'INCHARGE' ? 'payout' : 'vendor bill',
        referenceId: pending.referenceId,
        narration: `BKR INFRA ${payment.paymentReference}`,
        idempotencyKey: pending.idempotencyKey,
        notes: { paymentId: String(payment._id), reference: payment.paymentReference, purpose: payment.purpose.slice(0, 200) },
      });
      return applyPayoutUpdate(payout, { source: 'reconcile', actorId });
    }
    if (pending) {
      // Failed before anything was sent to RazorpayX
      payment.status = pending.prevStatus as any;
      payment.pendingPayout = null;
      await payment.save();
      return { payment, outcome: 'failed', message: 'The payout never reached RazorpayX. Nothing was paid.' };
    }
    // No payout in progress: re-check the last RazorpayX entry (catches reversals)
    const last = [...payment.settlements].reverse().find((s) => s.mode === 'RAZORPAYX' && !s.voided);
    if (last) {
      return applyPayoutUpdate(await razorpayXService.getPayout(last.settlementKey.replace(/^rzpx-/, '')), { source: 'reconcile', actorId });
    }
    return { payment, outcome: 'unchanged', message: 'There is no RazorpayX payout on this request.' };
  } catch (err: any) {
    if (err instanceof RazorpayXError) {
      throw new SettlementError(err.isDefinite ? 400 : 502, `Could not check with RazorpayX: ${err.message}`);
    }
    throw err;
  }
}
