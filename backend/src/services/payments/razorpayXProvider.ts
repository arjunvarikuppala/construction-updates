import crypto from 'crypto';
import {
  IPaymentProvider,
  BeneficiaryValidationResult,
  TransferRequest,
  TransferResponse,
  ReconcileResponse,
} from './types.js';

export class RazorpayXPayoutProvider implements IPaymentProvider {
  public readonly name = 'RAZORPAYX_PAYOUTS';
  public readonly isLive = true;

  private apiKey: string;
  private apiSecret: string;
  private accountNumber: string;
  private webhookSecret: string;
  private isLiveEnabled: boolean;

  constructor() {
    this.apiKey = process.env.RAZORPAYX_KEY_ID || '';
    this.apiSecret = process.env.RAZORPAYX_KEY_SECRET || '';
    this.accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER || '';
    this.webhookSecret = process.env.PAYMENTS_WEBHOOK_SECRET || '';
    // Safety guard: Live payouts are strictly disabled by default until security checks & credentials are confirmed
    this.isLiveEnabled = process.env.PAYMENTS_LIVE_ENABLED === 'true';
  }

  private getAuthHeader(): string {
    const credentials = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  public async validateBeneficiary(
    accountNumber: string,
    ifsc: string,
    expectedName: string
  ): Promise<BeneficiaryValidationResult> {
    if (!this.isLiveEnabled) {
      throw new Error(
        'RazorpayX Live transfers are currently disabled (PAYMENTS_LIVE_ENABLED=false). Complete provider onboarding & credentials setup before enabling live beneficiary checks.'
      );
    }

    try {
      const response = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_number: this.accountNumber,
          fund_account: {
            account_type: 'bank_account',
            bank_account: {
              name: expectedName,
              ifsc,
              account_number: accountNumber,
            },
          },
          amount: 100, // 100 paise = ₹1 penny drop
          currency: 'INR',
          notes: {
            purpose: 'SiteTrack Contractor Beneficiary Validation',
          },
        }),
      });

      const data: any = await response.json();
      if (!response.ok) {
        return {
          isValid: false,
          accountExists: false,
          failureReason: data.error?.description || 'Penny drop beneficiary validation failed.',
        };
      }

      const isValid = data.status === 'completed';
      return {
        isValid,
        accountExists: isValid,
        registeredName: data.registered_name || expectedName,
        providerRef: data.id,
        failureReason: isValid ? undefined : data.results?.account_status,
      };
    } catch (error: any) {
      return {
        isValid: false,
        accountExists: false,
        failureReason: error.message || 'Network error connecting to RazorpayX validation endpoint',
      };
    }
  }

  public async initiateTransfer(req: TransferRequest): Promise<TransferResponse> {
    if (!this.isLiveEnabled) {
      return {
        success: false,
        providerTransactionId: '',
        providerStatus: 'LIVE_DISABLED',
        status: 'FAILED',
        failureReason:
          'Live transfers blocked: PAYMENTS_LIVE_ENABLED is not set to true. Live funds are safeguarded until bank onboarding is verified.',
      };
    }

    try {
      const payload = {
        account_number: this.accountNumber,
        amount: req.amountPaise,
        currency: 'INR',
        mode: req.paymentMethod, // NEFT or RTGS
        purpose: 'vendor_payment',
        fund_account: {
          account_type: 'bank_account',
          bank_account: {
            name: req.beneficiary.name,
            ifsc: req.beneficiary.ifsc,
            account_number: req.beneficiary.accountNumber,
          },
          contact: {
            name: req.beneficiary.name,
            type: 'vendor',
          },
        },
        queue_if_low_balance: false,
        reference_id: req.paymentReference,
        narration: req.purpose.slice(0, 30),
      };

      const response = await fetch('https://api.razorpay.com/v1/payouts', {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
          'X-Payout-Idempotency': req.idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      const data: any = await response.json();

      if (!response.ok) {
        return {
          success: false,
          providerTransactionId: data.id || '',
          providerStatus: data.status || 'FAILED',
          status: 'FAILED',
          failureReason: data.error?.description || 'Payout creation rejected by gateway.',
          rawResponse: data,
        };
      }

      // Map RazorpayX status (queued, pending, processing, processed, reversed, cancelled, rejected)
      let mappedStatus: any = 'PROCESSING';
      if (data.status === 'processed') mappedStatus = 'PAID';
      if (data.status === 'rejected' || data.status === 'cancelled') mappedStatus = 'FAILED';

      return {
        success: mappedStatus !== 'FAILED',
        providerTransactionId: data.id,
        providerStatus: data.status,
        status: mappedStatus,
        utr: data.utr,
        rawResponse: data,
      };
    } catch (err: any) {
      // If network fails during HTTP request, status is UNKNOWN (never retry blindly!)
      return {
        success: false,
        providerTransactionId: '',
        providerStatus: 'NETWORK_TIMEOUT',
        status: 'UNKNOWN',
        failureReason: `Network error or timeout contacting gateway: ${err.message}. Reconciliation required.`,
      };
    }
  }

  public async reconcilePayment(
    providerTransactionId: string,
    _paymentReference: string
  ): Promise<ReconcileResponse> {
    if (!this.isLiveEnabled) {
      return {
        status: 'FAILED',
        providerTransactionId,
        providerStatus: 'LIVE_DISABLED',
        failureReason: 'Live API calls disabled.',
      };
    }

    try {
      const response = await fetch(`https://api.razorpay.com/v1/payouts/${providerTransactionId}`, {
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });

      const data: any = await response.json();
      let mappedStatus: any = 'PROCESSING';
      if (data.status === 'processed') mappedStatus = 'PAID';
      if (data.status === 'rejected' || data.status === 'cancelled' || data.status === 'reversed') mappedStatus = 'FAILED';

      return {
        status: mappedStatus,
        providerTransactionId: data.id,
        providerStatus: data.status,
        utr: data.utr,
        failureReason: data.failure_reason,
        settledAt: data.status === 'processed' ? new Date() : undefined,
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        status: 'UNKNOWN',
        providerTransactionId,
        providerStatus: 'FETCH_ERROR',
        failureReason: err.message,
      };
    }
  }

  public verifyWebhookSignature(payload: string | Record<string, any>, signature: string): boolean {
    if (!signature || !this.webhookSecret) return false;
    try {
      const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(bodyString)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
