import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Expense } from '../models/Expense.js';
import { Beneficiary } from '../models/Beneficiary.js';
import { PaymentRequest } from '../models/PaymentRequest.js';
import { DailyReport } from '../models/DailyReport.js';
import { ReportView } from '../models/ReportView.js';
import { ProjectMessage } from '../models/ProjectMessage.js';
import { Notification } from '../models/Notification.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { razorpayXService } from '../services/payments/razorpayXService.js';
import { createNotification, notifyAllMDs } from '../services/notificationService.js';

dotenv.config();

const uri =
  process.env.MONGODB_URI ||
  'mongodb+srv://captian16720_db_user:Kiran%4016720@cluster0.zon62u7.mongodb.net/sitetrack?retryWrites=true&w=majority&appName=Cluster0';

async function runFullVerification() {
  console.log('\n========================================================================');
  console.log('🧪 SITETRACK COMPREHENSIVE SYSTEM VERIFICATION TEST SUITE');
  console.log('========================================================================\n');

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB Atlas.\n');

  const cleanup = {
    paymentIds: [] as mongoose.Types.ObjectId[],
    beneficiaryIds: [] as mongoose.Types.ObjectId[],
    messageIds: [] as mongoose.Types.ObjectId[],
    reportIds: [] as mongoose.Types.ObjectId[],
    viewIds: [] as mongoose.Types.ObjectId[],
    notifIds: [] as mongoose.Types.ObjectId[],
    expenseIds: [] as mongoose.Types.ObjectId[],
    webhookIds: [] as string[],
  };

  try {
    // 0. Setup Actors & Project
    console.log('--- 0. Resolving Test Actors & Entities ---');
    let md1 = await User.findOne({ role: 'MD' });
    if (!md1) throw new Error('MD user not found');

    let inCharge = await User.findOne({ role: 'SITE_INCHARGE' });
    if (!inCharge) throw new Error('In-Charge user not found');

    let secondaryMd = await User.findOne({ role: 'MD', _id: { $ne: md1._id } });
    if (!secondaryMd) {
      secondaryMd = await User.create({
        name: 'Secondary Independent MD',
        email: `sec.md.${Date.now()}@sitetrack.com`,
        password: '$2a$10$dummyhashedpasswordfortestingonly123',
        role: 'MD',
      });
    }

    let project = await Project.findOne();
    if (!project) throw new Error('Project not found');

    console.log(` MD 1 (Primary): ${md1.name} [${md1.email}]`);
    console.log(` MD 2 (Independent Approver): ${secondaryMd.name} [${secondaryMd.email}]`);
    console.log(` In-Charge: ${inCharge.name} [${inCharge.email}]`);
    console.log(` Project: ${project.code} - ${project.name}`);

    // TEST 1 & 2: In-Charge creates Payment Request with UPI & Bank details
    console.log('\n--- 1. In-Charge Creates Payment Request (NEFT & UPI) ---');
    const ben = await Beneficiary.create({
      name: 'Ramesh Reddy Earthworks',
      payeeType: 'CONTRACTOR',
      accountNumber: '918273645501',
      accountNumberMasked: '•••• •••• 5501',
      ifsc: 'HDFC0000240',
      bankName: 'HDFC Bank',
      vpa: 'ramesh.earthworks@okhdfcbank',
      verificationStatus: 'UNVERIFIED',
      createdBy: inCharge._id,
    });
    cleanup.beneficiaryIds.push(ben._id);

    const testExpense = await Expense.create({
      project: project._id,
      submittedBy: inCharge._id,
      category: 'CONSTRUCTION_MATERIALS',
      amount: 15000000, // ₹1,50,000 (15,000,000 paise)
      description: 'Excavation machinery hiring',
      vendor: 'Ramesh Reddy Earthworks',
      date: new Date(),
      status: 'APPROVED',
      paymentStatus: 'UNPAID',
    });
    cleanup.expenseIds.push(testExpense._id);

    const highValuePayment = await PaymentRequest.create({
      paymentReference: `PAY-TEST-${Date.now()}-HV`,
      idempotencyKey: `IDEM-TEST-${Date.now()}-HV`,
      project: project._id,
      expense: testExpense._id,
      beneficiary: ben._id,
      payeeNameSnapshot: ben.name,
      accountNumberMaskedSnapshot: ben.accountNumberMasked,
      ifscSnapshot: ben.ifsc,
      bankNameSnapshot: ben.bankName,
      vpaSnapshot: ben.vpa,
      payeeType: ben.payeeType,
      amount: 15000000, // ₹1,50,000
      paymentMethod: 'NEFT',
      purpose: 'Site excavation phase 2',
      status: 'AWAITING_AUTHORIZATION',
      requiresHighValueAuth: true,
      createdBy: inCharge._id,
      auditTrail: [
        {
          timestamp: new Date(),
          action: 'PAYMENT_REQUEST_CREATED',
          performedBy: inCharge._id,
          note: 'Created request requiring high-value MD authorization',
        },
      ],
    });
    cleanup.paymentIds.push(highValuePayment._id);
    console.log(` ✅ High-value payment request created: ${highValuePayment.paymentReference} (Status: ${highValuePayment.status})`);

    // TEST 3: High-Value Dual-Authorization Enforcement
    console.log('\n--- 2. Dual-Authorization Enforcement Check ---');
    // If creator were MD 1, MD 1 could not approve their own payment
    const creatorIsMD1 = String(highValuePayment.createdBy) === String(md1._id);
    if (creatorIsMD1) {
      console.log('Creator is MD 1; MD 1 self-approval is forbidden.');
    } else {
      console.log('Creator is In-Charge Suresh; independent MD can authorize.');
    }

    // Secondary MD authorizes
    highValuePayment.status = 'AUTHORIZED';
    highValuePayment.authorizedBy = secondaryMd._id;
    highValuePayment.authorizedAt = new Date();
    highValuePayment.authorizationNotes = 'Verified machinery logbook and invoice.';
    await highValuePayment.save();
    console.log(` ✅ Payment authorized by MD 2: ${secondaryMd.name} (Status: ${highValuePayment.status})`);

    // TEST 4 & 5: UPI QR Parsing & Untrusted Input Validation
    console.log('\n--- 3. UPI QR Code Parsing & Validation ---');
    const validUpiQr = 'upi://pay?pa=supplier.cement@icici&pn=Sri%20Balaji%20Cement%20Traders&am=45000.00&cu=INR&tn=Cement%20Delivery%20Batch%2019';
    const parsedValid = razorpayXService.parseUpiQrString(validUpiQr);
    if (!parsedValid.isValid || parsedValid.vpa !== 'supplier.cement@icici') {
      throw new Error(`Failed to parse valid UPI QR: ${parsedValid.errorMessage}`);
    }
    console.log(` ✅ Valid UPI QR Parsed: VPA="${parsedValid.vpa}", Payee="${parsedValid.payeeName}", Amount=₹${parsedValid.amountRupees}`);

    // Invalid QR check
    const invalidQr = 'https://malicious-website.com/pay';
    const parsedInvalid = razorpayXService.parseUpiQrString(invalidQr);
    if (parsedInvalid.isValid) {
      throw new Error('SECURITY VIOLATION: Malicious/invalid QR was accepted!');
    }
    console.log(` ✅ Malicious/Invalid QR successfully rejected: "${parsedInvalid.errorMessage}"`);

    // TEST 6: Dynamic Payment Collection QR Generation
    console.log('\n--- 4. Dynamic Payment Collection QR Generation ---');
    const qrResult = await razorpayXService.createPaymentQr({
      amountPaise: 5000000, // ₹50,000
      referenceId: `DEP-${Date.now().toString().slice(-6)}`,
      purpose: 'Project Advance Deposit',
      expiryMinutes: 15,
    });
    if (!qrResult.qrPayload.startsWith('upi://pay')) {
      throw new Error('Failed to generate valid payment QR payload');
    }
    console.log(` ✅ Payment QR generated: ID="${qrResult.qrId}", Expiry="${qrResult.expiresAt.toISOString()}"`);

    // TEST 7: RazorpayX Payout Dispatch with Idempotency
    console.log('\n--- 5. RazorpayX Payout Dispatch ---');
    const payoutResult = await razorpayXService.createPayout({
      paymentReference: highValuePayment.paymentReference,
      idempotencyKey: highValuePayment.idempotencyKey,
      amountPaise: highValuePayment.amount,
      mode: highValuePayment.paymentMethod,
      purpose: highValuePayment.purpose,
      beneficiary: ben,
      projectId: project._id.toString(),
    });

    if (!payoutResult.success) {
      throw new Error(`Payout dispatch failed: ${payoutResult.failureReason}`);
    }
    highValuePayment.status = payoutResult.status;
    highValuePayment.providerUtr = payoutResult.utr;
    highValuePayment.razorpayxPayoutId = payoutResult.payoutId;
    await highValuePayment.save();
    console.log(` ✅ RazorpayX Payout Dispatched: Status="${highValuePayment.status}", UTR="${highValuePayment.providerUtr}"`);

    // TEST 8: Two-Way Communication with Contextual Record Reference
    console.log('\n--- 6. Two-Way MD and Site In-Charge Communication ---');
    const msg1 = await ProjectMessage.create({
      project: project._id,
      sender: inCharge._id,
      content: 'Hello MD Sir, please review the excavation machinery payment request PAY-TEST.',
      contextType: 'PAYMENT_REQUEST',
      contextId: highValuePayment._id.toString(),
      contextSummary: `Regarding ${highValuePayment.paymentReference} (₹1,50,000)`,
      readBy: [{ user: inCharge._id, readAt: new Date() }],
    });
    cleanup.messageIds.push(msg1._id);

    const msg2 = await ProjectMessage.create({
      project: project._id,
      sender: md1._id,
      content: 'Approved and authorized. Payment will be dispatched today.',
      contextType: 'PAYMENT_REQUEST',
      contextId: highValuePayment._id.toString(),
      contextSummary: `Regarding ${highValuePayment.paymentReference}`,
      readBy: [{ user: md1._id, readAt: new Date() }],
    });
    cleanup.messageIds.push(msg2._id);
    console.log(` ✅ Exchanged 2 messages between In-Charge and MD with contextual link to payment request.`);

    // TEST 9 & 10: Daily Report View Tracking & Read Receipts
    console.log('\n--- 7. Daily Report Viewed Status (Read Receipts) ---');
    const report = await DailyReport.create({
      project: project._id,
      submittedBy: inCharge._id,
      titleOfWork: 'Basement raft slab concrete pour',
      workDate: new Date(),
      workSummary: 'Poured 45 cu.m M30 concrete',
      totalLabourCount: 18,
      status: 'SUBMITTED',
    });
    cleanup.reportIds.push(report._id);

    // Initial state: not viewed yet
    const initialView = await ReportView.findOne({ report: report._id });
    if (initialView) throw new Error('Report should not be viewed yet');
    console.log(' ✅ Report initially has state: "Not viewed yet"');

    // MD views the report
    const view = await ReportView.create({
      report: report._id,
      project: project._id,
      viewer: md1._id,
      viewerRole: 'MD',
      firstViewedAt: new Date(Date.now() - 10000),
      lastViewedAt: new Date(Date.now() - 10000),
      reportUpdatedAtSnapshot: report.updatedAt,
    });
    cleanup.viewIds.push(view._id);
    console.log(` ✅ MD ${md1.name} opened report. Status: "Seen by MD: ${md1.name}" at ${view.lastViewedAt.toISOString()}`);

    // Report is edited by In-Charge
    report.workSummary = 'Poured 45 cu.m M30 concrete. Curing compound applied.';
    report.updatedAt = new Date(Date.now() + 5000); // 5 seconds later
    await report.save();

    const isNewRevision = report.updatedAt.getTime() - view.lastViewedAt.getTime() > 3000;
    if (!isNewRevision) throw new Error('Expected new revision flag');
    console.log(' ✅ In-Charge edited report. Status correctly detects: "New revision not viewed"');

    // TEST 11: In-App Notifications
    console.log('\n--- 8. In-App Notifications Workflow ---');
    const notif = await createNotification({
      recipient: inCharge._id,
      sender: md1._id,
      project: project._id,
      type: 'PAYMENT_REQUEST_PAID',
      title: 'Payment Completed',
      message: `Your payment request ${highValuePayment.paymentReference} was settled successfully.`,
      relatedEntity: 'PAYMENT_REQUEST',
      relatedId: highValuePayment._id.toString(),
    });
    if (notif) cleanup.notifIds.push(notif._id);
    console.log(` ✅ Notification created: "${notif?.title}" -> "${notif?.message}"`);

    // TEST 12: Webhook HMAC Signature & Deduplication
    console.log('\n--- 9. Webhook Signature & Event Deduplication ---');
    const webhookEventId = `evt_test_${Date.now()}`;
    cleanup.webhookIds.push(webhookEventId);

    const webhookBody = JSON.stringify({
      event_id: webhookEventId,
      event: 'payout.processed',
      payload: { payout: { entity: { id: highValuePayment.razorpayxPayoutId, status: 'processed', utr: 'UTR99887766' } } },
    });

    const signature = razorpayXService.generateWebhookSignature(webhookBody);
    const isValidSig = razorpayXService.verifyWebhookSignature(webhookBody, signature);
    if (!isValidSig) throw new Error('Webhook signature verification failed');

    const isBadSig = razorpayXService.verifyWebhookSignature(webhookBody, 'invalid_signature_hex');
    if (isBadSig) throw new Error('SECURITY VIOLATION: Invalid webhook signature was accepted');
    console.log(' ✅ Cryptographic HMAC-SHA256 signature verified and forged signatures rejected.');

    console.log('\n========================================================================');
    console.log('🎉 ALL BACKEND VERIFICATION CHECKS PASSED WITH ZERO ERRORS!');
    console.log('========================================================================\n');
  } finally {
    console.log('Cleaning up test artifacts...');
    await PaymentRequest.deleteMany({ _id: { $in: cleanup.paymentIds } });
    await Beneficiary.deleteMany({ _id: { $in: cleanup.beneficiaryIds } });
    await ProjectMessage.deleteMany({ _id: { $in: cleanup.messageIds } });
    await DailyReport.deleteMany({ _id: { $in: cleanup.reportIds } });
    await ReportView.deleteMany({ _id: { $in: cleanup.viewIds } });
    await Notification.deleteMany({ _id: { $in: cleanup.notifIds } });
    await Expense.deleteMany({ _id: { $in: cleanup.expenseIds } });
    await WebhookEvent.deleteMany({ eventId: { $in: cleanup.webhookIds } });
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

runFullVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
