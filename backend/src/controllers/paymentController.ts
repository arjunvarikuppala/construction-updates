import { Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { AuthenticatedRequest, isMD } from '../types/index.js';
import { PaymentRequest, PaymentRequestStatus, PaymentMethod } from '../models/PaymentRequest.js';
import { Beneficiary, maskAccountNumber } from '../models/Beneficiary.js';
import { Expense } from '../models/Expense.js';
import { Project } from '../models/Project.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { razorpayXService } from '../services/payments/razorpayXService.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { logAudit } from '../services/auditService.js';
import { createNotification, notifyProjectMDs } from '../services/notificationService.js';
import { emitToUser, emitToProjectMDs } from '../services/socketService.js';
import { getAccessibleProjectIds } from '../services/tenantService.js';
import { beneficiaryScopeFilter, getProjectCompanyId } from './beneficiaryController.js';
import { escapeRegex } from '../utils/validation.js';
import { User } from '../models/User.js';
import {
  applySettlement,
  sanitizeSettlement,
  voidSettlement,
  SettlementError,
  balancePaise,
  MODE_LABEL,
  PAYABLE_STATUSES,
} from '../services/paymentSettlementService.js';
import { istMonthString, istMonthWindow } from '../utils/istDates.js';
import { PAYOUT_LIMITS } from '../services/payments/razorpayXService.js';
import {
  startPayout,
  reconcilePayout,
  applyPayoutUpdate,
  availablePayoutModes,
  PayoutResult,
} from '../services/payments/payoutFlow.js';

const HIGH_VALUE_THRESHOLD_PAISE = Number(process.env.PAYMENT_HIGH_VALUE_THRESHOLD_PAISE) || 10000000; // ₹1,00,000

/**
 * Loads a payment request and enforces company/project isolation.
 * - The caller must have access to the payment's project (MD owner or ACTIVE in-charge).
 * - `mdOnly` additionally requires the MD/OWNER role.
 * Callers outside the company receive 404 so payment IDs are not disclosed.
 */
async function loadAuthorizedPayment(
  req: AuthenticatedRequest,
  res: Response,
  opts: { mdOnly: boolean; forbiddenMessage?: string }
) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    res.status(404).json({ success: false, message: 'Payment request not found.' });
    return null;
  }

  if (opts.mdOnly && !isMD(req.user!.role)) {
    res.status(403).json({
      success: false,
      message: opts.forbiddenMessage || 'Only Managing Directors can perform this payment action.',
    });
    return null;
  }

  const payment = await PaymentRequest.findById(id);
  if (!payment) {
    res.status(404).json({ success: false, message: 'Payment request not found.' });
    return null;
  }

  const access = await verifyUserProjectAccess(payment.project, req.user!.userId, req.user!.role);
  if (!access.allowed) {
    res.status(404).json({ success: false, message: 'Payment request not found.' });
    return null;
  }

  return payment;
}

export async function createPaymentRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      projectId,
      beneficiaryId,
      newBeneficiary,
      amountRupees,
      amountPaise: suppliedPaise,
      paymentMethod = 'NEFT',
      purpose,
      description,
      expenseId,
      invoiceUrl,
      requestedPaymentDate,
      inchargeRemarks,
      payeeKind: rawPayeeKind,
      payeeUserId,
      payeeVpa,
      payNow,
    } = req.body;
    const payeeKind = rawPayeeKind === 'INCHARGE' ? 'INCHARGE' : 'VENDOR';
    const callerIsMD = isMD(req.user!.role);

    if (!projectId || !purpose || (!amountRupees && !suppliedPaise)) {
      res.status(400).json({
        success: false,
        message: 'Project ID, payment purpose, and disbursement amount are required.',
      });
      return;
    }

    const accessCheck = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({
        success: false,
        message: 'Forbidden. You do not have permission to create payment requests for this project.',
      });
      return;
    }

    const project = await Project.findById(projectId);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found.' });
      return;
    }

    // Determine and validate integer paise amount
    const amountPaise = suppliedPaise ? Number(suppliedPaise) : Math.round(Number(amountRupees) * 100);
    if (!Number.isInteger(amountPaise) || amountPaise < 100) {
      res.status(400).json({
        success: false,
        message: 'Invalid amount. Minimum payout amount is ₹1.00 (100 paise) and must be an integer paise value.',
      });
      return;
    }

    if (!['NEFT', 'RTGS', 'UPI'].includes(String(paymentMethod))) {
      res.status(400).json({ success: false, message: 'Choose a preferred payment method: UPI, NEFT or RTGS.' });
      return;
    }
    if (typeof purpose !== 'string' || !purpose.trim()) {
      res.status(400).json({ success: false, message: 'Enter what the payment is for.' });
      return;
    }

    const projectCompanyId = getProjectCompanyId(project);
    let beneficiaryDoc: any = null;
    let payeeUserDoc: any = null;
    const cleanPayeeVpa =
      typeof payeeVpa === 'string' && payeeVpa.trim() ? payeeVpa.trim().toLowerCase().slice(0, 100) : undefined;
    if (cleanPayeeVpa && !/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/.test(cleanPayeeVpa)) {
      res.status(400).json({ success: false, message: 'That UPI ID does not look right (example: name@okhdfcbank).' });
      return;
    }

    if (payeeKind === 'INCHARGE') {
      // Money goes to a Site In-Charge of this project (reimbursement or site advance)
      const targetId = callerIsMD ? String(payeeUserId || '') : req.user!.userId;
      if (!mongoose.Types.ObjectId.isValid(targetId)) {
        res.status(400).json({ success: false, message: 'Choose which Site In-Charge receives this payment.' });
        return;
      }
      const targetAccess = await verifyUserProjectAccess(project._id, targetId, 'SITE_INCHARGE');
      payeeUserDoc = targetAccess.allowed ? await User.findById(targetId).select('name email phone role') : null;
      if (!payeeUserDoc) {
        res.status(400).json({ success: false, message: 'That Site In-Charge is not assigned to this project.' });
        return;
      }
    } else if (beneficiaryId) {
      beneficiaryDoc = mongoose.Types.ObjectId.isValid(String(beneficiaryId))
        ? await Beneficiary.findOne({
            $and: [{ _id: beneficiaryId }, await beneficiaryScopeFilter([projectCompanyId])],
          }).select('+accountNumber')
        : null;
      if (!beneficiaryDoc) {
        res.status(404).json({ success: false, message: 'Selected beneficiary record not found.' });
        return;
      }
    } else if (newBeneficiary) {
      if (typeof newBeneficiary.name !== 'string' || !newBeneficiary.name.trim()) {
        res.status(400).json({ success: false, message: 'Beneficiary name is required.' });
        return;
      }
      const cleanAccount = newBeneficiary.accountNumber
        ? String(newBeneficiary.accountNumber).replace(/\s+/g, '').trim()
        : undefined;
      const cleanIFSC = newBeneficiary.ifsc ? String(newBeneficiary.ifsc).trim().toUpperCase() : undefined;
      const cleanVpa = newBeneficiary.vpa ? String(newBeneficiary.vpa).trim().toLowerCase() : undefined;

      beneficiaryDoc = await Beneficiary.create({
        name: newBeneficiary.name.trim(),
        payeeType: ['CONTRACTOR', 'SUPPLIER', 'LABOUR'].includes(newBeneficiary.payeeType) ? newBeneficiary.payeeType : 'CONTRACTOR',
        accountNumber: cleanAccount,
        accountNumberMasked: cleanAccount ? maskAccountNumber(cleanAccount) : undefined,
        ifsc: cleanIFSC,
        bankName: newBeneficiary.bankName || (cleanIFSC ? `${cleanIFSC.slice(0, 4)} Bank` : undefined),
        vpa: cleanVpa,
        phone: newBeneficiary.phone?.trim(),
        email: newBeneficiary.email?.trim(),
        verificationStatus: 'UNVERIFIED',
        createdBy: req.user!.userId,
        company: projectCompanyId,
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Choose who is paid: yourself (Site In-Charge) or a vendor.',
      });
      return;
    }

    // "Pay now" at creation is MD-only, and is validated before anything is saved
    let payNowSettlement: Awaited<ReturnType<typeof sanitizeSettlement>> | null = null;
    if (payNow) {
      if (!callerIsMD) {
        res.status(403).json({ success: false, message: 'Only the MD can record a payment.' });
        return;
      }
      try {
        payNowSettlement = await sanitizeSettlement(payNow, req.user!.userId);
      } catch (e: any) {
        if (e instanceof SettlementError) {
          res.status(e.status).json({ success: false, message: e.message });
          return;
        }
        throw e;
      }
      if (payNowSettlement.amountPaise > amountPaise) {
        res.status(400).json({ success: false, message: 'The amount paid cannot be more than the request amount.' });
        return;
      }
    }

    // Optional Expense Link Verification
    let expenseDoc: any = null;
    if (expenseId) {
      expenseDoc = mongoose.Types.ObjectId.isValid(String(expenseId))
        ? await Expense.findOne({ _id: expenseId, project: project._id })
        : null;
      if (!expenseDoc) {
        res.status(404).json({ success: false, message: 'Referenced expense record not found.' });
        return;
      }
      if (expenseDoc.paymentStatus === 'PAID') {
        res.status(400).json({
          success: false,
          message: 'Referenced expense has already been marked as PAID in a previous transaction.',
        });
        return;
      }
    }

    // Generate unique references
    const paymentReference = `BKR-PAY-${istMonthString().slice(2).replace("-", "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const idempotencyKey = `IDEM-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // Requests the MD raises themselves are already approved by the MD
    const isHighValue = amountPaise > HIGH_VALUE_THRESHOLD_PAISE && !callerIsMD;

    // Status: If high-value, requires authorization -> AWAITING_AUTHORIZATION.
    // Otherwise, submitted by in-charge enters SUBMITTED.
    const initialStatus: PaymentRequestStatus = isHighValue ? 'AWAITING_AUTHORIZATION' : 'SUBMITTED';

    const paymentRequest = await PaymentRequest.create({
      paymentReference,
      idempotencyKey,
      project: project._id,
      expense: expenseDoc?._id,
      beneficiary: beneficiaryDoc?._id,
      payeeKind,
      payeeUser: payeeUserDoc?._id,
      company: projectCompanyId,
      payeeNameSnapshot: payeeUserDoc ? payeeUserDoc.name : beneficiaryDoc.name,
      accountNumberMaskedSnapshot: beneficiaryDoc?.accountNumberMasked,
      ifscSnapshot: beneficiaryDoc?.ifsc,
      bankNameSnapshot: beneficiaryDoc?.bankName,
      vpaSnapshot: cleanPayeeVpa || beneficiaryDoc?.vpa,
      payeeType: payeeUserDoc ? 'SITE_INCHARGE' : beneficiaryDoc.payeeType,
      amount: amountPaise,
      paymentMethod,
      purpose: purpose.trim().slice(0, 300),
      description: typeof description === 'string' ? description.trim().slice(0, 1000) : undefined,
      invoiceUrl: typeof invoiceUrl === 'string' && invoiceUrl.trim() ? invoiceUrl.trim().split('?')[0] : undefined,
      requestedPaymentDate: requestedPaymentDate ? new Date(requestedPaymentDate) : undefined,
      inchargeRemarks: typeof inchargeRemarks === 'string' ? inchargeRemarks.trim().slice(0, 500) : undefined,
      status: callerIsMD && !isHighValue ? 'AUTHORIZED' : initialStatus,
      ...(callerIsMD ? { authorizedBy: req.user!.userId, authorizedAt: new Date(), authorizationNotes: 'Raised by the MD' } : {}),
      requiresHighValueAuth: isHighValue,
      providerName: 'MANUAL',
      paidPaise: 0,
      createdBy: req.user!.userId,
      auditTrail: [
        {
          timestamp: new Date(),
          action: 'PAYMENT_REQUEST_CREATED',
          performedBy: req.user!.userId as any,
          note: isHighValue
            ? `Created payment request of ₹${(amountPaise / 100).toLocaleString('en-IN')}. Requires independent MD authorization (> ₹1,00,000).`
            : `Created payment request of ₹${(amountPaise / 100).toLocaleString('en-IN')}. Placed in review queue.`,
          ip: req.ip,
        },
      ],
    });

    if (expenseDoc) {
      expenseDoc.paymentStatus = 'PAYMENT_REQUESTED';
      expenseDoc.paymentRequestId = paymentRequest._id;
      await expenseDoc.save();
    }

    const formattedINR = `₹${(amountPaise / 100).toLocaleString('en-IN')}`;
    const payeeName = payeeUserDoc ? payeeUserDoc.name : beneficiaryDoc.name;

    // MD raised and paid it in one go
    if (payNowSettlement) {
      const { payment: paid, fullyPaid } = await applySettlement(paymentRequest._id, payNowSettlement, {
        userId: req.user!.userId,
        ip: req.ip,
      });
      await notifyPayee(paid, req.user!.userId, payNowSettlement.amountPaise, fullyPaid);
      await logAudit('PAYMENT_RECORDED', req.user!.userId, 'PAYMENT_REQUEST', paid._id, {
        reference: paid.paymentReference,
        amountPaise: payNowSettlement.amountPaise,
        mode: payNowSettlement.mode,
      });
      res.status(201).json({
        success: true,
        message: fullyPaid ? `Payment of ${formattedINR} to ${payeeName} recorded.` : 'Part payment recorded.',
        payment: paid,
      });
      return;
    }

    if (callerIsMD) {
      // An MD-raised payment for an in-charge: tell them money is coming
      if (payeeUserDoc) {
        await createNotification({
          recipient: payeeUserDoc._id,
          sender: req.user!.userId,
          project: project._id,
          type: 'PAYMENT_REQUEST_AUTHORIZED',
          title: `Payment approved for you (${formattedINR})`,
          message: `The MD approved ${formattedINR} to you for ${purpose.trim()}.`,
          relatedEntity: 'PAYMENT_REQUEST',
          relatedId: paymentRequest._id.toString(),
        });
      }
      await logAudit('PAYMENT_REQUEST_CREATED', req.user!.userId, 'PAYMENT_REQUEST', paymentRequest._id, {
        reference: paymentReference,
        amountPaise,
        projectId: project._id,
      });
      res.status(201).json({ success: true, message: 'Payment added. Pay it whenever you are ready.', payment: paymentRequest });
      return;
    }

    // Notify Managing Directors
    await notifyProjectMDs({
      sender: req.user!.userId,
      project: project._id,
      type: 'PAYMENT_REQUEST_NEW',
      title: isHighValue ? `High-Value Payout Request (${formattedINR})` : `New Payment Request (${formattedINR})`,
      message: `${payeeUserDoc && String(payeeUserDoc._id) === req.user!.userId ? `${payeeUserDoc.name} asked to be paid` : `Payment requested to ${payeeName}`} for ${purpose.trim()}`,
      relatedEntity: 'PAYMENT_REQUEST',
      relatedId: paymentRequest._id.toString(),
      excludeUserId: req.user!.userId,
    });

    await emitToProjectMDs(project._id, 'payment:new', {
      paymentId: paymentRequest._id,
      paymentReference: paymentRequest.paymentReference,
      amountINR: formattedINR,
      projectName: project.name,
    });

    await logAudit('PAYMENT_REQUEST_CREATED', req.user!.userId, 'PAYMENT_REQUEST', paymentRequest._id, {
      reference: paymentReference,
      amountPaise,
      paymentMethod,
      isHighValue,
      projectId: project._id,
    });

    res.status(201).json({
      success: true,
      message: 'Payment request sent to the MD.',
      payment: paymentRequest,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create payment request', error: err.message });
  }
}

export async function listPaymentRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { status, projectId, payeeType, search } = req.query;

    let query: any = {};

    if (status && status !== 'ALL') {
      query.status = status;
    }

    if (payeeType && payeeType !== 'ALL') {
      query.payeeType = payeeType;
    }

    if (projectId) {
      const accessCheck = await verifyUserProjectAccess(String(projectId), req.user!.userId, req.user!.role);
      if (!accessCheck.allowed || !accessCheck.project) {
        res.status(403).json({ success: false, message: 'Forbidden: Access to this project is not permitted.' });
        return;
      }
      query.project = accessCheck.project._id;
    } else {
      // Company isolation: MD -> own projects, In-Charge -> ACTIVE assignments only
      query.project = { $in: await getAccessibleProjectIds(req.user!) };
    }

    if (query.status !== undefined && typeof query.status !== 'string') delete query.status;
    if (query.payeeType !== undefined && typeof query.payeeType !== 'string') delete query.payeeType;

    if (search) {
      const s = escapeRegex(String(search).trim());
      query.$or = [
        { paymentReference: { $regex: s, $options: 'i' } },
        { payeeNameSnapshot: { $regex: s, $options: 'i' } },
        { providerUtr: { $regex: s, $options: 'i' } },
        { purpose: { $regex: s, $options: 'i' } },
        { vpaSnapshot: { $regex: s, $options: 'i' } },
      ];
    }

    const payments = await PaymentRequest.find(query)
      .populate('project', 'name code location budget')
      .populate('expense', 'category description amount vendor date status')
      .populate('createdBy', 'name email role')
      .populate('authorizedBy', 'name email role')
      .populate('initiatedBy', 'name email role')
      .populate('payeeUser', 'name email phone')
      .populate('settlements.recordedBy', 'name')
      .populate('settlements.receivedConfirmedBy', 'name')
      .populate('settlements.voidedBy', 'name')
      .sort({ createdAt: -1 });

    // Aggregate summary metrics
    const allMatching = await PaymentRequest.find({ project: query.project });

    const summary = {
      totalDisbursedPaise: allMatching
        .filter((p) => p.status === 'PAID')
        .reduce((sum, p) => sum + p.amount, 0),
      awaitingAuthCount: allMatching.filter((p) => p.status === 'AWAITING_AUTHORIZATION').length,
      awaitingAuthPaise: allMatching
        .filter((p) => p.status === 'AWAITING_AUTHORIZATION')
        .reduce((sum, p) => sum + p.amount, 0),
      processingPaise: allMatching
        .filter((p) => p.status === 'PROCESSING')
        .reduce((sum, p) => sum + p.amount, 0),
      highValueThresholdPaise: HIGH_VALUE_THRESHOLD_PAISE,
      // RazorpayX bank payouts are only offered when they are really switched on
      payoutsEnabled: razorpayXService.isEnabled,
      payoutsMode: razorpayXService.status().mode,
    };

    res.json({
      success: true,
      count: payments.length,
      summary,
      payments,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to list payment requests', error: err.message });
  }
}

export async function getPaymentRequestById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      res.status(404).json({ success: false, message: 'Payment request not found.' });
      return;
    }

    const payment = await PaymentRequest.findById(id)
      .populate('project', 'name code location budget')
      .populate('expense', 'category description amount vendor date status')
      .populate('beneficiary')
      .populate('createdBy', 'name email role')
      .populate('authorizedBy', 'name email role')
      .populate('initiatedBy', 'name email role')
      .populate('payeeUser', 'name email phone')
      .populate('settlements.recordedBy', 'name')
      .populate('settlements.receivedConfirmedBy', 'name')
      .populate('settlements.voidedBy', 'name')
      .populate('auditTrail.performedBy', 'name email role');

    if (!payment) {
      res.status(404).json({ success: false, message: 'Payment request not found.' });
      return;
    }

    const accessCheck = await verifyUserProjectAccess((payment.project as any)._id, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(404).json({ success: false, message: 'Payment request not found.' });
      return;
    }

    res.json({ success: true, payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch payment request', error: err.message });
  }
}

export async function reviewPaymentRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { remarks, setUnderReview = true } = req.body;

    const payment = await loadAuthorizedPayment(req, res, {
      mdOnly: true,
      forbiddenMessage: 'Only Managing Directors can review payment requests.',
    });
    if (!payment) return;

    if (remarks !== undefined && remarks !== null && typeof remarks !== 'string') {
      res.status(400).json({ success: false, message: 'Remarks must be text.' });
      return;
    }

    if (remarks) payment.mdReviewRemarks = remarks.trim();
    if (setUnderReview && payment.status === 'SUBMITTED') {
      payment.status = 'UNDER_REVIEW';
    }

    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_REVIEWED',
      performedBy: req.user!.userId as any,
      note: remarks || 'Reviewed by Managing Director',
      ip: req.ip,
    });

    await payment.save();

    // Notify requester
    await createNotification({
      recipient: payment.createdBy,
      sender: req.user!.userId,
      project: payment.project,
      type: 'PAYMENT_REQUEST_REVIEW',
      title: 'Payment Request Under Review',
      message: `MD added remarks on ${payment.paymentReference}: ${remarks || 'Review in progress.'}`,
      relatedEntity: 'PAYMENT_REQUEST',
      relatedId: payment._id.toString(),
    });

    emitToUser(payment.createdBy.toString(), 'payment:updated', { paymentId: payment._id, status: payment.status });

    res.json({ success: true, message: 'Review remarks saved', payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to review payment request', error: err.message });
  }
}

export async function authorizePaymentRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { notes } = req.body;

    const payment = await loadAuthorizedPayment(req, res, {
      mdOnly: true,
      forbiddenMessage: 'Unauthorized. Only Managing Directors are permitted to authorize payment disbursements.',
    });
    if (!payment) return;

    // High-value dual authorization enforcement: creator cannot authorize their own high-value payment
    if (payment.requiresHighValueAuth && String(payment.createdBy) === String(req.user!.userId)) {
      res.status(403).json({
        success: false,
        message:
          'Dual-Authorization Policy Enforcement: You created this high-value payment request. Under SiteTrack internal fraud prevention controls, the creator cannot self-approve high-value disbursements. A different Managing Director must authorize this payment.',
      });
      return;
    }

    if (
      payment.status !== 'AWAITING_AUTHORIZATION' &&
      payment.status !== 'SUBMITTED' &&
      payment.status !== 'UNDER_REVIEW' &&
      payment.status !== 'DRAFT'
    ) {
      res.status(400).json({
        success: false,
        message: `Cannot authorize a payment with current status '${payment.status}'.`,
      });
      return;
    }

    payment.status = 'AUTHORIZED';
    payment.authorizedBy = req.user!.userId as any;
    payment.authorizedAt = new Date();
    payment.authorizationNotes = (typeof notes === 'string' && notes.trim()) || 'Authorized by Managing Director';

    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_AUTHORIZED',
      performedBy: req.user!.userId as any,
      note: payment.authorizationNotes,
      ip: req.ip,
    });

    await payment.save();

    // Notify requester
    await createNotification({
      recipient: payment.createdBy,
      sender: req.user!.userId,
      project: payment.project,
      type: 'PAYMENT_REQUEST_AUTHORIZED',
      title: 'Payment Request Authorized',
      message: `Payment ${payment.paymentReference} (₹${(payment.amount / 100).toLocaleString('en-IN')}) was authorized by Managing Director.`,
      relatedEntity: 'PAYMENT_REQUEST',
      relatedId: payment._id.toString(),
    });

    emitToUser(payment.createdBy.toString(), 'payment:updated', { paymentId: payment._id, status: payment.status });

    await logAudit('PAYMENT_AUTHORIZED', req.user!.userId, 'PAYMENT_REQUEST', payment._id, {
      reference: payment.paymentReference,
      amountPaise: payment.amount,
      authorizedBy: req.user!.userId,
    });

    res.json({
      success: true,
      message: 'Payment request authorized successfully. Ready for transfer dispatch.',
      payment,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to authorize payment request', error: err.message });
  }
}

export async function rejectPaymentRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { reason } = req.body;

    const payment = await loadAuthorizedPayment(req, res, {
      mdOnly: true,
      forbiddenMessage: 'Only Managing Directors can reject payment requests.',
    });
    if (!payment) return;

    if (typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ success: false, message: 'Rejection reason is required.' });
      return;
    }

    if ((payment.paidPaise || 0) > 0) {
      res.status(400).json({
        success: false,
        message: 'Money has already been paid on this request. Undo those payment entries first, or leave the balance unpaid.',
      });
      return;
    }

    if (payment.status === 'PAID' || payment.status === 'PROCESSING' || payment.status === 'REVERSED') {
      res.status(400).json({
        success: false,
        message: `Cannot reject payment in '${payment.status}' state. Transfer is already in-flight or completed.`,
      });
      return;
    }

    payment.status = 'REJECTED';
    payment.rejectionReason = reason.trim();

    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_REJECTED',
      performedBy: req.user!.userId as any,
      note: `Rejected by MD: ${reason.trim()}`,
      ip: req.ip,
    });

    await payment.save();

    // Release linked expense if any
    if (payment.expense) {
      await Expense.findByIdAndUpdate(payment.expense, {
        paymentStatus: 'UNPAID',
        paymentRequestId: undefined,
      });
    }

    // Notify requester
    await createNotification({
      recipient: payment.createdBy,
      sender: req.user!.userId,
      project: payment.project,
      type: 'PAYMENT_REQUEST_REJECTED',
      title: 'Payment Request Rejected',
      message: `Payment ${payment.paymentReference} was rejected. Reason: ${reason.trim()}`,
      relatedEntity: 'PAYMENT_REQUEST',
      relatedId: payment._id.toString(),
    });

    emitToUser(payment.createdBy.toString(), 'payment:updated', { paymentId: payment._id, status: payment.status });

    await logAudit('PAYMENT_REJECTED', req.user!.userId, 'PAYMENT_REQUEST', payment._id, {
      reference: payment.paymentReference,
      reason: reason.trim(),
    });

    res.json({ success: true, message: 'Payment request rejected', payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to reject payment request', error: err.message });
  }
}

export async function cancelPaymentRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { reason } = req.body;

    const payment = await loadAuthorizedPayment(req, res, { mdOnly: false });
    if (!payment) return;

    const isCreator = String(payment.createdBy) === String(req.user!.userId);
    const callerIsMD = isMD(req.user!.role);

    if (!isCreator && !callerIsMD) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have permission to cancel this request.' });
      return;
    }

    if ((payment.paidPaise || 0) > 0 || payment.status === 'PARTIALLY_PAID') {
      res.status(400).json({
        success: false,
        message: 'Money has already been paid on this request, so it cannot be cancelled.',
      });
      return;
    }

    if (['PROCESSING', 'PAID', 'REVERSED', 'FAILED', 'CANCELLED', 'REJECTED'].includes(payment.status as string)) {
      res.status(400).json({
        success: false,
        message: `Cannot cancel a payment with status '${payment.status}'. Once submitted to bank, reconciliation is required.`,
      });
      return;
    }

    // Cancelled on purpose: not a failed bank transfer
    payment.status = 'CANCELLED';
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : 'No reason provided';
    payment.failureReason = `Cancelled by user: ${cleanReason}`;
    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_CANCELLED',
      performedBy: req.user!.userId as any,
      note: `Payment cancelled before transfer: ${cleanReason}`,
      ip: req.ip,
    });

    await payment.save();

    if (payment.expense) {
      await Expense.findByIdAndUpdate(payment.expense, {
        paymentStatus: 'UNPAID',
        paymentRequestId: undefined,
      });
    }

    res.json({ success: true, message: 'Payment request cancelled successfully.', payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to cancel payment', error: err.message });
  }
}

export async function parseUpiQr(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { qrString } = req.body;
    if (typeof qrString !== 'string' || !qrString || qrString.length > 2048) {
      res.status(400).json({ success: false, message: 'QR content string is required.' });
      return;
    }

    const parsed = razorpayXService.parseUpiQrString(qrString);
    if (!parsed.isValid) {
      res.status(400).json({
        success: false,
        message: parsed.errorMessage || 'Invalid UPI QR code',
      });
      return;
    }

    res.json({
      success: true,
      data: parsed,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to parse UPI QR', error: err.message });
  }
}

export async function generatePaymentQr(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!isMD(req.user!.role)) {
      res.status(403).json({ success: false, message: 'Only Managing Directors can generate collection QR codes.' });
      return;
    }
    const { amountRupees, amountPaise: suppliedPaise, referenceId, purpose } = req.body;

    const amountPaise = suppliedPaise ? Number(suppliedPaise) : Math.round(Number(amountRupees) * 100);
    if (!Number.isInteger(amountPaise) || amountPaise < 100) {
      res.status(400).json({ success: false, message: 'Valid amount is required.' });
      return;
    }

    const ref = referenceId || `COL-${Date.now().toString().slice(-6)}`;
    if (!process.env.MERCHANT_UPI_VPA) {
      res.status(400).json({ success: false, message: 'Collection QR needs the company UPI ID (MERCHANT_UPI_VPA) set on the server.' });
      return;
    }
    const qrResult = await razorpayXService.createPaymentQr({
      amountPaise,
      referenceId: ref,
      purpose: purpose || 'SiteTrack Project Deposit',
      expiryMinutes: 15,
    });

    res.json({
      success: true,
      qr: qrResult,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to generate payment QR', error: err.message });
  }
}

export async function getPaymentQrStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { qrId } = req.params;
    const qrStatus = await razorpayXService.getPaymentQrStatus(qrId);

    if (!qrStatus) {
      res.status(404).json({ success: false, message: 'QR session not found' });
      return;
    }

    res.json({ success: true, qr: qrStatus });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get QR status', error: err.message });
  }
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Tell the requester and (if different) the in-charge payee that money was paid. */
async function notifyPayee(payment: any, senderId: string, amountPaise: number, fullyPaid: boolean) {
  const recipients = new Set<string>();
  if (String(payment.createdBy) !== senderId) recipients.add(String(payment.createdBy));
  if (payment.payeeUser && String(payment.payeeUser) !== senderId) recipients.add(String(payment.payeeUser));
  const last = payment.settlements[payment.settlements.length - 1];
  const how = last ? `${MODE_LABEL[last.mode as keyof typeof MODE_LABEL]}${last.reference ? ` · ref ${last.reference}` : ''}` : '';
  for (const recipient of recipients) {
    const isPayee = payment.payeeUser && String(payment.payeeUser) === recipient;
    await createNotification({
      recipient,
      sender: senderId,
      project: payment.project,
      type: 'PAYMENT_REQUEST_PAID',
      title: fullyPaid ? `Paid ${inr(amountPaise)}` : `Part payment ${inr(amountPaise)}`,
      message: `${isPayee ? 'The MD paid you' : `The MD paid ${payment.payeeNameSnapshot}`} ${inr(amountPaise)} for ${payment.purpose} (${how}).${
        fullyPaid
          ? payment.settlements.filter((s: any) => !s.voided).length > 1
            ? ` Fully paid (${inr(payment.amount)}).`
            : ''
          : ` Balance ${inr(balancePaise(payment))}.`
      }${isPayee ? ' Please confirm when you receive it.' : ''}`,
      relatedEntity: 'PAYMENT_REQUEST',
      relatedId: payment._id.toString(),
    });
    emitToUser(recipient, 'payment:updated', { paymentId: payment._id, status: payment.status });
  }
}

/**
 * MD approves a request by paying it: records how it was paid (UPI / bank
 * transfer / cheque / cash), the UTR or cheque number, date and proof.
 * Part payments are allowed; the request is PAID once the full amount is in.
 */
export async function payPaymentRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const payment = await loadAuthorizedPayment(req, res, {
      mdOnly: true,
      forbiddenMessage: 'Only the MD can record a payment.',
    });
    if (!payment) return;

    const clean = await sanitizeSettlement(req.body || {}, req.user!.userId);
    const { payment: updated, duplicate, fullyPaid } = await applySettlement(payment._id, clean, {
      userId: req.user!.userId,
      ip: req.ip,
    });

    if (!duplicate) {
      await notifyPayee(updated, req.user!.userId, clean.amountPaise, fullyPaid);
      await logAudit('PAYMENT_RECORDED', req.user!.userId, 'PAYMENT_REQUEST', updated._id, {
        reference: updated.paymentReference,
        amountPaise: clean.amountPaise,
        mode: clean.mode,
        utr: clean.reference,
      });
      await emitToProjectMDs(updated.project, 'payment:updated', { paymentId: updated._id, status: updated.status });
    }

    res.json({
      success: true,
      message: duplicate
        ? 'This payment was already recorded.'
        : fullyPaid
        ? `Paid in full. ${updated.payeeNameSnapshot} has been notified.`
        : `Part payment recorded. Balance ${inr(balancePaise(updated))}.`,
      payment: updated,
    });
  } catch (err: any) {
    if (err instanceof SettlementError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    res.status(500).json({ success: false, message: 'Could not record the payment', error: err.message });
  }
}

/** MD undoes a wrongly entered payment (the entry is kept, marked as undone). */
export async function voidPaymentEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const payment = await loadAuthorizedPayment(req, res, {
      mdOnly: true,
      forbiddenMessage: 'Only the MD can undo a payment entry.',
    });
    if (!payment) return;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
    if (!reason) {
      res.status(400).json({ success: false, message: 'Say why this entry is being undone.' });
      return;
    }
    const updated = await voidSettlement(String(payment._id), String(req.params.settlementId), reason, {
      userId: req.user!.userId,
      ip: req.ip,
    });
    await logAudit('PAYMENT_ENTRY_UNDONE', req.user!.userId, 'PAYMENT_REQUEST', updated._id, {
      reference: updated.paymentReference,
      settlementId: req.params.settlementId,
      reason,
    });
    emitToUser(String(updated.createdBy), 'payment:updated', { paymentId: updated._id, status: updated.status });
    res.json({ success: true, message: `Entry undone. Balance now ${inr(balancePaise(updated))}.`, payment: updated });
  } catch (err: any) {
    if (err instanceof SettlementError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    res.status(500).json({ success: false, message: 'Could not undo the entry', error: err.message });
  }
}

/** The In-Charge who was paid confirms the money reached them. */
export async function confirmPaymentReceived(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const payment = await loadAuthorizedPayment(req, res, { mdOnly: false });
    if (!payment) return;
    const me = req.user!.userId;
    const isPayee = payment.payeeUser ? String(payment.payeeUser) === me : false;
    if (!isPayee) {
      res.status(403).json({ success: false, message: 'Only the Site In-Charge who was paid can confirm receipt.' });
      return;
    }
    const entry = mongoose.Types.ObjectId.isValid(String(req.params.settlementId))
      ? (payment.settlements as any).id(String(req.params.settlementId))
      : null;
    if (!entry || entry.voided) {
      res.status(404).json({ success: false, message: 'Payment entry not found.' });
      return;
    }
    if (!entry.receivedConfirmedAt) {
      entry.receivedConfirmedAt = new Date();
      entry.receivedConfirmedBy = me as any;
      payment.auditTrail.push({
        timestamp: new Date(),
        action: 'PAYMENT_RECEIPT_CONFIRMED',
        performedBy: me as any,
        note: `Receipt of ${inr(entry.amountPaise)} confirmed by payee`,
        ip: req.ip,
      });
      await payment.save();
      await notifyProjectMDs({
        sender: me,
        project: payment.project,
        type: 'PAYMENT_REQUEST_PAID',
        title: `Received ${inr(entry.amountPaise)}`,
        message: `${payment.payeeNameSnapshot} confirmed receiving ${inr(entry.amountPaise)} for ${payment.purpose}.`,
        relatedEntity: 'PAYMENT_REQUEST',
        relatedId: payment._id.toString(),
        excludeUserId: me,
      });
      await emitToProjectMDs(payment.project, 'payment:updated', { paymentId: payment._id, status: payment.status });
    }
    res.json({ success: true, message: 'Thanks — receipt confirmed.', payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Could not confirm receipt', error: err.message });
  }
}

/**
 * Payment summary for the dashboard: what is waiting, the balance on part-paid
 * requests, what was paid this month, split by site and by payee kind.
 */
export async function getPaymentSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const projectIds = await getAccessibleProjectIds(req.user!);
    const month = typeof req.query.month === 'string' && istMonthWindow(req.query.month) ? req.query.month : istMonthString();
    const win = istMonthWindow(month)!;
    const all = await PaymentRequest.find({ project: { $in: projectIds } })
      .select('project status amount paidPaise settlements payeeKind requestedPaymentDate createdAt')
      .populate('project', 'name code')
      .lean();

    const awaiting = all.filter((p) => ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_AUTHORIZATION', 'AUTHORIZED'].includes(p.status));
    const partial = all.filter((p) => p.status === 'PARTIALLY_PAID');
    const inWindow = (d: any) => d && new Date(d) >= win.from && new Date(d) < win.to;

    const bySite = new Map<string, { project: any; paidPaise: number; duePaise: number }>();
    let paidThisMonth = 0;
    let paidToInCharges = 0;
    let paidToVendors = 0;
    let unconfirmed = 0;
    for (const p of all as any[]) {
      const key = String(p.project?._id || p.project);
      const site = bySite.get(key) || { project: p.project, paidPaise: 0, duePaise: 0 };
      if (PAYABLE_STATUSES.includes(p.status)) site.duePaise += Math.max(0, p.amount - (p.paidPaise || 0));
      for (const s of p.settlements || []) {
        if (s.voided) continue;
        if (p.payeeKind === 'INCHARGE' && !s.receivedConfirmedAt) unconfirmed += 1;
        if (!inWindow(s.paidOn)) continue;
        paidThisMonth += s.amountPaise;
        site.paidPaise += s.amountPaise;
        if (p.payeeKind === 'INCHARGE') paidToInCharges += s.amountPaise;
        else paidToVendors += s.amountPaise;
      }
      bySite.set(key, site);
    }
    const dueSoonCutoff = Date.now() + 7 * 24 * 3600 * 1000;

    res.json({
      success: true,
      month,
      summary: {
        awaitingCount: awaiting.length,
        awaitingPaise: awaiting.reduce((s, p) => s + p.amount - (p.paidPaise || 0), 0),
        partialCount: partial.length,
        partialBalancePaise: partial.reduce((s, p) => s + p.amount - (p.paidPaise || 0), 0),
        dueThisWeekCount: [...awaiting, ...partial].filter(
          (p) => p.requestedPaymentDate && new Date(p.requestedPaymentDate).getTime() <= dueSoonCutoff
        ).length,
        paidThisMonthPaise: paidThisMonth,
        paidToInChargesPaise: paidToInCharges,
        paidToVendorsPaise: paidToVendors,
        unconfirmedReceipts: unconfirmed,
        bySite: Array.from(bySite.values())
          .filter((s) => s.paidPaise > 0 || s.duePaise > 0)
          .sort((a, b) => b.paidPaise + b.duePaise - (a.paidPaise + a.duePaise)),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Could not load the payment summary', error: err.message });
  }
}

/** MD: every payment made in a month (one row per payment entry), as Excel. */
export async function exportPaymentsRegister(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!isMD(req.user!.role)) {
      res.status(403).json({ success: false, message: 'Only the MD can download the payments register.' });
      return;
    }
    const month = String(req.query.month || '');
    const win = istMonthWindow(month);
    if (!win) {
      res.status(400).json({ success: false, message: 'Choose a month in YYYY-MM format.' });
      return;
    }
    const ExcelJS = (await import('exceljs')).default;
    const payments = await PaymentRequest.find({
      project: { $in: await getAccessibleProjectIds(req.user!) },
      'settlements.paidOn': { $gte: win.from, $lt: win.to },
    })
      .populate('project', 'name code')
      .populate('settlements.recordedBy', 'name')
      .lean();

    const rows: any[] = [];
    for (const p of payments as any[]) {
      for (const s of p.settlements || []) {
        const d = new Date(s.paidOn);
        if (d < win.from || d >= win.to) continue;
        rows.push({ p, s, d });
      }
    }
    rows.sort((a, b) => a.d.getTime() - b.d.getTime());

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BKR INFRA';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(`Payments ${month}`);
    sheet.addRow(['BKR INFRA — Payments register']).font = { bold: true, size: 13 };
    sheet.addRow([`Month: ${month}`, '', `Generated: ${new Date().toISOString().slice(0, 10)}`]);
    sheet.addRow([]);
    const header = sheet.addRow([
      'Paid on', 'Request ref', 'Site', 'Paid to', 'Payee type', 'Purpose', 'Mode', 'UTR / Cheque no.',
      'Amount (₹)', 'Request total (₹)', 'Balance after (₹)', 'Receipt confirmed', 'Recorded by', 'Proof', 'Status',
    ]);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF142B4A' } };
    [12, 24, 22, 24, 14, 32, 14, 22, 14, 16, 16, 16, 18, 8, 18].forEach((w, i) => (sheet.getColumn(i + 1).width = w));

    let total = 0;
    let totalVoided = 0;
    for (const { p, s, d } of rows) {
      const paidUpTo = (p.settlements || [])
        .filter((x: any) => !x.voided && new Date(x.recordedAt) <= new Date(s.recordedAt))
        .reduce((sum: number, x: any) => sum + x.amountPaise, 0);
      if (s.voided) totalVoided += s.amountPaise;
      else total += s.amountPaise;
      const row = sheet.addRow([
        new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10),
        p.paymentReference,
        p.project ? `${p.project.code} – ${p.project.name}` : '',
        p.payeeNameSnapshot,
        p.payeeKind === 'INCHARGE' ? 'Site In-Charge' : p.payeeType || 'Vendor',
        p.purpose,
        MODE_LABEL[s.mode as keyof typeof MODE_LABEL] || s.mode,
        s.reference || (s.mode === 'CASH' ? 'Cash' : ''),
        s.amountPaise / 100,
        p.amount / 100,
        s.voided ? '' : Math.max(0, p.amount - paidUpTo) / 100,
        p.payeeKind === 'INCHARGE' ? (s.receivedConfirmedAt ? 'Yes' : 'Not yet') : '—',
        s.recordedBy?.name || '',
        s.proofUrl ? 'Yes' : 'No',
        s.voided ? `UNDONE: ${s.voidReason || ''}` : 'Paid',
      ]);
      if (s.voided) row.font = { strike: true, color: { argb: 'FF94A3B8' } };
    }
    sheet.addRow([]);
    sheet.addRow(['TOTAL PAID', `${rows.filter((r) => !r.s.voided).length} payment(s)`, '', '', '', '', '', '', total / 100]).font = { bold: true };
    if (totalVoided) sheet.addRow(['Undone entries (not counted)', '', '', '', '', '', '', '', totalVoided / 100]).font = { italic: true };
    [9, 10, 11].forEach((c) => (sheet.getColumn(c).numFmt = '#,##0.00'));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="BKR-INFRA-Payments-${month}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to export payments register' });
  }
}

/**
 * MD sends money through RazorpayX (UPI / IMPS / NEFT / RTGS), in full or part.
 * Body: { amountRupees | amountPaise, mode }
 */
export async function initiatePaymentTransfer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const payment = await loadAuthorizedPayment(req, res, {
      mdOnly: true,
      forbiddenMessage: 'Only the MD can send a RazorpayX payout.',
    });
    if (!payment) return;

    const body = req.body || {};
    const amountPaise =
      body.amountPaise !== undefined && body.amountPaise !== ''
        ? Number(body.amountPaise)
        : body.amountRupees !== undefined && body.amountRupees !== ''
        ? Math.round(Number(body.amountRupees) * 100)
        : balancePaise(payment);
    const mode = String(body.mode || payment.paymentMethod || '').toUpperCase();

    const result = await startPayout(payment._id, { amountPaise, mode }, { userId: req.user!.userId, ip: req.ip });
    await afterPayoutUpdate(result, req.user!.userId);
    await logAudit('RAZORPAYX_PAYOUT', req.user!.userId, 'PAYMENT_REQUEST', payment._id, {
      reference: payment.paymentReference,
      amountPaise,
      mode,
      outcome: result.outcome,
    });

    res.status(result.outcome === 'failed' ? 400 : 200).json({
      success: result.outcome !== 'failed',
      outcome: result.outcome,
      message: result.message,
      payment: result.payment,
    });
  } catch (err: any) {
    if (err instanceof SettlementError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    res.status(500).json({ success: false, message: 'Could not send the payout', error: err.message });
  }
}

/** "Check status" of the RazorpayX payout on a request (also picks up reversals). */
export async function reconcilePayment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const payment = await loadAuthorizedPayment(req, res, {
      mdOnly: true,
      forbiddenMessage: 'Only the MD can check payout status.',
    });
    if (!payment) return;
    const result = await reconcilePayout(payment, req.user!.userId);
    await afterPayoutUpdate(result, req.user!.userId);
    res.json({ success: true, outcome: result.outcome, message: result.message, payment: result.payment });
  } catch (err: any) {
    if (err instanceof SettlementError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    res.status(500).json({ success: false, message: 'Could not check the payout status', error: err.message });
  }
}

/** Notifications after a payout changes state. */
async function afterPayoutUpdate(result: PayoutResult, actorId: string) {
  const p: any = result.payment;
  if (result.outcome === 'paid' && result.paidNowPaise) {
    await notifyPayee(p, actorId, result.paidNowPaise, p.status === 'PAID');
  }
  if (['paid', 'failed', 'reversed', 'pending'].includes(result.outcome)) {
    await emitToProjectMDs(p.project, 'payment:updated', { paymentId: p._id, status: p.status });
    emitToUser(String(p.createdBy), 'payment:updated', { paymentId: p._id, status: p.status });
  }
  if (result.outcome === 'failed' || result.outcome === 'reversed') {
    await notifyProjectMDs({
      sender: actorId,
      project: p.project,
      type: 'PAYMENT_REQUEST_REVIEW',
      title: result.outcome === 'reversed' ? 'Payout returned by the bank' : 'RazorpayX payout failed',
      message: `${p.paymentReference} to ${p.payeeNameSnapshot}: ${result.message}`,
      relatedEntity: 'PAYMENT_REQUEST',
      relatedId: String(p._id),
    });
  }
}

/** RazorpayX setup status for the MD (never exposes keys). */
export async function getPayoutProviderStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!isMD(req.user!.role)) {
    res.status(403).json({ success: false, message: 'Only the MD can view payout settings.' });
    return;
  }
  const status = razorpayXService.status();
  const acct = razorpayXService.accountNumber;
  res.json({
    success: true,
    provider: {
      ...status,
      accountNumberHint: acct ? `•••• ${acct.slice(-4)}` : null,
      webhookPath: '/api/v1/payments/webhook',
      webhookEvents: ['payout.processed', 'payout.reversed', 'payout.failed', 'payout.rejected', 'payout.updated', 'fund_account.validation.completed', 'fund_account.validation.failed'],
    },
  });
}

/** Payout options for one request: which modes the payee supports. */
export async function getPayoutOptions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const payment = await loadAuthorizedPayment(req, res, { mdOnly: true });
    if (!payment) return;
    const status = razorpayXService.status();
    res.json({
      success: true,
      enabled: status.enabled,
      mode: status.mode,
      reason: status.reason,
      modes: status.enabled ? await availablePayoutModes(payment) : [],
      limits: PAYOUT_LIMITS,
      balancePaise: balancePaise(payment),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Could not load payout options', error: err.message });
  }
}

/**
 * RazorpayX webhook. Razorpay signs the exact raw body (X-Razorpay-Signature)
 * and sends the event id in the X-Razorpay-Event-Id header. Duplicate events
 * are ignored; every payout event goes through the same idempotent update.
 */
export async function handlePaymentWebhook(req: any, res: Response): Promise<void> {
  try {
    const signature = String(req.headers['x-razorpay-signature'] || '');
    const rawBody: Buffer = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    if (!razorpayXService.verifyWebhookSignature(rawBody, signature)) {
      res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
      return;
    }

    const event = req.body || {};
    const eventType = String(event.event || '');
    const eventId = String(
      req.headers['x-razorpay-event-id'] ||
        event.event_id ||
        event.id ||
        crypto.createHash('sha256').update(rawBody).digest('hex')
    );
    if (!eventType) {
      res.status(400).json({ success: false, message: 'Webhook event type is missing.' });
      return;
    }

    const existing = await WebhookEvent.findOne({ eventId });
    if (existing?.processed) {
      res.status(200).json({ success: true, message: 'Duplicate webhook ignored.' });
      return;
    }
    const record =
      existing ||
      (await WebhookEvent.create({ eventId, provider: 'RAZORPAYX', eventType, payload: event, signature, processed: false }));

    let note = 'ignored';
    let retryable = false;
    const payout = event.payload?.payout?.entity;
    const validation = event.payload?.fund_account_validation?.entity || event.payload?.fund_account?.validation?.entity;

    if (eventType.startsWith('payout.') && payout?.id) {
      try {
        const result = await applyPayoutUpdate(payout, { source: 'webhook' });
        await afterPayoutUpdate(result, String((result.payment as any).initiatedBy || result.payment.createdBy));
        note = `${result.outcome}: ${result.message}`;
      } catch (err: any) {
        // A payout we do not know (e.g. made from the RazorpayX dashboard) is not an error
        if (err instanceof SettlementError) {
          note = err.message;
        } else {
          // Unexpected failure (e.g. database hiccup): leave the event unprocessed so Razorpay retries it
          note = `error: ${err.message}`;
          retryable = true;
        }
      }
    } else if (eventType.startsWith('fund_account.validation') && validation?.id) {
      const b = await Beneficiary.findOne({ pennyDropValidationId: validation.id });
      if (b) {
        const ok = validation.status === 'completed' && validation.results?.account_status === 'active';
        b.verificationStatus = ok ? 'VERIFIED' : 'FAILED';
        if (validation.results?.registered_name) b.verifiedName = validation.results.registered_name;
        b.verificationDetails = {
          accountExists: ok,
          providerRef: validation.id,
          verifiedAt: new Date(),
          failureReason: ok ? undefined : validation.results?.account_status || validation.status,
        };
        await b.save();
        note = `beneficiary ${b._id} ${b.verificationStatus}`;
      }
    }

    if (retryable) {
      record.error = note;
      await record.save();
      res.status(500).json({ success: false, message: 'Webhook error' });
      return;
    }
    record.processed = true;
    record.processedAt = new Date();
    record.error = undefined;
    await record.save();
    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (err: any) {
    // 5xx makes Razorpay retry later
    res.status(500).json({ success: false, message: 'Webhook error' });
  }
}
