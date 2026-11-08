import { Router } from 'express';
import {
  createPaymentRequest,
  listPaymentRequests,
  getPaymentRequestById,
  reviewPaymentRequest,
  authorizePaymentRequest,
  rejectPaymentRequest,
  initiatePaymentTransfer,
  reconcilePayment,
  cancelPaymentRequest,
  parseUpiQr,
  generatePaymentQr,
  getPaymentQrStatus,
  handlePaymentWebhook,
  payPaymentRequest,
  voidPaymentEntry,
  confirmPaymentReceived,
  getPaymentSummary,
  exportPaymentsRegister,
} from '../controllers/paymentController.js';
import {
  createBeneficiary,
  listBeneficiaries,
  getBeneficiaryById,
  validateBeneficiaryAccount,
} from '../controllers/beneficiaryController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Public Webhook endpoint (Signature verified using raw body)
router.post('/webhook', handlePaymentWebhook);

// Protected endpoints
router.use(authenticate);

// Beneficiaries
router.post('/beneficiaries', createBeneficiary);
router.get('/beneficiaries', listBeneficiaries);
router.get('/beneficiaries/:id', getBeneficiaryById);
router.post('/beneficiaries/:id/validate', validateBeneficiaryAccount);

// Summary & register
router.get('/summary', getPaymentSummary);
router.get('/register', exportPaymentsRegister);

// Payment Requests
router.post('/requests', createPaymentRequest);
router.get('/requests', listPaymentRequests);
router.get('/requests/:id', getPaymentRequestById);
router.put('/requests/:id/review', reviewPaymentRequest);
router.post('/requests/:id/authorize', authorizePaymentRequest);
router.post('/requests/:id/reject', rejectPaymentRequest);
router.post('/requests/:id/initiate', initiatePaymentTransfer);
router.post('/requests/:id/reconcile', reconcilePayment);
router.post('/requests/:id/cancel', cancelPaymentRequest);
// MD approves by paying (UPI / bank transfer / cheque / cash), part payments allowed
router.post('/requests/:id/pay', payPaymentRequest);
router.post('/requests/:id/settlements/:settlementId/void', voidPaymentEntry);
router.post('/requests/:id/settlements/:settlementId/confirm', confirmPaymentReceived);

// QR Workflows
router.post('/qr/parse-upi', parseUpiQr);
router.post('/qr/generate', generatePaymentQr);
router.get('/qr/:qrId/status', getPaymentQrStatus);

export default router;
