import { PaymentMethod, PaymentRequestStatus } from '../../models/PaymentRequest.js';

export interface BeneficiaryValidationResult {
  isValid: boolean;
  accountExists: boolean;
  registeredName?: string;
  bankName?: string;
  branch?: string;
  providerRef?: string;
  failureReason?: string;
}

export interface TransferRequest {
  paymentReference: string;
  idempotencyKey: string;
  amountPaise: number;
  paymentMethod: PaymentMethod;
  purpose: string;
  beneficiary: {
    id: string;
    name: string;
    accountNumber: string;
    ifsc: string;
    providerBeneficiaryId?: string;
  };
}

export interface TransferResponse {
  success: boolean;
  providerTransactionId: string;
  providerStatus: string;
  status: PaymentRequestStatus;
  utr?: string;
  failureReason?: string;
  rawResponse?: Record<string, any>;
}

export interface ReconcileResponse {
  status: PaymentRequestStatus;
  providerTransactionId: string;
  providerStatus: string;
  utr?: string;
  failureReason?: string;
  settledAt?: Date;
  rawResponse?: Record<string, any>;
}

export interface IPaymentProvider {
  readonly name: string;
  readonly isLive: boolean;

  validateBeneficiary(
    accountNumber: string,
    ifsc: string,
    expectedName: string
  ): Promise<BeneficiaryValidationResult>;

  initiateTransfer(req: TransferRequest): Promise<TransferResponse>;

  reconcilePayment(
    providerTransactionId: string,
    paymentReference: string
  ): Promise<ReconcileResponse>;

  verifyWebhookSignature(payload: string | Record<string, any>, signature: string): boolean;
}
