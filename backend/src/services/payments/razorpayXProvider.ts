import {
  IPaymentProvider,
  BeneficiaryValidationResult,
  TransferRequest,
  TransferResponse,
  ReconcileResponse,
} from './types.js';
import { razorpayXService } from './razorpayXService.js';
import { Beneficiary } from '../../models/Beneficiary.js';

export class RazorpayXPayoutProvider implements IPaymentProvider {
  public readonly name = 'RAZORPAYX_PAYOUTS';
  public readonly isLive = process.env.PAYMENTS_LIVE_ENABLED === 'true';

  public async validateBeneficiary(
    accountNumber: string,
    ifsc: string,
    expectedName: string
  ): Promise<BeneficiaryValidationResult> {
    const beneficiaryMock = {
      name: expectedName,
      accountNumber,
      ifsc,
      bankName: `${ifsc.slice(0, 4)} Bank`,
      save: async () => {},
    } as any;

    const result = await razorpayXService.validateBeneficiary(beneficiaryMock);
    return {
      isValid: result.isValid,
      accountExists: result.accountExists,
      registeredName: result.registeredName,
      bankName: result.bankName,
      providerRef: result.validationId,
      failureReason: result.failureReason,
    };
  }

  public async initiateTransfer(req: TransferRequest): Promise<TransferResponse> {
    const beneficiaryDoc = await Beneficiary.findById(req.beneficiary.id);
    if (!beneficiaryDoc) {
      return {
        success: false,
        providerTransactionId: '',
        providerStatus: 'BENEFICIARY_NOT_FOUND',
        status: 'FAILED',
        failureReason: 'Beneficiary record not found for RazorpayX transfer',
      };
    }

    const result = await razorpayXService.createPayout({
      paymentReference: req.paymentReference,
      idempotencyKey: req.idempotencyKey,
      amountPaise: req.amountPaise,
      mode: req.paymentMethod,
      purpose: req.purpose,
      beneficiary: beneficiaryDoc,
      projectId: '',
    });

    return {
      success: result.success,
      providerTransactionId: result.payoutId,
      providerStatus: result.razorpayxStatus,
      status: result.status,
      utr: result.utr,
      failureReason: result.failureReason,
      rawResponse: result.rawResponse,
    };
  }

  public async reconcilePayment(
    providerTransactionId: string,
    paymentReference: string
  ): Promise<ReconcileResponse> {
    const result = await razorpayXService.getPayout(providerTransactionId, paymentReference);
    return {
      status: result.status,
      providerTransactionId: result.payoutId,
      providerStatus: result.razorpayxStatus,
      utr: result.utr,
      failureReason: result.failureReason,
      settledAt: result.status === 'PAID' ? new Date() : undefined,
      rawResponse: result.rawResponse,
    };
  }

  public verifyWebhookSignature(payload: string | Buffer | Record<string, any>, signature: string): boolean {
    const raw = Buffer.isBuffer(payload) || typeof payload === 'string'
      ? payload
      : JSON.stringify(payload);
    return razorpayXService.verifyWebhookSignature(raw, signature);
  }
}
