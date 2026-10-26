import { Response } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest, isMD } from '../types/index.js';
import { PaymentRequest, PaymentRequestStatus } from '../models/PaymentRequest.js';
import { Beneficiary } from '../models/Beneficiary.js';
import { Project } from '../models/Project.js';
import { Expense } from '../models/Expense.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { razorpayXService } from '../services/payments/razorpayXService.js';
import { logAudit } from '../services/auditService.js';
import { rupeesToPaise } from '../utils/currency.js';

// Configurable high-value authorization threshold: default ₹1,00,000 (10,000,000 paise)
const HIGH_VALUE_THRESHOLD_PAISE =
  Number(process.env.PAYMENT_HIGH_VALUE_THRESHOLD_PAISE) || 10000000;

export async function createPaymentRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      projectId,
      beneficiaryId,
      expenseId,
      amountRupees,
      amountPaise: inputPaise,
      paymentMethod,
      purpose,
      invoiceNumber,
      idempotencyKey: clientKey,
    } = req.body;

    if (!projectId || !beneficiaryId || !purpose) {
      res.status(400).json({
        success: false,
        message: 'projectId, beneficiaryId, and purpose are required.',
      });
      return;
    }

    // 1. Resolve & validate monetary amount in integer paise
    let finalAmountPaise: number;
    if (inputPaise !== undefined && inputPaise !== null) {
      finalAmountPaise = Number(inputPaise);
    } else if (amountRupees !== undefined && amountRupees !== null) {
      finalAmountPaise = rupeesToPaise(amountRupees);
    } else {
      res.status(400).json({ success: false, message: 'Payment amount is required.' });
      return;
    }

    if (!Number.isInteger(finalAmountPaise) || finalAmountPaise <= 0) {
      res.status(400).json({
        success: false,
        message: 'Amount must be a positive integer in paise (min. ₹1 = 100 paise).',
      });
      return;
    }

    // 2. Validate Payment Method and RBI rules
    const method = (paymentMethod || 'NEFT').toUpperCase();
    if (method !== 'NEFT' && method !== 'RTGS') {
      res.status(400).json({ success: false, message: 'Invalid payment method. Supported: NEFT, RTGS.' });
      return;
    }

    // RTGS Minimum rule per Reserve Bank of India: ₹2,00,000 (20,000,000 paise)
    if (method === 'RTGS' && finalAmountPaise < 20000000) {
      res.status(400).json({
        success: false,
        message:
          'RTGS requires a minimum transaction amount of ₹2,00,000 (20,000,000 paise) per RBI guidelines. Please use NEFT for lower amounts.',
      });
      return;
    }

    // 3. Verify Project
    const project = await Project.findById(projectId);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found.' });
      return;
    }

    // 4. Verify Beneficiary & create immutable snapshots
    const beneficiary = await Beneficiary.findById(beneficiaryId);
    if (!beneficiary || !beneficiary.isActive) {
      res.status(404).json({ success: false, message: 'Active beneficiary account not found.' });
      return;
    }

    // 5. Verify linked Expense if provided
    let linkedExpense: any = null;
    if (expenseId) {
      linkedExpense = await Expense.findById(expenseId);
      if (!linkedExpense) {
        res.status(404).json({ success: false, message: 'Linked expense not found.' });
        return;
      }
      if (String(linkedExpense.project) !== String(project._id)) {
        res.status(400).json({ success: false, message: 'Linked expense does not belong to this project.' });
        return;
      }
      if (linkedExpense.status !== 'APPROVED') {
        res.status(400).json({
          success: false,
          message: 'Only approved expenses can be linked to a payment request.',
        });
        return;
      }
      if (linkedExpense.paymentStatus === 'PAID') {
        res.status(400).json({ success: false, message: 'Linked expense has already been settled and paid.' });
        return;
      }
    }

    // 6. Check Idempotency Key
    const idempotencyKey =
      clientKey || `IDEM-RZPX-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const existingPayment = await PaymentRequest.findOne({ idempotencyKey });
    if (existingPayment) {
      res.status(409).json({
        success: false,
        message: 'Duplicate payment request detected with this idempotency key.',
        payment: existingPayment,
      });
      return;
    }

    // 7. Check High-Value Authorization Threshold
    const requiresHighValueAuth = finalAmountPaise > HIGH_VALUE_THRESHOLD_PAISE;
    const initialStatus: PaymentRequestStatus = requiresHighValueAuth
      ? 'AWAITING_AUTHORIZATION'
      : 'DRAFT';

    const referenceNumber = `PAY-RZPX-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    const paymentRequest = await PaymentRequest.create({
      paymentReference: referenceNumber,
      idempotencyKey,
      project: project._id,
      expense: linkedExpense ? linkedExpense._id : undefined,
      beneficiary: beneficiary._id,
      payeeNameSnapshot: beneficiary.name,
      accountNumberMaskedSnapshot: beneficiary.accountNumberMasked,
      ifscSnapshot: beneficiary.ifsc,
      bankNameSnapshot: beneficiary.bankName,
      payeeType: beneficiary.payeeType,
      amount: finalAmountPaise,
      paymentMethod: method,
      invoiceNumber: invoiceNumber?.trim(),
      purpose: purpose.trim(),
      status: initialStatus,
      requiresHighValueAuth,
      providerName: 'RAZORPAYX',
      createdBy: req.user!.userId,
      auditTrail: [
        {
          timestamp: new Date(),
          action: 'PAYMENT_CREATED',
          performedBy: req.user!.userId,
          note: requiresHighValueAuth
            ? `High-value payout exceeding ₹${HIGH_VALUE_THRESHOLD_PAISE / 100}. Enqueued for independent MD authorization.`
            : 'Payout request created in DRAFT ready for RazorpayX submission.',
          ip: req.ip,
        },
      ],
    });

    if (linkedExpense) {
      linkedExpense.paymentStatus = 'PAYMENT_REQUESTED';
      linkedExpense.paymentRequestId = paymentRequest._id;
      await linkedExpense.save();
    }

    await logAudit('PAYMENT_REQUEST_CREATED', req.user!.userId, 'PAYMENT_REQUEST', paymentRequest._id, {
      reference: paymentRequest.paymentReference,
      amountPaise: paymentRequest.amount,
      payee: paymentRequest.payeeNameSnapshot,
      requiresHighValueAuth,
      status: paymentRequest.status,
      provider: 'RAZORPAYX',
    });

    res.status(201).json({
      success: true,
      message: requiresHighValueAuth
        ? 'High-value payment request submitted. Awaiting independent MD authorization.'
        : 'RazorpayX payment request created successfully in Draft.',
      payment: paymentRequest,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create payment request', error: err.message });
  }
}

export async function listPaymentRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId, status, payeeType, provider, search, page = '1', limit = '50' } = req.query;

    const query: any = {};

    if (projectId && projectId !== 'ALL') {
      query.project = projectId;
    }

    if (status && status !== 'ALL') {
      query.status = status;
    }

    if (payeeType && payeeType !== 'ALL') {
      query.payeeType = payeeType;
    }

    if (provider && provider !== 'ALL') {
      query.providerName = provider;
    }

    if (search) {
      const s = String(search).trim();
      query.$or = [
        { paymentReference: { $regex: s, $options: 'i' } },
        { payeeNameSnapshot: { $regex: s, $options: 'i' } },
        { purpose: { $regex: s, $options: 'i' } },
        { invoiceNumber: { $regex: s, $options: 'i' } },
        { providerUtr: { $regex: s, $options: 'i' } },
        { razorpayxPayoutId: { $regex: s, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit)) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [payments, total] = await Promise.all([
      PaymentRequest.find(query)
        .populate('project', 'name code location')
        .populate('createdBy', 'name email role')
        .populate('authorizedBy', 'name email role')
        .populate('expense', 'category description amount vendor date')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      PaymentRequest.countDocuments(query),
    ]);

    // Financial KPI aggregations for active query
    const stats = await PaymentRequest.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    let totalDisbursedPaise = 0;
    let awaitingAuthCount = 0;
    let awaitingAuthPaise = 0;
    let processingPaise = 0;
    let reversedPaise = 0;

    stats.forEach((s) => {
      if (s._id === 'PAID') totalDisbursedPaise = s.totalAmount;
      if (s._id === 'AWAITING_AUTHORIZATION') {
        awaitingAuthCount = s.count;
        awaitingAuthPaise = s.totalAmount;
      }
      if (s._id === 'PROCESSING' || s._id === 'SUBMITTED') {
        processingPaise += s.totalAmount;
      }
      if (s._id === 'REVERSED') {
        reversedPaise += s.totalAmount;
      }
    });

    res.json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      payments,
      summary: {
        totalDisbursedPaise,
        awaitingAuthCount,
        awaitingAuthPaise,
        processingPaise,
        reversedPaise,
        highValueThresholdPaise: HIGH_VALUE_THRESHOLD_PAISE,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to list payment requests', error: err.message });
  }
}

export async function getPaymentRequestById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const payment = await PaymentRequest.findById(id)
      .populate('project', 'name code location budget')
      .populate('createdBy', 'name email role')
      .populate('authorizedBy', 'name email role')
      .populate('initiatedBy', 'name email role')
      .populate('beneficiary')
      .populate('expense');

    if (!payment) {
      res.status(404).json({ success: false, message: 'Payment request not found.' });
      return;
    }

    res.json({ success: true, payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch payment request', error: err.message });
  }
}

export async function authorizePaymentRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    if (!isMD(req.user?.role)) {
      res.status(403).json({
        success: false,
        message: 'Forbidden: Only the Managing Director can authorize payments.',
      });
      return;
    }

    const payment = await PaymentRequest.findById(id);
    if (!payment) {
      res.status(404).json({ success: false, message: 'Payment request not found.' });
      return;
    }

    if (payment.status !== 'AWAITING_AUTHORIZATION') {
      res.status(400).json({
        success: false,
        message: `Payment request cannot be authorized because its status is '${payment.status}'.`,
      });
      return;
    }

    // CRITICAL ENFORCEMENT: Independent Dual-Authorization Rule
    // The user who created a high-value payment cannot approve their own payment
    if (payment.requiresHighValueAuth && String(payment.createdBy) === String(req.user!.userId)) {
      res.status(403).json({
        success: false,
        message:
          'Security Policy Block: Independent authorization is mandatory. The creator of a high-value payment cannot approve their own request. Dual-authorization by another authorized Managing Director is required.',
      });
      return;
    }

    payment.authorizedBy = req.user!.userId as any;
    payment.authorizedAt = new Date();
    payment.authorizationNotes = notes?.trim();
    payment.status = 'AUTHORIZED'; // Transition to AUTHORIZED state

    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_AUTHORIZED_BY_MD',
      performedBy: req.user!.userId as any,
      note: notes ? `Authorized by MD: ${notes}` : 'Independent authorization granted by Managing Director.',
      ip: req.ip,
    });

    await payment.save();

    await logAudit('PAYMENT_AUTHORIZED', req.user!.userId, 'PAYMENT_REQUEST', payment._id, {
      reference: payment.paymentReference,
      amountPaise: payment.amount,
      authorizedBy: req.user!.userId,
      provider: payment.providerName,
    });

    res.json({
      success: true,
      message: 'Payment request authorized successfully. It is now ready for RazorpayX transfer initiation.',
      payment,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to authorize payment', error: err.message });
  }
}

export async function initiatePaymentTransfer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!isMD(req.user?.role)) {
      res.status(403).json({
        success: false,
        message: 'Forbidden: Only the Managing Director can execute bank payouts.',
      });
      return;
    }

    const payment = await PaymentRequest.findById(id).populate('beneficiary');
    if (!payment) {
      res.status(404).json({ success: false, message: 'Payment request not found.' });
      return;
    }

    // 1. Guard against executing legacy non-RazorpayX payouts through RazorpayX
    if (payment.providerName && payment.providerName !== 'RAZORPAYX') {
      res.status(400).json({
        success: false,
        message: `Historical record protection: Payment was created with legacy provider '${payment.providerName}'. Old provider transactions cannot be re-executed.`,
      });
      return;
    }

    // 2. Enforce High-Value Authorization Guard
    if (payment.requiresHighValueAuth && payment.status !== 'AUTHORIZED') {
      res.status(400).json({
        success: false,
        message:
          'Security Block: This payment exceeds ₹1,00,000 and requires explicit independent authorization (status must be AUTHORIZED) before payout can be submitted.',
      });
      return;
    }

    // 3. Enforce Terminal / In-Flight Status Guards ("Never retry potentially completed transfer")
    if (payment.status === 'PAID') {
      res.status(400).json({ success: false, message: 'This payment has already been settled and paid.' });
      return;
    }

    if (
      payment.status === 'SUBMITTED' ||
      payment.status === 'PROCESSING' ||
      payment.status === 'UNKNOWN'
    ) {
      res.status(400).json({
        success: false,
        message:
          `Payment is currently in '${payment.status}' state. To prevent duplicate fund debit, transfers must not be re-initiated without first querying RazorpayX status reconciliation.`,
      });
      return;
    }

    const beneficiary = payment.beneficiary as any;
    if (!beneficiary) {
      res.status(400).json({ success: false, message: 'Beneficiary bank record is missing.' });
      return;
    }

    // Mark as SUBMITTED immediately to prevent race conditions
    payment.status = 'SUBMITTED';
    payment.initiatedBy = req.user!.userId as any;
    payment.initiatedAt = new Date();
    payment.providerName = 'RAZORPAYX';
    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_SUBMITTED_TO_RAZORPAYX',
      performedBy: req.user!.userId as any,
      note: `Dispatching ${payment.paymentMethod} transfer via RazorpayX Payouts API`,
      ip: req.ip,
    });
    await payment.save();

    // 4. Execute through official RazorpayX service
    const payoutResult = await razorpayXService.createPayout({
      paymentReference: payment.paymentReference,
      idempotencyKey: payment.idempotencyKey,
      amountPaise: payment.amount,
      mode: payment.paymentMethod,
      purpose: payment.purpose,
      narration: payment.purpose,
      beneficiary,
      projectId: payment.project.toString(),
      expenseId: payment.expense ? payment.expense.toString() : undefined,
    });

    payment.providerTransactionId = payoutResult.payoutId;
    payment.razorpayxPayoutId = payoutResult.payoutId;
    payment.razorpayxStatus = payoutResult.razorpayxStatus;
    payment.providerStatus = payoutResult.razorpayxStatus;
    payment.status = payoutResult.status;
    if (payoutResult.contactId) payment.razorpayxContactId = payoutResult.contactId;
    if (payoutResult.fundAccountId) payment.razorpayxFundAccountId = payoutResult.fundAccountId;
    if (payoutResult.utr) payment.providerUtr = payoutResult.utr;
    if (payoutResult.fees !== undefined) payment.fees = payoutResult.fees;
    if (payoutResult.tax !== undefined) payment.tax = payoutResult.tax;
    if (payoutResult.failureReason) payment.failureReason = payoutResult.failureReason;

    payment.auditTrail.push({
      timestamp: new Date(),
      action: `RAZORPAYX_OUTCOME_${payoutResult.status}`,
      performedBy: req.user!.userId as any,
      note: payoutResult.utr
        ? `Settled via RazorpayX. UTR: ${payoutResult.utr} (Fee: ₹${(payoutResult.fees || 0) / 100})`
        : payoutResult.failureReason || `RazorpayX status: ${payoutResult.razorpayxStatus}`,
      ip: req.ip,
    });

    await payment.save();

    // If paid, settle linked expense
    if (payment.status === 'PAID' && payment.expense) {
      await Expense.findByIdAndUpdate(payment.expense, {
        paymentStatus: 'PAID',
        paidAt: new Date(),
      });
    }

    await logAudit('PAYMENT_INITIATED', req.user!.userId, 'PAYMENT_REQUEST', payment._id, {
      reference: payment.paymentReference,
      status: payment.status,
      utr: payment.providerUtr,
      amountPaise: payment.amount,
      provider: 'RAZORPAYX',
      razorpayxPayoutId: payment.razorpayxPayoutId,
    });

    res.json({
      success: payment.status !== 'FAILED',
      message:
        payment.status === 'PAID'
          ? `RazorpayX payout settled successfully. UTR: ${payment.providerUtr || 'N/A'}`
          : payment.status === 'UNKNOWN'
          ? 'Payout submitted but status is indeterminate. Run reconciliation to query RazorpayX ledger.'
          : `Payout in progress with RazorpayX (Status: ${payment.status}). Ref: ${payment.razorpayxPayoutId}`,
      payment,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'RazorpayX payout execution failed', error: err.message });
  }
}

export async function reconcilePaymentStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const payment = await PaymentRequest.findById(id);
    if (!payment) {
      res.status(404).json({ success: false, message: 'Payment request not found.' });
      return;
    }

    // Historical legacy provider check
    if (payment.providerName && payment.providerName !== 'RAZORPAYX') {
      res.json({
        success: true,
        message: `Historical record from provider '${payment.providerName}'. Preserved for audit without RazorpayX mutation.`,
        payment,
      });
      return;
    }

    if (!payment.razorpayxPayoutId && !payment.providerTransactionId && !payment.paymentReference) {
      res.status(400).json({
        success: false,
        message: 'Payment has not been submitted to RazorpayX yet.',
      });
      return;
    }

    const payoutId = payment.razorpayxPayoutId || payment.providerTransactionId || '';
    const result = await razorpayXService.getPayout(payoutId, payment.paymentReference);

    const oldStatus = payment.status;
    payment.status = result.status;
    payment.razorpayxStatus = result.razorpayxStatus;
    payment.providerStatus = result.razorpayxStatus;
    if (result.utr) payment.providerUtr = result.utr;
    if (result.fees !== undefined) payment.fees = result.fees;
    if (result.tax !== undefined) payment.tax = result.tax;
    if (result.failureReason) payment.failureReason = result.failureReason;
    payment.reconciledAt = new Date();

    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_RECONCILED_WITH_RAZORPAYX',
      performedBy: req.user!.userId as any,
      note: `Reconciled with RazorpayX. Status transition: ${oldStatus} -> ${result.status}. UTR: ${result.utr || 'N/A'}`,
      ip: req.ip,
    });

    await payment.save();

    // If reconciled to PAID, settle linked expense
    if (payment.status === 'PAID' && payment.expense) {
      await Expense.findByIdAndUpdate(payment.expense, {
        paymentStatus: 'PAID',
        paidAt: new Date(),
      });
    }

    // If reconciled to REVERSED, release linked expense
    if (payment.status === 'REVERSED' && payment.expense) {
      await Expense.findByIdAndUpdate(payment.expense, {
        paymentStatus: 'UNPAID',
      });
    }

    await logAudit('PAYMENT_RECONCILED', req.user!.userId, 'PAYMENT_REQUEST', payment._id, {
      reference: payment.paymentReference,
      oldStatus,
      newStatus: payment.status,
      utr: payment.providerUtr,
      provider: 'RAZORPAYX',
    });

    res.json({
      success: true,
      message: `RazorpayX reconciliation complete. Current status is ${payment.status}.`,
      payment,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'RazorpayX reconciliation failed', error: err.message });
  }
}

export async function cancelPaymentRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const payment = await PaymentRequest.findById(id);
    if (!payment) {
      res.status(404).json({ success: false, message: 'Payment request not found.' });
      return;
    }

    if (
      payment.status !== 'DRAFT' &&
      payment.status !== 'AWAITING_AUTHORIZATION' &&
      payment.status !== 'AUTHORIZED'
    ) {
      res.status(400).json({
        success: false,
        message: `Cannot cancel a payment with status '${payment.status}'. Once submitted to RazorpayX or bank, reconciliation is required.`,
      });
      return;
    }

    payment.status = 'FAILED';
    payment.failureReason = `Cancelled by user: ${reason || 'No reason provided'}`;
    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_CANCELLED',
      performedBy: req.user!.userId as any,
      note: `Payment cancelled before bank submission: ${reason || 'N/A'}`,
      ip: req.ip,
    });

    await payment.save();

    // Release linked expense
    if (payment.expense) {
      await Expense.findByIdAndUpdate(payment.expense, {
        paymentStatus: 'UNPAID',
        paymentRequestId: undefined,
      });
    }

    await logAudit('PAYMENT_CANCELLED', req.user!.userId, 'PAYMENT_REQUEST', payment._id, {
      reference: payment.paymentReference,
      reason,
      provider: payment.providerName,
    });

    res.json({ success: true, message: 'Payment request cancelled successfully.', payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to cancel payment', error: err.message });
  }
}

export async function handlePaymentWebhook(req: any, res: Response): Promise<void> {
  try {
    // 1. Extract exact raw request body and signature
    const signature = (req.headers['x-razorpay-signature'] ||
      req.headers['x-webhook-signature'] ||
      req.headers['x-signature'] ||
      '') as string;

    const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    // 2. Verify Cryptographic HMAC-SHA256 Signature
    const isValid = razorpayXService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      res.status(401).json({ success: false, message: 'Invalid RazorpayX webhook signature.' });
      return;
    }

    const payload = req.body;
    const eventId = payload.event_id || payload.id || `EVT-RZPX-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const eventType = payload.event || payload.type || 'payout.updated';

    // 3. Duplicate Webhook Event Suppression (Idempotency)
    const existing = await WebhookEvent.findOne({ eventId });
    if (existing) {
      // Immediately acknowledge duplicate to prevent webhook storming
      res.status(200).json({ success: true, message: 'Duplicate webhook event acknowledged.' });
      return;
    }

    const webhookRecord = await WebhookEvent.create({
      eventId,
      provider: 'RAZORPAYX',
      eventType,
      payload,
      signature,
      processed: false,
    });

    // 4. Extract RazorpayX Payout Data
    const payoutEntity = payload.payload?.payout?.entity || payload.data || payload;
    const paymentRef = payoutEntity.reference_id || payoutEntity.reference;
    const payoutId = payoutEntity.id;
    const rzpStatus = (payoutEntity.status || '').toLowerCase();
    const utr = payoutEntity.utr;

    if (paymentRef || payoutId) {
      const payment = await PaymentRequest.findOne({
        $or: [{ paymentReference: paymentRef }, { razorpayxPayoutId: payoutId }, { providerTransactionId: payoutId }],
      });

      if (payment) {
        if (rzpStatus === 'processed' || rzpStatus === 'paid' || rzpStatus === 'success') {
          payment.status = 'PAID';
          if (utr) payment.providerUtr = utr;
          if (payoutEntity.fees !== undefined) payment.fees = payoutEntity.fees;
          if (payoutEntity.tax !== undefined) payment.tax = payoutEntity.tax;
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
          // Re-open linked expense
          if (payment.expense) {
            await Expense.findByIdAndUpdate(payment.expense, {
              paymentStatus: 'UNPAID',
            });
          }
        } else if (
          rzpStatus === 'rejected' ||
          rzpStatus === 'cancelled' ||
          rzpStatus === 'failed'
        ) {
          payment.status = 'FAILED';
          payment.failureReason = payoutEntity.failure_reason || 'Rejected by bank network';
          if (payment.expense) {
            await Expense.findByIdAndUpdate(payment.expense, {
              paymentStatus: 'UNPAID',
            });
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

    res.status(200).json({ success: true, message: 'RazorpayX webhook processed successfully.' });
  } catch (err: any) {
    console.error('RazorpayX Webhook error:', err);
    res.status(500).json({ success: false, message: 'Webhook processing error', error: err.message });
  }
}
