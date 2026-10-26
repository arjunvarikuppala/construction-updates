import { Router } from 'express';
import { authenticate, requireMD } from '../middleware/auth.js';
import {
  createBeneficiary,
  listBeneficiaries,
  getBeneficiaryById,
  validateBeneficiaryAccount,
} from '../controllers/beneficiaryController.js';
import {
  createPaymentRequest,
  listPaymentRequests,
  getPaymentRequestById,
  authorizePaymentRequest,
  initiatePaymentTransfer,
  reconcilePaymentStatus,
  cancelPaymentRequest,
  handlePaymentWebhook,
} from '../controllers/paymentController.js';

const router = Router();

// 1. Webhook endpoint (unauthenticated at HTTP level, validated via cryptographic HMAC-SHA256 signature)
router.post('/webhook', handlePaymentWebhook);

// 2. Beneficiaries
router.post('/beneficiaries', authenticate, createBeneficiary);
router.get('/beneficiaries', authenticate, listBeneficiaries);
router.get('/beneficiaries/:id', authenticate, getBeneficiaryById);
router.post('/beneficiaries/:id/validate', authenticate, validateBeneficiaryAccount);

// 3. Payment Requests
router.post('/requests', authenticate, createPaymentRequest);
router.get('/requests', authenticate, listPaymentRequests);
router.get('/requests/:id', authenticate, getPaymentRequestById);

// 4. Executive MD Operations (Authorization & Outbound Payout Initiation)
router.post('/requests/:id/authorize', authenticate, requireMD, authorizePaymentRequest);
router.post('/requests/:id/initiate', authenticate, requireMD, initiatePaymentTransfer);
router.post('/requests/:id/reconcile', authenticate, reconcilePaymentStatus);
router.post('/requests/:id/cancel', authenticate, cancelPaymentRequest);

export default router;
