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
    } = req.body;

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

    // Payment method limits
    if (paymentMethod === 'RTGS' && amountPaise < 20000000) {
      res.status(400).json({
        success: false,
        message: 'RBI Regulation: RTGS requires a minimum transaction amount of ₹2,00,000. Please select NEFT or UPI.',
      });
      return;
    }

    if (paymentMethod === 'UPI' && amountPaise > 10000000) {
      res.status(400).json({
        success: false,
        message: 'UPI Restriction: Standard UPI disbursements are capped at ₹1,00,000 maximum. Please select NEFT or RTGS.',
      });
      return;
    }

    // Resolve or create beneficiary
    let beneficiaryDoc: any = null;
    const projectCompanyId = getProjectCompanyId(project);
    if (beneficiaryId) {
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
        payeeType: newBeneficiary.payeeType || 'CONTRACTOR',
        accountNumber: cleanAccount,
        accountNumberMasked: cleanAccount ? maskAccountNumber(cleanAccount) : undefined,
        ifsc: cleanIFSC,
        bankName: newBeneficiary.bankName || (cleanIFSC ? `${cleanIFSC.slice(0, 4)} Bank` : 'Bank Account'),
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
        message: 'Please select an existing beneficiary or provide payee details.',
      });
      return;
    }

    // If method is UPI, verify beneficiary has VPA
    if (paymentMethod === 'UPI' && !beneficiaryDoc.vpa) {
      res.status(400).json({
        success: false,
        message: 'The selected beneficiary does not have a UPI ID (VPA) registered. Please select NEFT or update payee UPI details.',
      });
      return;
    }

    // If method is NEFT/RTGS, verify account & IFSC
    if ((paymentMethod === 'NEFT' || paymentMethod === 'RTGS') && (!beneficiaryDoc.accountNumber || !beneficiaryDoc.ifsc)) {
      res.status(400).json({
        success: false,
        message: 'Bank account number and IFSC code are required for NEFT/RTGS transfers.',
      });
      return;
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
    const paymentReference = `PAY-RZPX-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const idempotencyKey = `IDEM-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const isHighValue = amountPaise > HIGH_VALUE_THRESHOLD_PAISE;

    // Status: If high-value, requires authorization -> AWAITING_AUTHORIZATION.
    // Otherwise, submitted by in-charge enters SUBMITTED.
    const initialStatus: PaymentRequestStatus = isHighValue ? 'AWAITING_AUTHORIZATION' : 'SUBMITTED';

    const paymentRequest = await PaymentRequest.create({
      paymentReference,
      idempotencyKey,
      project: project._id,
      expense: expenseDoc?._id,
      beneficiary: beneficiaryDoc._id,
      payeeNameSnapshot: beneficiaryDoc.name,
      accountNumberMaskedSnapshot: beneficiaryDoc.accountNumberMasked,
      ifscSnapshot: beneficiaryDoc.ifsc,
      bankNameSnapshot: beneficiaryDoc.bankName,
      vpaSnapshot: beneficiaryDoc.vpa,
      payeeType: beneficiaryDoc.payeeType,
      amount: amountPaise,
      paymentMethod,
      purpose: purpose.trim(),
      description: description?.trim(),
      invoiceUrl: invoiceUrl?.trim(),
      requestedPaymentDate: requestedPaymentDate ? new Date(requestedPaymentDate) : undefined,
      inchargeRemarks: inchargeRemarks?.trim(),
      status: initialStatus,
      requiresHighValueAuth: isHighValue,
      providerName: 'RAZORPAYX',
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

    // Notify Managing Directors
    const formattedINR = `₹${(amountPaise / 100).toLocaleString('en-IN')}`;
    await notifyProjectMDs({
      sender: req.user!.userId,
      project: project._id,
      type: 'PAYMENT_REQUEST_NEW',
      title: isHighValue ? `High-Value Payout Request (${formattedINR})` : `New Payment Request (${formattedINR})`,
      message: `${req.user!.email} requested ${paymentMethod} payout to ${beneficiaryDoc.name} for ${purpose}`,
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
      message: isHighValue
        ? 'High-value payment request submitted. Awaiting dual-authorization by Managing Director.'
        : 'Payment request submitted successfully for review.',
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

export async function initiatePaymentTransfer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const payment = await loadAuthorizedPayment(req, res, {
      mdOnly: true,
      forbiddenMessage: 'Only Managing Directors can initiate bank payouts.',
    });
    if (!payment) return;

    // Rejected / failed / reversed requests can never be dispatched
    if (['REJECTED', 'FAILED', 'REVERSED'].includes(payment.status as string)) {
      res.status(400).json({ success: false, message: `Cannot initiate a payment with status '${payment.status}'.` });
      return;
    }

    await payment.populate('beneficiary');

    // Enforce High-Value Authorization Guard
    if (payment.requiresHighValueAuth && payment.status !== 'AUTHORIZED') {
      res.status(400).json({
        success: false,
        message:
          'Security Block: This payment exceeds ₹1,00,000 and requires explicit independent authorization (status must be AUTHORIZED) before transfer can be initiated.',
      });
      return;
    }

    // Enforce Terminal / In-Flight Status Guards ("Never retry potentially completed transfer")
    if (payment.status === 'PAID') {
      res.status(400).json({ success: false, message: 'This payment has already been settled and paid.' });
      return;
    }

    if (payment.status === 'PROCESSING') {
      res.status(400).json({
        success: false,
        message:
          'Payment is currently PROCESSING in the banking cycle. To prevent duplicate fund debit, transfers must not be re-initiated without first querying status reconciliation.',
      });
      return;
    }

    const beneficiary = payment.beneficiary as any;
    if (!beneficiary) {
      res.status(400).json({ success: false, message: 'Beneficiary record is missing.' });
      return;
    }

    // Set to PROCESSING
    payment.status = 'PROCESSING';
    payment.initiatedBy = req.user!.userId as any;
    payment.initiatedAt = new Date();
    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_DISPATCHED_TO_PROVIDER',
      performedBy: req.user!.userId as any,
      note: `Dispatching ${payment.paymentMethod} transfer via RazorpayX Payouts API`,
      ip: req.ip,
    });
    await payment.save();

    // Call RazorpayX Service
    const result = await razorpayXService.createPayout({
      paymentReference: payment.paymentReference,
      idempotencyKey: payment.idempotencyKey,
      amountPaise: payment.amount,
      mode: payment.paymentMethod,
      purpose: payment.purpose,
      beneficiary,
      projectId: payment.project.toString(),
    });

    payment.status = result.status;
    payment.razorpayxStatus = result.razorpayxStatus;
    payment.providerStatus = result.razorpayxStatus;
    if (result.payoutId) {
      payment.razorpayxPayoutId = result.payoutId;
      payment.providerTransactionId = result.payoutId;
    }
    if (result.utr) {
      payment.providerUtr = result.utr;
    }
    if (result.fees !== undefined) payment.fees = result.fees;
    if (result.tax !== undefined) payment.tax = result.tax;
    if (result.failureReason) payment.failureReason = result.failureReason;

    if (result.status === 'PAID') {
      payment.reconciledAt = new Date();
      if (payment.expense) {
        await Expense.findByIdAndUpdate(payment.expense, {
          paymentStatus: 'PAID',
          paidAt: new Date(),
        });
      }
    }

    payment.auditTrail.push({
      timestamp: new Date(),
      action: `PAYMENT_${result.status}`,
      performedBy: req.user!.userId as any,
      note: `RazorpayX response: ${result.razorpayxStatus}. UTR: ${result.utr || 'N/A'}. ${result.failureReason || ''}`,
      ip: req.ip,
    });

    await payment.save();

    // Notify requester
    await createNotification({
      recipient: payment.createdBy,
      sender: req.user!.userId,
      project: payment.project,
      type: result.status === 'PAID' ? 'PAYMENT_REQUEST_PAID' : 'PAYMENT_REQUEST_REVIEW',
      title: result.status === 'PAID' ? 'Payment Completed & Settled' : `Payment Status: ${result.status}`,
      message: result.status === 'PAID'
        ? `Payment ${payment.paymentReference} settled successfully! UTR: ${result.utr}`
        : `Payment ${payment.paymentReference} is now ${result.status}.`,
      relatedEntity: 'PAYMENT_REQUEST',
      relatedId: payment._id.toString(),
    });

    emitToUser(payment.createdBy.toString(), 'payment:updated', { paymentId: payment._id, status: payment.status });

    res.json({
      success: result.success,
      message: result.status === 'PAID'
        ? `Payout completed successfully. UTR: ${result.utr}`
        : result.status === 'PROCESSING'
        ? 'Payout submitted to RazorpayX and is processing in clearing cycle.'
        : `Payout dispatch: ${result.failureReason || result.status}`,
      payment,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Transfer initiation failed', error: err.message });
  }
}

export async function reconcilePayment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const payment = await loadAuthorizedPayment(req, res, {
      mdOnly: true,
      forbiddenMessage: 'Only Managing Directors can reconcile payouts.',
    });
    if (!payment) return;

    const payoutId = payment.razorpayxPayoutId || payment.providerTransactionId;
    if (!payoutId) {
      res.status(400).json({ success: false, message: 'Cannot reconcile: no provider payout ID exists yet.' });
      return;
    }

    const result = await razorpayXService.getPayout(payoutId, payment.paymentReference);

    payment.status = result.status;
    payment.razorpayxStatus = result.razorpayxStatus;
    payment.providerStatus = result.razorpayxStatus;
    if (result.utr) payment.providerUtr = result.utr;
    if (result.fees !== undefined) payment.fees = result.fees;
    if (result.tax !== undefined) payment.tax = result.tax;
    if (result.failureReason) payment.failureReason = result.failureReason;

    if (result.status === 'PAID') {
      payment.reconciledAt = new Date();
      if (payment.expense) {
        await Expense.findByIdAndUpdate(payment.expense, {
          paymentStatus: 'PAID',
          paidAt: new Date(),
        });
      }
    } else if (result.status === 'REVERSED') {
      payment.reversalReason = 'Reversed by clearing network';
      payment.reversedAt = new Date();
      if (payment.expense) {
        await Expense.findByIdAndUpdate(payment.expense, { paymentStatus: 'UNPAID' });
      }
    }

    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_RECONCILED',
      performedBy: req.user!.userId as any,
      note: `Reconciled status with RazorpayX: ${result.status}. UTR: ${result.utr || 'N/A'}`,
      ip: req.ip,
    });

    await payment.save();

    res.json({
      success: true,
      message: `Status reconciled: ${payment.status} (UTR: ${payment.providerUtr || 'N/A'})`,
      payment,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Reconciliation query failed', error: err.message });
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

    if (['PROCESSING', 'PAID', 'REVERSED', 'FAILED', 'REJECTED'].includes(payment.status as string)) {
      res.status(400).json({
        success: false,
        message: `Cannot cancel a payment with status '${payment.status}'. Once submitted to bank, reconciliation is required.`,
      });
      return;
    }

    payment.status = 'FAILED';
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

export async function handlePaymentWebhook(req: any, res: Response): Promise<void> {
  try {
    const signature = (req.headers['x-razorpay-signature'] ||
      req.headers['x-webhook-signature'] ||
      req.headers['x-signature'] ||
      '') as string;

    const rawBodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));

    // Signature is mandatory in every environment. Without a configured secret
    // verification fails closed and the webhook is rejected.
    const isValidSignature = razorpayXService.verifyWebhookSignature(rawBodyBuffer, signature);
    if (!isValidSignature) {
      res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
      return;
    }

    const event = req.body;
    const eventId = String(event.event_id || event.id || '');
    if (!eventId) {
      res.status(400).json({ success: false, message: 'Webhook event id is required.' });
      return;
    }
    const eventType = event.event || 'payout.processed';

    // Duplicate event suppression
    const existing = await WebhookEvent.findOne({ eventId });
    if (existing && existing.processed) {
      res.status(200).json({ success: true, message: 'Duplicate webhook suppressed.' });
      return;
    }

    const webhookRecord = await WebhookEvent.create({
      eventId,
      provider: 'RAZORPAYX',
      eventType,
      payload: event,
      signature,
      processed: false,
    });

    const payoutEntity = event.payload?.payout?.entity || event.data?.payout;
    if (payoutEntity) {
      const payoutId = payoutEntity.id;
      const paymentRef = payoutEntity.reference_id || payoutEntity.notes?.sitetrackRef;
      const rzpStatus = (payoutEntity.status || '').toLowerCase();
      const utr = payoutEntity.utr;

      const lookups: any[] = [];
      if (typeof paymentRef === 'string' && paymentRef) lookups.push({ paymentReference: paymentRef });
      if (typeof payoutId === 'string' && payoutId) {
        lookups.push({ razorpayxPayoutId: payoutId }, { providerTransactionId: payoutId });
      }
      const payment = lookups.length ? await PaymentRequest.findOne({ $or: lookups }) : null;

      if (payment) {
        if (rzpStatus === 'processed' || rzpStatus === 'paid' || rzpStatus === 'success') {
          payment.status = 'PAID';
          if (utr) payment.providerUtr = utr;
          if (payoutEntity.fees !== undefined) payment.fees = payoutEntity.fees;
          if (payoutEntity.tax !== undefined) payment.tax = payoutEntity.tax;
          payment.reconciledAt = new Date();

          if (payment.expense) {
            await Expense.findByIdAndUpdate(payment.expense, {
              paymentStatus: 'PAID',
              paidAt: new Date(),
            });
          }
        } else if (rzpStatus === 'reversed') {
          payment.status = 'REVERSED';
          payment.reversalReason = payoutEntity.failure_reason || 'Bank reversal processed';
          payment.reversedAt = new Date();

          if (payment.expense) {
            await Expense.findByIdAndUpdate(payment.expense, { paymentStatus: 'UNPAID' });
          }
        } else if (rzpStatus === 'rejected' || rzpStatus === 'cancelled' || rzpStatus === 'failed') {
          payment.status = 'FAILED';
          payment.failureReason = payoutEntity.failure_reason || 'Rejected by bank network';

          if (payment.expense) {
            await Expense.findByIdAndUpdate(payment.expense, { paymentStatus: 'UNPAID' });
          }
        } else if (rzpStatus === 'processing' || rzpStatus === 'queued' || rzpStatus === 'initiated') {
          payment.status = 'PROCESSING';
        }

        payment.razorpayxStatus = rzpStatus;
        if (payoutId) payment.razorpayxPayoutId = payoutId;

        payment.auditTrail.push({
          timestamp: new Date(),
          action: `RAZORPAYX_WEBHOOK_${eventType.toUpperCase()}`,
          performedBy: payment.createdBy,
          note: `Webhook received: ${eventType}. Mapped status: ${payment.status}. UTR: ${utr || 'N/A'}`,
        });

        await payment.save();
      }
    }

    webhookRecord.processed = true;
    webhookRecord.processedAt = new Date();
    await webhookRecord.save();

    res.status(200).json({ success: true, message: 'Webhook processed successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Webhook error', error: err.message });
  }
}
