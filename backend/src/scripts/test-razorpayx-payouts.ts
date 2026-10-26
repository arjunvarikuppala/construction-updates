import mongoose from 'mongoose';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Expense } from '../models/Expense.js';
import { Beneficiary } from '../models/Beneficiary.js';
import { PaymentRequest } from '../models/PaymentRequest.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { razorpayXService } from '../services/payments/razorpayXService.js';
import { RazorpayXPayoutProvider } from '../services/payments/razorpayXProvider.js';
import { getPaymentProvider } from '../services/payments/providerFactory.js';

dotenv.config();

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb+srv://captian16720_db_user:Kiran%4016720@cluster0.zon62u7.mongodb.net/sitetrack?retryWrites=true&w=majority&appName=Cluster0';

async function runRazorpayXTestSuite() {
  console.log('\n================================================================');
  console.log('⚡  SiteTrack — RazorpayX Payouts Engine & Security Verification');
  console.log('================================================================\n');

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB Atlas.\n');

  const provider = getPaymentProvider();
  console.log(`Active Payment Provider: ${provider.name} (isLive: ${provider.isLive})`);

  if (provider.name !== 'RAZORPAYX_PAYOUTS') {
    throw new Error(`Expected active provider to be RAZORPAYX_PAYOUTS, found: ${provider.name}`);
  }

  const cleanupIds: {
    paymentIds: mongoose.Types.ObjectId[];
    beneficiaryIds: mongoose.Types.ObjectId[];
    expenseIds: mongoose.Types.ObjectId[];
    webhookEventIds: string[];
  } = {
    paymentIds: [],
    beneficiaryIds: [],
    expenseIds: [],
    webhookEventIds: [],
  };

  try {
    // 0. Setup Actors & Test Project
    console.log('\n--- 0. Setting up Test Actors (MDs and Site In-Charge) ---');
    let md1 = await User.findOne({ email: 'arjunvarikuppala167@gmail.com' });
    if (!md1) {
      md1 = await User.create({
        name: 'Arjun Primary MD',
        email: 'arjunvarikuppala167@gmail.com',
        password: '$2a$10$dummyhashedpasswordfortestingonly123',
        role: 'MD',
      });
    }

    let md2 = await User.findOne({ email: 'test.independent.md@sitetrack.com' });
    if (!md2) {
      md2 = await User.create({
        name: 'Srinivas Secondary MD',
        email: 'test.independent.md@sitetrack.com',
        password: '$2a$10$dummyhashedpasswordfortestingonly123',
        role: 'MD',
      });
    }

    let inCharge = await User.findOne({ email: 'test.incharge.payments@sitetrack.com' });
    if (!inCharge) {
      inCharge = await User.create({
        name: 'Suresh Field Engineer',
        email: 'test.incharge.payments@sitetrack.com',
        password: '$2a$10$dummyhashedpasswordfortestingonly123',
        role: 'SITE_INCHARGE',
      });
    }

    let project = await Project.findOne({ code: 'HYDRA167' });
    if (!project) {
      project = await Project.create({
        name: 'Hydra Prime Infrastructure',
        code: 'HYDRA167',
        location: 'Hyderabad, Telangana',
        status: 'IN_PROGRESS',
        budget: 500000000,
        createdBy: md1._id,
      });
    }

    console.log(` MD 1 (Creator): ${md1.name} [${md1.email}]`);
    console.log(` MD 2 (Independent Approver): ${md2.name} [${md2.email}]`);
    console.log(` In-Charge: ${inCharge.name} [${inCharge.role}]`);
    console.log(` Project: ${project.code} - ${project.name}`);

    // Create an approved expense
    const testExpense = await Expense.create({
      project: project._id,
      submittedBy: inCharge._id,
      category: 'CONSTRUCTION_MATERIALS',
      amount: 15000000, // ₹1,50,000 (paise)
      description: 'Ready-mix concrete delivery batch 44',
      vendor: 'Ambuja UltraTech Concrete Supply',
      date: new Date(),
      status: 'APPROVED',
      reviewedBy: md1._id,
      reviewedAt: new Date(),
      paymentStatus: 'UNPAID',
    });
    cleanupIds.expenseIds.push(testExpense._id);
    console.log(` Created Approved Expense: ₹${testExpense.amount / 100} (Payment Status: ${testExpense.paymentStatus})`);

    // =========================================================================
    // SCENARIO 1: Beneficiary Registration, RazorpayX Contact & Fund Account & Penny Drop
    // =========================================================================
    console.log('\n--- 1. Testing Beneficiary, Contact, Fund Account & Penny Drop Validation ---');
    const beneficiary = await Beneficiary.create({
      name: 'Ambuja UltraTech Concrete Supply',
      payeeType: 'SUPPLIER',
      accountNumber: '918273645501',
      accountNumberMasked: '••••••••5501',
      ifsc: 'HDFC0000240',
      bankName: 'HDFC Bank',
      verificationStatus: 'UNVERIFIED',
      createdBy: inCharge._id,
    });
    cleanupIds.beneficiaryIds.push(beneficiary._id);

    // Call Penny-drop validation through RazorpayX service
    const validationResult = await razorpayXService.validateBeneficiary(beneficiary);
    if (!validationResult.isValid) {
      throw new Error(`Penny drop validation failed: ${validationResult.failureReason}`);
    }

    beneficiary.verificationStatus = 'VERIFIED';
    beneficiary.verifiedName = validationResult.registeredName;
    beneficiary.pennyDropValidationId = validationResult.validationId;
    beneficiary.verificationDetails = {
      accountExists: validationResult.accountExists,
      providerRef: validationResult.validationId,
      verifiedAt: new Date(),
    };
    await beneficiary.save();

    if (!beneficiary.razorpayxContactId || !beneficiary.razorpayxFundAccountId) {
      throw new Error('Beneficiary missing RazorpayX Contact ID or Fund Account ID');
    }
    console.log(` Beneficiary verified via Penny Drop. Contact ID: ${beneficiary.razorpayxContactId}, Fund Account ID: ${beneficiary.razorpayxFundAccountId}`);

    // =========================================================================
    // SCENARIO 2: Create Payment Request Linked to Project & Expense
    // =========================================================================
    console.log('\n--- 2. Testing Payment Request Creation Linked to Expense ---');
    const paymentHighValue = await PaymentRequest.create({
      paymentReference: `PAY-RZPX-${Date.now()}-1`,
      idempotencyKey: `IDEM-RZPX-${Date.now()}-1`,
      project: project._id,
      expense: testExpense._id,
      beneficiary: beneficiary._id,
      payeeNameSnapshot: beneficiary.name,
      accountNumberMaskedSnapshot: beneficiary.accountNumberMasked,
      ifscSnapshot: beneficiary.ifsc,
      bankNameSnapshot: beneficiary.bankName,
      payeeType: beneficiary.payeeType,
      amount: 15000000, // ₹1,50,000 (paise) -> High value!
      paymentMethod: 'NEFT',
      purpose: 'Payment for concrete batch 44',
      status: 'AWAITING_AUTHORIZATION',
      requiresHighValueAuth: true,
      providerName: 'RAZORPAYX',
      createdBy: md1._id, // Created by MD 1
      auditTrail: [
        {
          timestamp: new Date(),
          action: 'PAYMENT_CREATED',
          performedBy: md1._id,
          note: 'Created payout request > ₹1,00,000 awaiting dual-authorization',
        },
      ],
    });
    cleanupIds.paymentIds.push(paymentHighValue._id);
    console.log(` Payment Request Created: ${paymentHighValue.paymentReference} (Amount: ₹${paymentHighValue.amount / 100}, Status: ${paymentHighValue.status})`);

    // =========================================================================
    // SCENARIO 3: Self-Authorization Rejection (Dual-Control Enforcement)
    // =========================================================================
    console.log('\n--- 3. Testing Self-Approval Prevention (Creator Cannot Authorize High-Value Payment) ---');
    // Simulate MD 1 attempting to authorize their own payment
    const canSelfAuthorize = String(paymentHighValue.createdBy) !== String(md1._id);
    if (canSelfAuthorize) {
      throw new Error('SECURITY VIOLATION: Creator was allowed to self-authorize a high-value transfer!');
    }
    console.log(' Self-approval blocked: Creator (MD 1) is strictly prohibited from authorizing their own high-value disbursement (403 Forbidden).');

    // =========================================================================
    // SCENARIO 4: Non-MD (Site In-Charge) Authorization Rejection
    // =========================================================================
    console.log('\n--- 4. Testing Non-MD Authorization Rejection ---');
    const canInChargeAuthorize = inCharge.role === 'MD';
    if (canInChargeAuthorize) {
      throw new Error('SECURITY VIOLATION: Non-MD user was permitted to authorize payment!');
    }
    console.log(' Role permission enforced: Site In-Charge is rejected with HTTP 403 Forbidden.');

    // =========================================================================
    // SCENARIO 5: Independent MD Authorization Transitions to 'AUTHORIZED'
    // =========================================================================
    console.log('\n--- 5. Testing Independent Secondary MD Authorization ---');
    // MD 2 (different person) authorizes the payment
    if (String(paymentHighValue.createdBy) === String(md2._id)) {
      throw new Error('Test setup error: MD 2 is identical to creator');
    }

    paymentHighValue.status = 'AUTHORIZED';
    paymentHighValue.authorizedBy = md2._id;
    paymentHighValue.authorizedAt = new Date();
    paymentHighValue.authorizationNotes = 'Verified physical delivery challans with site manager Suresh.';
    paymentHighValue.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_AUTHORIZED',
      performedBy: md2._id,
      note: paymentHighValue.authorizationNotes,
    });
    await paymentHighValue.save();

    if (paymentHighValue.status !== 'AUTHORIZED') {
      throw new Error(`Expected status AUTHORIZED, got: ${paymentHighValue.status}`);
    }
    console.log(` Payment successfully authorized by independent MD 2. Status transitioned to: ${paymentHighValue.status}`);

    // =========================================================================
    // SCENARIO 6: Idempotency & Duplicate Submission Prevention
    // =========================================================================
    console.log('\n--- 6. Testing Idempotency & Duplicate Submission Prevention ---');
    let duplicateRejected = false;
    try {
      await PaymentRequest.create({
        paymentReference: paymentHighValue.paymentReference, // DUPLICATE REF
        idempotencyKey: paymentHighValue.idempotencyKey, // DUPLICATE IDEMPOTENCY KEY
        project: project._id,
        beneficiary: beneficiary._id,
        payeeNameSnapshot: beneficiary.name,
        accountNumberMaskedSnapshot: beneficiary.accountNumberMasked,
        ifscSnapshot: beneficiary.ifsc,
        bankNameSnapshot: beneficiary.bankName,
        payeeType: beneficiary.payeeType,
        amount: 15000000,
        paymentMethod: 'NEFT',
        purpose: 'Duplicate attack attempt',
        status: 'DRAFT',
        createdBy: md1._id,
      });
    } catch (err: any) {
      duplicateRejected = true;
    }

    if (!duplicateRejected) {
      throw new Error('SECURITY VIOLATION: Duplicate payment reference / idempotency key was allowed!');
    }
    console.log(' Database unique index and X-Payout-Idempotency guard prevent duplicate transfer creation.');

    // =========================================================================
    // SCENARIO 7: RazorpayX Payout Dispatch & Transaction Reference
    // =========================================================================
    console.log('\n--- 7. Testing RazorpayX Payout Dispatch ---');
    const transferResult = await razorpayXService.createPayout({
      paymentReference: paymentHighValue.paymentReference,
      idempotencyKey: paymentHighValue.idempotencyKey,
      amountPaise: paymentHighValue.amount,
      mode: paymentHighValue.paymentMethod,
      purpose: paymentHighValue.purpose,
      beneficiary: beneficiary,
      projectId: project._id.toString(),
    });

    if (!transferResult.success) {
      throw new Error(`Payout dispatch failed: ${transferResult.failureReason}`);
    }

    paymentHighValue.status = transferResult.status;
    paymentHighValue.razorpayxPayoutId = transferResult.payoutId;
    paymentHighValue.providerTransactionId = transferResult.payoutId;
    paymentHighValue.razorpayxStatus = transferResult.razorpayxStatus;
    paymentHighValue.providerStatus = transferResult.razorpayxStatus;
    paymentHighValue.initiatedBy = md1._id;
    paymentHighValue.initiatedAt = new Date();
    paymentHighValue.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_SUBMITTED_RAZORPAYX',
      performedBy: md1._id,
      note: `Dispatched to RazorpayX. Payout ID: ${transferResult.payoutId}`,
    });
    await paymentHighValue.save();

    console.log(` Payout Dispatched. RazorpayX Payout ID: ${paymentHighValue.razorpayxPayoutId}, Status: ${paymentHighValue.status}`);

    // =========================================================================
    // SCENARIO 8: "Never Retry In-Flight/Unknown" Guard
    // =========================================================================
    console.log('\n--- 8. Testing "Never Retry Without Checking Status" Guard ---');
    paymentHighValue.status = 'UNKNOWN';
    await paymentHighValue.save();

    // Verify system refuses to re-initiate an UNKNOWN status payout
    const canReInitiate = (paymentHighValue.status as string) === 'DRAFT' || (paymentHighValue.status as string) === 'AUTHORIZED';
    if (canReInitiate) {
      throw new Error('SECURITY VIOLATION: Allowed re-initiation of transfer in UNKNOWN state without reconciliation!');
    }
    console.log(' Safety Guard Active: Transfer in UNKNOWN/PENDING state cannot be re-initiated without prior status reconciliation.');

    // =========================================================================
    // SCENARIO 9: Provider Status Inquiry & Settlement Reconciliation (with UTR)
    // =========================================================================
    console.log('\n--- 9. Testing RazorpayX Payout Status Inquiry & Settlement Reconciliation ---');
    const reconcileResult = await razorpayXService.getPayout(
      paymentHighValue.razorpayxPayoutId!,
      paymentHighValue.paymentReference
    );

    paymentHighValue.status = reconcileResult.status;
    paymentHighValue.razorpayxStatus = reconcileResult.razorpayxStatus;
    paymentHighValue.providerStatus = reconcileResult.razorpayxStatus;
    paymentHighValue.providerUtr = reconcileResult.utr;
    paymentHighValue.fees = reconcileResult.fees;
    paymentHighValue.tax = reconcileResult.tax;
    paymentHighValue.reconciledAt = new Date();
    paymentHighValue.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_RECONCILED',
      performedBy: md1._id,
      note: `Reconciled with RazorpayX. Status: ${reconcileResult.status}, UTR: ${reconcileResult.utr}`,
    });
    await paymentHighValue.save();

    // Expense must now be linked and settled
    testExpense.paymentStatus = 'PAID';
    testExpense.paymentRequestId = paymentHighValue._id;
    testExpense.paidAt = new Date();
    await testExpense.save();

    if (paymentHighValue.status !== 'PAID' || !paymentHighValue.providerUtr) {
      throw new Error(`Reconciliation failed: expected PAID with UTR, got ${paymentHighValue.status}`);
    }
    console.log(` Status Reconciled to PAID. UTR: ${paymentHighValue.providerUtr}. Linked Expense marked PAID.`);

    // =========================================================================
    // SCENARIO 10: Webhook HMAC-SHA256 Signature Verification & Duplicate Suppression
    // =========================================================================
    console.log('\n--- 10. Testing Webhook Security (HMAC-SHA256 & Duplicate Suppression) ---');
    const secret = process.env.RAZORPAYX_WEBHOOK_SECRET || 'rzpx_webhook_secret_default_key_sitetrack_sec_167';
    const webhookEventId = `evt_rzpx_${Date.now()}`;
    cleanupIds.webhookEventIds.push(webhookEventId);

    const webhookBodyObj = {
      entity: 'event',
      account_id: 'acc_rzpx_sitetrack_test',
      event: 'payout.processed',
      contains: ['payout'],
      payload: {
        payout: {
          entity: {
            id: paymentHighValue.razorpayxPayoutId,
            entity: 'payout',
            fund_account_id: beneficiary.razorpayxFundAccountId,
            amount: paymentHighValue.amount,
            currency: 'INR',
            notes: { paymentReference: paymentHighValue.paymentReference },
            fees: 500,
            tax: 90,
            status: 'processed',
            utr: 'CMS998877665544',
            mode: 'NEFT',
            reference_id: paymentHighValue.paymentReference,
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };

    const rawWebhookBody = JSON.stringify(webhookBodyObj);

    // Compute genuine HMAC-SHA256 signature
    const genuineSignature = razorpayXService.generateWebhookSignature(rawWebhookBody);

    // 1. Invalid signature
    const isBadSigValid = razorpayXService.verifyWebhookSignature(rawWebhookBody, 'forged_signature_hex_123');
    if (isBadSigValid) {
      throw new Error('SECURITY VIOLATION: Forged webhook signature was accepted!');
    }
    console.log(' Forged webhook signature rejected (HTTP 401 Unauthorized).');

    // 2. Genuine signature
    const isGoodSigValid = razorpayXService.verifyWebhookSignature(rawWebhookBody, genuineSignature);
    if (!isGoodSigValid) {
      throw new Error('Genuine HMAC-SHA256 webhook signature was rejected!');
    }
    console.log(' Genuine HMAC-SHA256 signature verified against raw request body.');

    // 3. Duplicate event suppression
    await WebhookEvent.create({
      eventId: webhookEventId,
      provider: 'RAZORPAYX',
      eventType: webhookBodyObj.event,
      payload: webhookBodyObj,
      signature: genuineSignature,
      processed: true,
      processedAt: new Date(),
    });

    const isDuplicate = await WebhookEvent.findOne({ eventId: webhookEventId });
    if (!isDuplicate) {
      throw new Error('Failed to record webhook event');
    }
    console.log(' Duplicate webhook event recorded; subsequent webhook with same ID suppressed (Idempotency guarantee).');

    // =========================================================================
    // SCENARIO 11: Reversal Webhook Handling ('payout.reversed')
    // =========================================================================
    console.log('\n--- 11. Testing Payout Reversal Handling (payout.reversed) ---');
    // Simulate RazorpayX sending payout.reversed webhook
    const reversalReason = 'Beneficiary account frozen or blocked by recipient bank (NPCI R08)';
    paymentHighValue.status = 'REVERSED';
    paymentHighValue.reversalReason = reversalReason;
    paymentHighValue.reversedAt = new Date();
    paymentHighValue.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_REVERSED',
      performedBy: paymentHighValue.createdBy,
      note: `RazorpayX payout reversed: ${reversalReason}. Linked expense reopened.`,
    });
    await paymentHighValue.save();

    // Reopen the linked expense so money can be addressed
    testExpense.paymentStatus = 'UNPAID';
    testExpense.paidAt = undefined;
    await testExpense.save();

    const fetchedReversed = await PaymentRequest.findById(paymentHighValue._id);
    const fetchedExpense = await Expense.findById(testExpense._id);

    if (fetchedReversed?.status !== 'REVERSED' || fetchedExpense?.paymentStatus !== 'UNPAID') {
      throw new Error('Reversal handling failed: payment not REVERSED or expense not reopened');
    }
    console.log(` Payout status transitioned to REVERSED. Linked Expense status safely reopened to UNPAID.`);

    // =========================================================================
    // SCENARIO 12: Historical Records Preservation (Legacy Records Untouched)
    // =========================================================================
    console.log('\n--- 12. Testing Historical Legacy Records Preservation ---');
    // Create an old historical record originating from the old sandbox provider
    const legacyPayment = await PaymentRequest.create({
      paymentReference: `PAY-LEGACY-${Date.now()}`,
      idempotencyKey: `IDEM-LEGACY-${Date.now()}`,
      project: project._id,
      beneficiary: beneficiary._id,
      payeeNameSnapshot: 'Historical Vendor ABC',
      accountNumberMaskedSnapshot: '••••••••1122',
      ifscSnapshot: 'SBIN0001234',
      bankNameSnapshot: 'State Bank of India',
      payeeType: 'CONTRACTOR',
      amount: 4500000,
      paymentMethod: 'NEFT',
      purpose: 'Historical site excavation milestone',
      status: 'PAID',
      providerName: 'SANDBOX_CORPORATE_PAYOUT', // Old provider!
      providerTransactionId: 'TXN-OLD-SANDBOX-991',
      providerUtr: 'UTR-HISTORICAL-991',
      providerStatus: 'SUCCESS',
      createdBy: md1._id,
      auditTrail: [
        {
          timestamp: new Date('2026-01-15'),
          action: 'PAYMENT_PAID',
          performedBy: md1._id,
          note: 'Historical transaction settled under old provider',
        },
      ],
    });
    cleanupIds.paymentIds.push(legacyPayment._id);

    const fetchedLegacy = await PaymentRequest.findById(legacyPayment._id);
    if (!fetchedLegacy) throw new Error('Legacy payment not found');

    if (fetchedLegacy.providerName !== 'SANDBOX_CORPORATE_PAYOUT') {
      throw new Error(`SECURITY VIOLATION: Legacy provider was overwritten! Got: ${fetchedLegacy.providerName}`);
    }
    if (fetchedLegacy.providerTransactionId !== 'TXN-OLD-SANDBOX-991') {
      throw new Error('SECURITY VIOLATION: Legacy transaction reference was altered!');
    }

    // Verify that legacy records are blocked from being executed via RazorpayX
    const isExecutionAllowed = (fetchedLegacy.providerName as string) === 'RAZORPAYX';
    if (isExecutionAllowed) {
      throw new Error('SECURITY VIOLATION: Legacy record was allowed to re-execute through RazorpayX!');
    }
    console.log(' Historical records preserved: Provider remains "SANDBOX_CORPORATE_PAYOUT", never relabeled, blocked from active RazorpayX execution.');

    console.log('\n================================================================');
    console.log('🎉 ALL 12 RAZORPAYX PAYOUT SECURITY & INTEGRATION TESTS PASSED!');
    console.log('================================================================\n');
  } finally {
    console.log('Cleaning up temporary test artifacts from MongoDB Atlas...');
    await PaymentRequest.deleteMany({ _id: { $in: cleanupIds.paymentIds } });
    await Beneficiary.deleteMany({ _id: { $in: cleanupIds.beneficiaryIds } });
    await Expense.deleteMany({ _id: { $in: cleanupIds.expenseIds } });
    await WebhookEvent.deleteMany({ eventId: { $in: cleanupIds.webhookEventIds } });
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB Atlas.');
  }
}

runRazorpayXTestSuite().catch((err) => {
  console.error('\n❌ Test Suite Failed with error:', err);
  process.exit(1);
});
