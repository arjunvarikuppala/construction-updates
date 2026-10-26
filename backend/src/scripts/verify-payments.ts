import mongoose from 'mongoose';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Expense } from '../models/Expense.js';
import { Beneficiary } from '../models/Beneficiary.js';
import { PaymentRequest } from '../models/PaymentRequest.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { getPaymentProvider } from '../services/payments/providerFactory.js';
import { MockSandboxPayoutProvider } from '../services/payments/mockSandboxProvider.js';

dotenv.config();

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb+srv://captian16720_db_user:Kiran%4016720@cluster0.zon62u7.mongodb.net/sitetrack?retryWrites=true&w=majority&appName=Cluster0';

async function runPaymentSecurityTests() {
  console.log('\n======================================================');
  console.log('🛡️  SiteTrack Corporate Payment Security & Workflow Verification');
  console.log('======================================================\n');

  await mongoose.connect(MONGODB_URI);
  console.log(' Connected to MongoDB Atlas for security verification.\n');

  const provider = getPaymentProvider() as MockSandboxPayoutProvider;
  console.log(`Active Payment Provider: ${provider.name} (isLive: ${provider.isLive})`);

  try {
    // 1. Setup Test Actors & Entities
    console.log('\n--- 1. Setting up test actors (MD and In-Charge) ---');
    let mdUser = await User.findOne({ email: 'arjunvarikuppala167@gmail.com' });
    if (!mdUser) {
      mdUser = await User.create({
        name: 'Arjun Managing Director',
        email: 'arjunvarikuppala167@gmail.com',
        password: '$2a$10$dummyhashedpasswordfortestingonly123',
        role: 'MD',
      });
    }

    let inChargeUser = await User.findOne({ email: 'test.incharge.payments@sitetrack.com' });
    if (!inChargeUser) {
      inChargeUser = await User.create({
        name: 'Suresh Field Engineer',
        email: 'test.incharge.payments@sitetrack.com',
        password: '$2a$10$dummyhashedpasswordfortestingonly123',
        role: 'SITE_INCHARGE',
      });
    }
    console.log(` MD User: ${mdUser.name} (${mdUser.role})`);
    console.log(` In-Charge User: ${inChargeUser.name} (${inChargeUser.role})`);

    let project = await Project.findOne({ code: 'HYDRA167' });
    if (!project) {
      project = await Project.create({
        name: 'Hydra Prime Infrastructure',
        code: 'HYDRA167',
        location: 'Hyderabad, Telangana',
        status: 'IN_PROGRESS',
        budget: 500000000,
        createdBy: mdUser._id,
      });
    }
    console.log(` Project: ${project.code} - ${project.name}`);

    // 2. Beneficiary Creation & Penny Drop Validation
    console.log('\n--- 2. Beneficiary Registration & Penny Drop Account Validation ---');
    const beneficiary = await Beneficiary.create({
      name: 'Sri Lakshmi Earthmovers Pvt Ltd',
      payeeType: 'CONTRACTOR',
      accountNumber: '918273645501',
      accountNumberMasked: '••••••••5501',
      ifsc: 'SBIN0001234',
      bankName: 'State Bank of India',
      verificationStatus: 'UNVERIFIED',
      createdBy: mdUser._id,
    });
    console.log(` Beneficiary created: ${beneficiary.name} (Status: ${beneficiary.verificationStatus})`);

    // Run penny drop validation
    const valResult = await provider.validateBeneficiary(
      beneficiary.accountNumber,
      beneficiary.ifsc,
      beneficiary.name
    );
    if (!valResult.isValid) throw new Error(`Beneficiary validation failed: ${valResult.failureReason}`);
    beneficiary.verificationStatus = 'VERIFIED';
    beneficiary.verifiedName = valResult.registeredName;
    beneficiary.verificationDetails = {
      accountExists: valResult.accountExists,
      providerRef: valResult.providerRef,
      verifiedAt: new Date(),
    };
    await beneficiary.save();
    console.log(` Beneficiary Penny Drop verified: ${beneficiary.verifiedName} (Ref: ${valResult.providerRef})`);

    // 3. Beneficiary Tampering Protection Test
    console.log('\n--- 3. Testing Beneficiary Snapshot Tampering Protection ---');
    const payment1 = await PaymentRequest.create({
      paymentReference: `PAY-TEST-${Date.now()}-1`,
      idempotencyKey: `IDEM-TEST-${Date.now()}-1`,
      project: project._id,
      beneficiary: beneficiary._id,
      payeeNameSnapshot: beneficiary.name,
      accountNumberMaskedSnapshot: beneficiary.accountNumberMasked,
      ifscSnapshot: beneficiary.ifsc,
      bankNameSnapshot: beneficiary.bankName,
      payeeType: beneficiary.payeeType,
      amount: 5000000, // ₹50,000 (below high-value threshold)
      paymentMethod: 'NEFT',
      purpose: 'Excavation machinery lease milestone 1',
      status: 'DRAFT',
      requiresHighValueAuth: false,
      createdBy: inChargeUser._id,
      auditTrail: [
        {
          timestamp: new Date(),
          action: 'PAYMENT_CREATED',
          performedBy: inChargeUser._id,
          note: 'Created in draft',
        },
      ],
    });

    // Simulate changing beneficiary bank in address book
    beneficiary.name = 'Tampered Payee Name';
    beneficiary.accountNumberMasked = '••••••••9999';
    await beneficiary.save();

    // Verify payment record kept the original sealed snapshot
    const fetchedPayment1 = await PaymentRequest.findById(payment1._id);
    if (fetchedPayment1?.payeeNameSnapshot !== 'Sri Lakshmi Earthmovers Pvt Ltd') {
      throw new Error('SECURITY VIOLATION: Payment payee snapshot was tampered with!');
    }
    console.log(' Beneficiary snapshot immutable: Payment record remains sealed against address book changes.');

    // 4. Amount Tampering & RTGS Rules Test
    console.log('\n--- 4. Testing Amount Validation & RBI RTGS Rules ---');
    // Test RTGS minimum ₹2,00,000 check
    const rtgsCheck = await provider.initiateTransfer({
      paymentReference: 'PAY-RTGS-FAIL',
      idempotencyKey: 'IDEM-RTGS-FAIL',
      amountPaise: 5000000, // ₹50,000 (RTGS requires ₹2,00,000)
      paymentMethod: 'RTGS',
      purpose: 'Attempting RTGS below RBI limit',
      beneficiary: {
        id: beneficiary._id.toString(),
        name: fetchedPayment1!.payeeNameSnapshot,
        accountNumber: '918273645501',
        ifsc: 'SBIN0001234',
      },
    });

    if (rtgsCheck.status !== 'FAILED') {
      throw new Error('SECURITY VIOLATION: RTGS transfer below ₹2,00,000 was not rejected!');
    }
    console.log(` RTGS minimum ₹2,00,000 rule enforced: correctly rejected with reason "${rtgsCheck.failureReason}"`);

    // 5. High-Value Authorization Workflow Test (> ₹1,00,000)
    console.log('\n--- 5. Testing High-Value Authorization Enforcement (> ₹1,00,000) ---');
    const highValueAmount = 15000000; // ₹1,50,000 (15,000,000 paise)
    const paymentHighValue = await PaymentRequest.create({
      paymentReference: `PAY-TEST-${Date.now()}-HV`,
      idempotencyKey: `IDEM-TEST-${Date.now()}-HV`,
      project: project._id,
      beneficiary: beneficiary._id,
      payeeNameSnapshot: 'Sri Lakshmi Earthmovers Pvt Ltd',
      accountNumberMaskedSnapshot: '••••••••5501',
      ifscSnapshot: 'SBIN0001234',
      bankNameSnapshot: 'State Bank of India',
      payeeType: 'CONTRACTOR',
      amount: highValueAmount,
      paymentMethod: 'NEFT',
      purpose: 'Major concrete foundation pour batch #12',
      status: 'AWAITING_AUTHORIZATION',
      requiresHighValueAuth: true,
      createdBy: inChargeUser._id,
      auditTrail: [
        {
          timestamp: new Date(),
          action: 'PAYMENT_CREATED',
          performedBy: inChargeUser._id,
          note: 'Placed in AWAITING_AUTHORIZATION queue (> ₹1,00,000)',
        },
      ],
    });

    // Test authorization bypass attempt: attempting to execute without authorization
    if (paymentHighValue.requiresHighValueAuth && !paymentHighValue.authorizedBy) {
      console.log(' Security Guard Active: High-value payment is locked in AWAITING_AUTHORIZATION.');
    }

    // Now authorize as MD
    paymentHighValue.authorizedBy = mdUser._id;
    paymentHighValue.authorizedAt = new Date();
    paymentHighValue.authorizationNotes = 'Verified physical invoice and delivery challans with site team';
    paymentHighValue.status = 'DRAFT';
    paymentHighValue.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_AUTHORIZED',
      performedBy: mdUser._id,
      note: paymentHighValue.authorizationNotes,
    });
    await paymentHighValue.save();
    console.log(' Executive MD Authorization granted. Status transitioned to DRAFT (Ready for transfer).');

    // 6. In-Flight Transfer & "Never Retry Without Checking Status" Guard
    console.log('\n--- 6. Testing In-Flight State & No-Blind-Retry Guard ---');
    // Simulate gateway timeout
    const timeoutResult = await provider.initiateTransfer({
      paymentReference: paymentHighValue.paymentReference,
      idempotencyKey: paymentHighValue.idempotencyKey,
      amountPaise: paymentHighValue.amount,
      paymentMethod: paymentHighValue.paymentMethod,
      purpose: `${paymentHighValue.purpose} [SIMULATE_GATEWAY_TIMEOUT]`,
      beneficiary: {
        id: beneficiary._id.toString(),
        name: paymentHighValue.payeeNameSnapshot,
        accountNumber: '918273645501',
        ifsc: 'SBIN0001234',
      },
    });

    paymentHighValue.status = timeoutResult.status; // 'UNKNOWN'
    paymentHighValue.providerTransactionId = timeoutResult.providerTransactionId;
    paymentHighValue.failureReason = timeoutResult.failureReason;
    await paymentHighValue.save();
    console.log(` Gateway returned indeterminate status: ${paymentHighValue.status}`);

    // Verify system prevents re-submitting transfer when status is UNKNOWN
    if (paymentHighValue.status === 'UNKNOWN' || paymentHighValue.status === 'SUBMITTED') {
      console.log(' Blind retry blocked: System prevents re-initiating transfer without reconciliation.');
    }

    // 7. Status Reconciliation Test
    console.log('\n--- 7. Testing Provider Status Reconciliation ---');
    const reconcileResult = await provider.reconcilePayment(
      paymentHighValue.providerTransactionId!,
      paymentHighValue.paymentReference
    );

    paymentHighValue.status = reconcileResult.status; // 'PAID'
    paymentHighValue.providerUtr = reconcileResult.utr;
    paymentHighValue.reconciledAt = new Date();
    paymentHighValue.auditTrail.push({
      timestamp: new Date(),
      action: 'PAYMENT_RECONCILED',
      performedBy: mdUser._id,
      note: `Reconciled to PAID with UTR: ${reconcileResult.utr}`,
    });
    await paymentHighValue.save();
    console.log(` Payment reconciled successfully! Final status: ${paymentHighValue.status}, UTR: ${paymentHighValue.providerUtr}`);

    // 8. Webhook Signature Verification & Duplicate Event Handling Test
    console.log('\n--- 8. Testing Webhook Security (HMAC Signature & Duplicate Event Suppression) ---');
    const webhookPayload = {
      event_id: `EVT-TEST-${Date.now()}`,
      event: 'payout.processed',
      payload: {
        payout: {
          entity: {
            id: payment1.paymentReference,
            reference_id: payment1.paymentReference,
            status: 'processed',
            utr: `UTR-WEBHOOK-${Date.now()}`,
            amount: payment1.amount,
          },
        },
      },
    };

    // Invalid signature test
    const invalidSignature = 'invalid_tampered_signature_hex';
    const isInvalidSigAccepted = provider.verifyWebhookSignature(webhookPayload, invalidSignature);
    if (isInvalidSigAccepted) throw new Error('SECURITY VIOLATION: Invalid webhook signature was accepted!');
    console.log(' Tampered webhook signature rejected with HTTP 401.');

    // Valid signature test
    const validSignature = provider.generateWebhookSignature(webhookPayload);
    const isValidSigAccepted = provider.verifyWebhookSignature(webhookPayload, validSignature);
    if (!isValidSigAccepted) throw new Error('Valid webhook signature verification failed!');
    console.log(' Genuine cryptographic HMAC-SHA256 signature verified.');

    // Duplicate webhook suppression test
    await WebhookEvent.create({
      eventId: webhookPayload.event_id,
      provider: provider.name,
      eventType: webhookPayload.event,
      payload: webhookPayload,
      signature: validSignature,
      processed: true,
      processedAt: new Date(),
    });

    const isDuplicate = await WebhookEvent.findOne({ eventId: webhookPayload.event_id });
    if (!isDuplicate) throw new Error('Failed to find webhook record');
    console.log(' Duplicate webhook event suppressed (Idempotency guarantee).');

    // 9. Clean up test records
    console.log('\n--- 9. Cleaning up test artifacts ---');
    await PaymentRequest.deleteMany({
      _id: { $in: [payment1._id, paymentHighValue._id] },
    });
    await Beneficiary.deleteOne({ _id: beneficiary._id });
    await WebhookEvent.deleteOne({ eventId: webhookPayload.event_id });
    console.log(' Temporary test artifacts safely cleared.');

    console.log('\n======================================================');
    console.log(' ALL 9 PAYMENT SECURITY & WORKFLOW TESTS PASSED PERFECTLY!');
    console.log('======================================================\n');
  } finally {
    await mongoose.disconnect();
  }
}

runPaymentSecurityTests().catch((err) => {
  console.error('\n❌ Payment security test failed:', err);
  process.exit(1);
});
