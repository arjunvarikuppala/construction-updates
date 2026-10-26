import { Response } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest, isMD } from '../types/index.js';
import { PaymentRequest, PaymentRequestStatus } from '../models/PaymentRequest.js';
import { Beneficiary } from '../models/Beneficiary.js';
import { Project } from '../models/Project.js';
import { Expense } from '../models/Expense.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { getPaymentProvider } from '../services/payments/providerFactory.js';
import { logAudit } from '../services/auditService.js';
import { rupeesToPaise } from '../utils/currency.js';

// Configurable high-value payment authorization threshold: default ₹1,00,000 (10,000,000 paise)
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

    // 1. Resolve & validate monetary amount in paise
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

    // 6. Check Idempotency
    const idempotencyKey =
      clientKey || `IDEM-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
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

    const referenceNumber = `PAY-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

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
      createdBy: req.user!.userId,
      auditTrail: [
        {
          timestamp: new Date(),
          action: 'PAYMENT_CREATED',
          performedBy: req.user!.userId,
          note: requiresHighValueAuth
            ? `High-value payment exceeding ₹${HIGH_VALUE_THRESHOLD_PAISE / 100}. Placed in AWAITING_AUTHORIZATION queue.`
            : 'Payment request created in DRAFT state ready for review.',
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
    });

    res.status(201).json({
      success: true,
      message: requiresHighValueAuth
        ? 'High-value payment request submitted. Awaiting executive MD authorization.'
        : 'Payment request created successfully in Draft.',
      payment: paymentRequest,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create payment request', error: err.message });
  }
}

export async function listPaymentRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId, status, payeeType, search, page = '1', limit = '50' } = req.query;

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

    if (search) {
      const s = String(search).trim();
      query.$or = [
        { paymentReference: { $regex: s, $options: 'i' } },
        { payeeNameSnapshot: { $regex: s, $options: 'i' } },
        { purpose: { $regex: s, $options: 'i' } },
        { invoiceNumber: { $regex: s, $options: 'i' } },
        { providerUtr: { $regex: s, $options: 'i' } },
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

    stats.forEach((s) => {
      if (s._id === 'PAID') totalDisbursedPaise = s.totalAmount;
      if (s._id === 'AWAITING_AUTHORIZATION') {
        awaitingAuthCount = s.count;
        awaitingAuthPaise = s.totalAmount;
      }
      if (s._id === 'PROCESSING' || s._id === 'SUBMITTED') {
        processingPaise += s.totalAmount;
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
        message: `Payment request cannot be authorized because its status is ${payment.status}.`,
      });
      return;
    }

    payment.authorizedBy = req.user!.userId as any;
    payment.authorizedAt = new Date();
    payment.authorizationNotes = notes?.trim();
    payment.status = 'DRAFT'; // Authorized and ready to be dispatched

    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_AUTHORIZED',
      performedBy: req.user!.userId as any,
      note: notes ? `Authorized by MD: ${notes}` : 'Authorized by Managing Director.',
      ip: req.ip,
    });

    await payment.save();

    await logAudit('PAYMENT_AUTHORIZED', req.user!.userId, 'PAYMENT_REQUEST', payment._id, {
      reference: payment.paymentReference,
      amountPaise: payment.amount,
      authorizedBy: req.user!.userId,
    });

    res.json({
      success: true,
      message: 'Payment request authorized successfully. It can now be initiated with the bank.',
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
        message: 'Forbidden: Only the Managing Director can execute corporate bank payouts.',
      });
      return;
    }

    const payment = await PaymentRequest.findById(id).populate('beneficiary');
    if (!payment) {
      res.status(404).json({ success: false, message: 'Payment request not found.' });
      return;
    }

    // 1. Enforce High-Value Authorization Guard
    if (payment.requiresHighValueAuth && !payment.authorizedBy) {
      res.status(400).json({
        success: false,
        message:
          'Security Block: This payment exceeds ₹1,00,000 and requires explicit executive authorization before transfer can be executed.',
      });
      return;
    }

    // 2. Enforce Terminal / In-Flight Status Guards ("Never retry potentially completed transfer")
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
          `Payment is currently in '${payment.status}' state. To prevent duplicate fund debit, transfers must not be re-initiated without first querying bank reconciliation.`,
      });
      return;
    }

    const beneficiary = payment.beneficiary as any;
    if (!beneficiary) {
      res.status(400).json({ success: false, message: 'Beneficiary bank record is missing.' });
      return;
    }

    const provider = getPaymentProvider();

    // Mark as SUBMITTED immediately before outbound call to prevent race condition double-execution
    payment.status = 'SUBMITTED';
    payment.initiatedBy = req.user!.userId as any;
    payment.initiatedAt = new Date();
    payment.providerName = provider.name;
    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_SUBMITTED_TO_GATEWAY',
      performedBy: req.user!.userId as any,
      note: `Dispatching ${payment.paymentMethod} transfer via ${provider.name}`,
      ip: req.ip,
    });
    await payment.save();

    // Execute through provider abstraction
    const transferResult = await provider.initiateTransfer({
      paymentReference: payment.paymentReference,
      idempotencyKey: payment.idempotencyKey,
      amountPaise: payment.amount,
      paymentMethod: payment.paymentMethod,
      purpose: payment.purpose,
      beneficiary: {
        id: beneficiary._id.toString(),
        name: payment.payeeNameSnapshot,
        accountNumber: beneficiary.accountNumber,
        ifsc: payment.ifscSnapshot,
        providerBeneficiaryId: beneficiary.providerBeneficiaryId,
      },
    });

    payment.providerTransactionId = transferResult.providerTransactionId;
    payment.providerStatus = transferResult.providerStatus;
    payment.status = transferResult.status;
    if (transferResult.utr) payment.providerUtr = transferResult.utr;
    if (transferResult.failureReason) payment.failureReason = transferResult.failureReason;

    payment.auditTrail.push({
      timestamp: new Date(),
      action: `GATEWAY_RESPONSE_${transferResult.status}`,
      performedBy: req.user!.userId as any,
      note: transferResult.utr
        ? `Settled with UTR: ${transferResult.utr}`
        : transferResult.failureReason || 'Response recorded from provider.',
      ip: req.ip,
    });

    await payment.save();

    // If paid, update linked expense
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
      provider: provider.name,
    });

    res.json({
      success: payment.status !== 'FAILED',
      message:
        payment.status === 'PAID'
          ? `Payout completed successfully. UTR: ${payment.providerUtr || 'N/A'}`
          : payment.status === 'UNKNOWN'
          ? 'Transfer submitted but status unknown from gateway. Reconcile to verify settlement.'
          : `Payout status: ${payment.status}. Provider ref: ${payment.providerTransactionId}`,
      payment,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Transfer execution failed', error: err.message });
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

    if (!payment.providerTransactionId && !payment.paymentReference) {
      res.status(400).json({
        success: false,
        message: 'Payment has not been submitted to a provider yet.',
      });
      return;
    }

    const provider = getPaymentProvider();
    const result = await provider.reconcilePayment(
      payment.providerTransactionId || '',
      payment.paymentReference
    );

    const oldStatus = payment.status;
    payment.status = result.status;
    payment.providerStatus = result.providerStatus;
    if (result.utr) payment.providerUtr = result.utr;
    if (result.failureReason) payment.failureReason = result.failureReason;
    payment.reconciledAt = new Date();

    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_RECONCILED',
      performedBy: req.user!.userId as any,
      note: `Reconciled with provider. Status transition: ${oldStatus} -> ${result.status}. UTR: ${result.utr || 'N/A'}`,
      ip: req.ip,
    });

    await payment.save();

    // If reconciled to PAID, update linked expense
    if (payment.status === 'PAID' && payment.expense) {
      await Expense.findByIdAndUpdate(payment.expense, {
        paymentStatus: 'PAID',
        paidAt: result.settledAt || new Date(),
      });
    }

    await logAudit('PAYMENT_RECONCILED', req.user!.userId, 'PAYMENT_REQUEST', payment._id, {
      reference: payment.paymentReference,
      oldStatus,
      newStatus: payment.status,
      utr: payment.providerUtr,
    });

    res.json({
      success: true,
      message: `Reconciliation complete. Status is ${payment.status}.`,
      payment,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Reconciliation failed', error: err.message });
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

    if (payment.status !== 'DRAFT' && payment.status !== 'AWAITING_AUTHORIZATION') {
      res.status(400).json({
        success: false,
        message: `Cannot cancel a payment with status '${payment.status}'. Once submitted to bank, reconciliation is required.`,
      });
      return;
    }

    payment.status = 'FAILED';
    payment.failureReason = `Cancelled by user: ${reason || 'No reason provided'}`;
    payment.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_CANCELLED',
      performedBy: req.user!.userId as any,
      note: `Payment cancelled: ${reason || 'N/A'}`,
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
    });

    res.json({ success: true, message: 'Payment request cancelled successfully.', payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to cancel payment', error: err.message });
  }
}

export async function handlePaymentWebhook(req: any, res: Response): Promise<void> {
  try {
    const signature = (req.headers['x-razorpay-signature'] ||
      req.headers['x-webhook-signature'] ||
      req.headers['x-signature'] ||
      '') as string;

    const provider = getPaymentProvider();

    // 1. Verify Webhook Signature
    const isValid = provider.verifyWebhookSignature(req.body, signature);
    if (!isValid) {
      res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
      return;
    }

    const payload = req.body;
    const eventId = payload.event_id || payload.id || `EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const eventType = payload.event || payload.type || 'payout.updated';

    // 2. Check Duplicate Webhook Event
    const existing = await WebhookEvent.findOne({ eventId });
    if (existing) {
      // Return 200 OK immediately for duplicate webhooks to prevent provider retries
      res.status(200).json({ success: true, message: 'Duplicate webhook event acknowledged.' });
      return;
    }

    const webhookRecord = await WebhookEvent.create({
      eventId,
      provider: provider.name,
      eventType,
      payload,
      signature,
      processed: false,
    });

    // 3. Extract Payment Reference & update status
    const payoutData = payload.payload?.payout?.entity || payload.data || payload;
    const paymentRef = payoutData.reference_id || payoutData.reference;
    const providerTxId = payoutData.id;
    const providerStatus = (payoutData.status || '').toLowerCase();
    const utr = payoutData.utr;

    if (paymentRef || providerTxId) {
      const payment = await PaymentRequest.findOne({
        $or: [{ paymentReference: paymentRef }, { providerTransactionId: providerTxId }],
      });

      if (payment) {
        if (providerStatus === 'processed' || providerStatus === 'paid' || providerStatus === 'success') {
          payment.status = 'PAID';
          if (utr) payment.providerUtr = utr;
          if (payment.expense) {
            await Expense.findByIdAndUpdate(payment.expense, {
              paymentStatus: 'PAID',
              paidAt: new Date(),
            });
          }
        } else if (
          providerStatus === 'reversed' ||
          providerStatus === 'rejected' ||
          providerStatus === 'failed'
        ) {
          payment.status = 'FAILED';
          payment.failureReason = payoutData.failure_reason || 'Rejected by bank network';
          if (payment.expense) {
            await Expense.findByIdAndUpdate(payment.expense, {
              paymentStatus: 'UNPAID',
            });
          }
        }

        payment.auditTrail.push({
          timestamp: new Date(),
          action: `WEBHOOK_EVENT_${eventType.toUpperCase()}`,
          performedBy: payment.createdBy,
          note: `Webhook received: ${eventType}. Status: ${payment.status}. UTR: ${utr || 'N/A'}`,
        });

        await payment.save();
      }
    }

    webhookRecord.processed = true;
    webhookRecord.processedAt = new Date();
    await webhookRecord.save();

    res.status(200).json({ success: true, message: 'Webhook processed successfully.' });
  } catch (err: any) {
    console.error('Webhook error:', err);
    res.status(500).json({ success: false, message: 'Webhook processing error', error: err.message });
  }
}
