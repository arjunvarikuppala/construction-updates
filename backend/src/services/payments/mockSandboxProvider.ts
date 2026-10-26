import crypto from 'crypto';
import {
  IPaymentProvider,
  BeneficiaryValidationResult,
  TransferRequest,
  TransferResponse,
  ReconcileResponse,
} from './types.js';

const BANK_IFSC_PREFIXES: Record<string, string> = {
  SBIN: 'State Bank of India',
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  UTIB: 'Axis Bank',
  PUNB: 'Punjab National Bank',
  BARB: 'Bank of Baroda',
  KKBK: 'Kotak Mahindra Bank',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India',
  IDIB: 'Indian Bank',
  YESB: 'Yes Bank',
  INDB: 'IndusInd Bank',
};

export class MockSandboxPayoutProvider implements IPaymentProvider {
  public readonly name = 'SANDBOX_CORPORATE_PAYOUT';
  public readonly isLive = false;

  private webhookSecret: string;
  private transactionLedger = new Map<string, { status: string; utr?: string; failureReason?: string }>();

  constructor() {
    this.webhookSecret = process.env.PAYMENTS_WEBHOOK_SECRET || 'sitetrack_sandbox_webhook_secret_key_2026';
  }

  public resolveBankNameFromIFSC(ifsc: string): string {
    const prefix = ifsc.substring(0, 4).toUpperCase();
    return BANK_IFSC_PREFIXES[prefix] || `${prefix} Bank (NEFT/RTGS Enabled)`;
  }

  public async validateBeneficiary(
    accountNumber: string,
    ifsc: string,
    expectedName: string
  ): Promise<BeneficiaryValidationResult> {
    const cleanAccount = accountNumber.replace(/\s+/g, '');
    const cleanIFSC = ifsc.trim().toUpperCase();

    // 1. Validation rules
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(cleanIFSC)) {
      return {
        isValid: false,
        accountExists: false,
        failureReason: 'Invalid IFSC format. Must be 11 alphanumeric characters with 5th character 0.',
      };
    }

    if (cleanAccount.length < 8 || cleanAccount.length > 22 || !/^\d+$/.test(cleanAccount)) {
      return {
        isValid: false,
        accountExists: false,
        failureReason: 'Account number must contain between 8 and 22 numeric digits.',
      };
    }

    // Deterministic test fixture: Simulated account failure
    if (cleanAccount.startsWith('00000000') || cleanAccount.startsWith('99999999')) {
      return {
        isValid: false,
        accountExists: false,
        bankName: this.resolveBankNameFromIFSC(cleanIFSC),
        failureReason: 'Bank responded: Account does not exist or has been frozen (NPCI Error Code: B1)',
      };
    }

    const bankName = this.resolveBankNameFromIFSC(cleanIFSC);
    const providerRef = `PENNY-DROP-SBX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return {
      isValid: true,
      accountExists: true,
      registeredName: expectedName.toUpperCase(),
      bankName,
      branch: 'Central Commercial Clearing Branch',
      providerRef,
    };
  }

  public async initiateTransfer(req: TransferRequest): Promise<TransferResponse> {
    const { paymentReference, amountPaise, paymentMethod, purpose } = req;

    // Minimum check for RTGS per RBI rule (₹2,00,000 = 20,000,000 paise)
    if (paymentMethod === 'RTGS' && amountPaise < 20000000) {
      return {
        success: false,
        providerTransactionId: '',
        providerStatus: 'REJECTED',
        status: 'FAILED',
        failureReason: 'RTGS minimum transfer amount is ₹2,00,000 per Reserve Bank of India guidelines. Please use NEFT.',
      };
    }

    // Deterministic test fixture: Simulated gateway timeout
    if (purpose.includes('[SIMULATE_GATEWAY_TIMEOUT]')) {
      const txId = `TXN-SBX-TIMEOUT-${Date.now()}`;
      this.transactionLedger.set(paymentReference, { status: 'UNKNOWN' });
      return {
        success: false,
        providerTransactionId: txId,
        providerStatus: 'GATEWAY_TIMEOUT',
        status: 'UNKNOWN',
        failureReason: 'Bank gateway did not return immediate acknowledgement. Manual or automated reconciliation required.',
      };
    }

    // Deterministic test fixture: Simulated immediate bank rejection
    if (purpose.includes('[SIMULATE_IMMEDIATE_FAIL]')) {
      return {
        success: false,
        providerTransactionId: `TXN-SBX-FAIL-${Date.now()}`,
        providerStatus: 'FAILED',
        status: 'FAILED',
        failureReason: 'Beneficiary bank clearing network returned: Account Dormant or Inactive (Clearing Code: N06)',
      };
    }

    const providerTransactionId = `PO-SBX-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const utr = `${paymentMethod}-SBX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000000 + Math.random() * 9000000)}`;

    // In sandbox, transfers transition to PAID
    this.transactionLedger.set(paymentReference, { status: 'PAID', utr });

    return {
      success: true,
      providerTransactionId,
      providerStatus: 'PROCESSED',
      status: 'PAID',
      utr,
      rawResponse: {
        mode: 'SANDBOX_EMULATION',
        clearingCycle: 'IMMEDIATE_SANDBOX_SETTLEMENT',
        settledAmountPaise: amountPaise,
        beneficiaryAccountMasked: `•••• ${req.beneficiary.accountNumber.slice(-4)}`,
      },
    };
  }

  public async reconcilePayment(
    providerTransactionId: string,
    paymentReference: string
  ): Promise<ReconcileResponse> {
    const existing = this.transactionLedger.get(paymentReference);

    if (existing && existing.status === 'PAID') {
      return {
        status: 'PAID',
        providerTransactionId,
        providerStatus: 'SETTLED',
        utr: existing.utr,
        settledAt: new Date(),
      };
    }

    if (existing && existing.status === 'UNKNOWN') {
      // Reconciling an unknown payment resolves it to PAID
      const resolvedUtr = `RECON-SBX-${Date.now()}`;
      this.transactionLedger.set(paymentReference, { status: 'PAID', utr: resolvedUtr });
      return {
        status: 'PAID',
        providerTransactionId,
        providerStatus: 'SETTLED_POST_RECONCILIATION',
        utr: resolvedUtr,
        settledAt: new Date(),
      };
    }

    // Default reconciliation for sandbox
    const utr = `UTR-RECON-${Date.now()}`;
    return {
      status: 'PAID',
      providerTransactionId,
      providerStatus: 'SETTLED',
      utr,
      settledAt: new Date(),
    };
  }

  public verifyWebhookSignature(payload: string | Record<string, any>, signature: string): boolean {
    if (!signature) return false;
    try {
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payloadString)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      );
    } catch {
      return false;
    }
  }

  public generateWebhookSignature(payload: string | Record<string, any>): string {
    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payloadString)
      .digest('hex');
  }
}
