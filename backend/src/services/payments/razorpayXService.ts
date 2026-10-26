import crypto from 'crypto';
import { Beneficiary, IBeneficiary } from '../../models/Beneficiary.js';
import { PaymentRequestStatus } from '../../models/PaymentRequest.js';

export interface RazorpayXContactPayload {
  name: string;
  email?: string;
  contact?: string;
  type: 'vendor' | 'employee' | 'customer' | 'self';
  reference_id?: string;
  notes?: Record<string, string>;
}

export interface RazorpayXFundAccountPayload {
  contact_id: string;
  account_type: 'bank_account';
  bank_account: {
    name: string;
    ifsc: string;
    account_number: string;
  };
}

export interface RazorpayXPayoutPayload {
  account_number: string;
  fund_account_id?: string;
  fund_account?: {
    account_type: 'bank_account';
    bank_account: {
      name: string;
      ifsc: string;
      account_number: string;
    };
    contact: {
      name: string;
      type: 'vendor';
    };
  };
  amount: number; // in integer paise
  currency: 'INR';
  mode: 'NEFT' | 'RTGS';
  purpose: 'vendor_payment' | 'salary';
  queue_if_low_balance?: boolean;
  reference_id: string;
  narration?: string; // Max 30 chars
  notes?: Record<string, any>;
}

export interface RazorpayXPayoutResult {
  success: boolean;
  payoutId: string;
  fundAccountId?: string;
  contactId?: string;
  status: PaymentRequestStatus;
  razorpayxStatus: string;
  utr?: string;
  fees?: number;
  tax?: number;
  failureReason?: string;
  rawResponse?: Record<string, any>;
}

export interface RazorpayXValidationResult {
  isValid: boolean;
  accountExists: boolean;
  registeredName?: string;
  bankName?: string;
  validationId?: string;
  failureReason?: string;
}

export class RazorpayXService {
  private keyId: string;
  private keySecret: string;
  private accountNumber: string;
  private webhookSecret: string;
  private isLiveEnabled: boolean;
  private isMockMode: boolean;

  // In-memory ledger for safe offline testing simulation
  private mockLedger = new Map<string, any>();

  constructor() {
    this.keyId = process.env.RAZORPAYX_KEY_ID || '';
    this.keySecret = process.env.RAZORPAYX_KEY_SECRET || '';
    this.accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER || '';
    this.webhookSecret = process.env.RAZORPAYX_WEBHOOK_SECRET || process.env.PAYMENTS_WEBHOOK_SECRET || 'sitetrack_rzpx_secret';
    this.isLiveEnabled = process.env.PAYMENTS_LIVE_ENABLED === 'true';

    // If no credentials or explicit test flag, run in safe deterministic RazorpayX test simulation
    this.isMockMode = !this.keyId || !this.keySecret || process.env.NODE_ENV === 'test' || this.keyId.includes('test_dummy');
  }

  private getAuthHeader(): string {
    const creds = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    return `Basic ${creds}`;
  }

  /**
   * 1. Create or retrieve Contact on RazorpayX
   */
  public async getOrCreateContact(beneficiary: IBeneficiary): Promise<string> {
    if (beneficiary.razorpayxContactId) {
      return beneficiary.razorpayxContactId;
    }

    if (this.isMockMode) {
      const mockContactId = `cont_rzpx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      beneficiary.razorpayxContactId = mockContactId;
      await beneficiary.save();
      return mockContactId;
    }

    try {
      const payload: RazorpayXContactPayload = {
        name: beneficiary.name,
        email: beneficiary.email || undefined,
        contact: beneficiary.phone || undefined,
        type: 'vendor',
        reference_id: beneficiary._id.toString(),
        notes: {
          sitetrackPayeeType: beneficiary.payeeType,
        },
      };

      const res = await fetch('https://api.razorpay.com/v1/contacts', {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.description || 'Failed to create RazorpayX Contact');
      }

      beneficiary.razorpayxContactId = data.id;
      await beneficiary.save();
      return data.id;
    } catch (err: any) {
      throw new Error(`RazorpayX Contact Provisioning Error: ${err.message}`);
    }
  }

  /**
   * 2. Create or retrieve Fund Account on RazorpayX
   */
  public async getOrCreateFundAccount(beneficiary: IBeneficiary): Promise<string> {
    if (beneficiary.razorpayxFundAccountId) {
      return beneficiary.razorpayxFundAccountId;
    }

    const contactId = await this.getOrCreateContact(beneficiary);

    if (this.isMockMode) {
      const mockFaId = `fa_rzpx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      beneficiary.razorpayxFundAccountId = mockFaId;
      await beneficiary.save();
      return mockFaId;
    }

    try {
      const payload: RazorpayXFundAccountPayload = {
        contact_id: contactId,
        account_type: 'bank_account',
        bank_account: {
          name: beneficiary.name,
          ifsc: beneficiary.ifsc,
          account_number: beneficiary.accountNumber,
        },
      };

      const res = await fetch('https://api.razorpay.com/v1/fund_accounts', {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data: any = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.description || 'Failed to create RazorpayX Fund Account');
      }

      beneficiary.razorpayxFundAccountId = data.id;
      await beneficiary.save();
      return data.id;
    } catch (err: any) {
      throw new Error(`RazorpayX Fund Account Error: ${err.message}`);
    }
  }

  /**
   * 3. Penny Drop Beneficiary Validation
   */
  public async validateBeneficiary(beneficiary: IBeneficiary): Promise<RazorpayXValidationResult> {
    const cleanAccount = beneficiary.accountNumber.replace(/\s+/g, '');
    const cleanIFSC = beneficiary.ifsc.trim().toUpperCase();

    // Check account format
    if (!/^\d{8,22}$/.test(cleanAccount)) {
      return {
        isValid: false,
        accountExists: false,
        failureReason: 'Account number must contain between 8 and 22 numeric digits.',
      };
    }

    // Check IFSC format
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIFSC)) {
      return {
        isValid: false,
        accountExists: false,
        failureReason: 'Invalid IFSC format.',
      };
    }

    if (this.isMockMode) {
      // Deterministic mock fixtures
      if (cleanAccount.startsWith('00000000') || cleanAccount.startsWith('99999999')) {
        return {
          isValid: false,
          accountExists: false,
          failureReason: 'Bank network reported: Account does not exist or is inactive (NPCI Error Code: B1)',
        };
      }

      await this.getOrCreateContact(beneficiary);
      await this.getOrCreateFundAccount(beneficiary);

      const validationId = `fav_rzpx_${Date.now()}`;
      return {
        isValid: true,
        accountExists: true,
        registeredName: beneficiary.name.toUpperCase(),
        bankName: beneficiary.bankName,
        validationId,
      };
    }

    // Live / Official Sandbox call
    try {
      const fundAccountId = await this.getOrCreateFundAccount(beneficiary);

      const res = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_number: this.accountNumber,
          fund_account: { id: fundAccountId },
          amount: 100, // ₹1 = 100 paise penny drop
          currency: 'INR',
          notes: { purpose: 'SiteTrack Contractor Verification' },
        }),
      });

      const data: any = await res.json();
      if (!res.ok) {
        return {
          isValid: false,
          accountExists: false,
          failureReason: data.error?.description || 'RazorpayX Penny Drop validation failed',
        };
      }

      const isCompleted = data.status === 'completed';
      const isAccountValid = isCompleted && data.results?.account_status === 'active';

      return {
        isValid: isAccountValid,
        accountExists: isAccountValid,
        registeredName: data.results?.registered_name || beneficiary.name,
        validationId: data.id,
        failureReason: isAccountValid ? undefined : (data.results?.account_status || 'Account verification incomplete'),
      };
    } catch (err: any) {
      return {
        isValid: false,
        accountExists: false,
        failureReason: err.message,
      };
    }
  }

  /**
   * 4. Create Payout via RazorpayX
   */
  public async createPayout(params: {
    paymentReference: string;
    idempotencyKey: string;
    amountPaise: number;
    mode: 'NEFT' | 'RTGS';
    purpose: string;
    narration?: string;
    beneficiary: IBeneficiary;
    projectId: string;
    expenseId?: string;
  }): Promise<RazorpayXPayoutResult> {
    const { paymentReference, idempotencyKey, amountPaise, mode, purpose, narration, beneficiary, projectId, expenseId } = params;

    // Enforce RBI RTGS minimum rule
    if (mode === 'RTGS' && amountPaise < 20000000) {
      return {
        success: false,
        payoutId: '',
        status: 'FAILED',
        razorpayxStatus: 'rejected',
        failureReason: 'RTGS requires a minimum transaction amount of ₹2,00,000 per RBI regulations.',
      };
    }

    // Safety Killswitch check for live keys
    if (!this.isMockMode && this.keyId.startsWith('rzp_live_') && !this.isLiveEnabled) {
      return {
        success: false,
        payoutId: '',
        status: 'FAILED',
        razorpayxStatus: 'live_disabled',
        failureReason: 'Live payouts blocked: PAYMENTS_LIVE_ENABLED is set to false. Live funds are safeguarded until onboarding verification is completed.',
      };
    }

    // Safe Mock Mode Simulation
    if (this.isMockMode) {
      // Deterministic timeout fixture
      if (purpose.includes('[SIMULATE_GATEWAY_TIMEOUT]')) {
        const timeoutPayoutId = `pout_rzpx_timeout_${Date.now()}`;
        this.mockLedger.set(paymentReference, {
          id: timeoutPayoutId,
          status: 'pending',
          reference_id: paymentReference,
        });
        return {
          success: false,
          payoutId: timeoutPayoutId,
          status: 'UNKNOWN',
          razorpayxStatus: 'pending',
          failureReason: 'Gateway timeout contacting RazorpayX payout service. Status reconciliation required.',
        };
      }

      // Deterministic failure fixture
      if (purpose.includes('[SIMULATE_IMMEDIATE_FAIL]')) {
        return {
          success: false,
          payoutId: `pout_rzpx_fail_${Date.now()}`,
          status: 'FAILED',
          razorpayxStatus: 'rejected',
          failureReason: 'RazorpayX clearing rejected: Account inactive or blocked by recipient bank.',
        };
      }

      const mockPayoutId = `pout_rzpx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const mockUtr = `RZPX${mode}${Date.now().toString().slice(-8)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      this.mockLedger.set(paymentReference, {
        id: mockPayoutId,
        status: 'processed',
        utr: mockUtr,
        reference_id: paymentReference,
        amount: amountPaise,
        mode,
        fees: 400, // ₹4
        tax: 72,   // 18% GST on fee
      });

      return {
        success: true,
        payoutId: mockPayoutId,
        contactId: beneficiary.razorpayxContactId,
        fundAccountId: beneficiary.razorpayxFundAccountId,
        status: 'PAID',
        razorpayxStatus: 'processed',
        utr: mockUtr,
        fees: 400,
        tax: 72,
        rawResponse: {
          entity: 'payout',
          id: mockPayoutId,
          status: 'processed',
          utr: mockUtr,
          mode,
          amount: amountPaise,
        },
      };
    }

    // Official RazorpayX API Execution
    try {
      const fundAccountId = await this.getOrCreateFundAccount(beneficiary);

      const payload: RazorpayXPayoutPayload = {
        account_number: this.accountNumber,
        fund_account_id: fundAccountId,
        amount: amountPaise,
        currency: 'INR',
        mode,
        purpose: 'vendor_payment',
        queue_if_low_balance: false,
        reference_id: paymentReference,
        narration: (narration || purpose).slice(0, 30),
        notes: {
          projectId,
          expenseId: expenseId || '',
          system: 'SiteTrack',
        },
      };

      const res = await fetch('https://api.razorpay.com/v1/payouts', {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
          'X-Payout-Idempotency': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      const data: any = await res.json();
      if (!res.ok) {
        return {
          success: false,
          payoutId: data.id || '',
          status: 'FAILED',
          razorpayxStatus: data.status || 'failed',
          failureReason: data.error?.description || 'Payout creation rejected by RazorpayX.',
          rawResponse: data,
        };
      }

      // Map RazorpayX Statuses:
      // queued, pending, processing, processed, reversed, rejected, cancelled, failed
      const mappedStatus = this.mapRazorpayXStatus(data.status);

      return {
        success: mappedStatus !== 'FAILED',
        payoutId: data.id,
        contactId: data.contact_id,
        fundAccountId: data.fund_account_id,
        status: mappedStatus,
        razorpayxStatus: data.status,
        utr: data.utr,
        fees: data.fees,
        tax: data.tax,
        failureReason: data.failure_reason,
        rawResponse: data,
      };
    } catch (err: any) {
      // In network error or timeout, return UNKNOWN (never retry blindly!)
      return {
        success: false,
        payoutId: '',
        status: 'UNKNOWN',
        razorpayxStatus: 'timeout',
        failureReason: `Network error reaching RazorpayX API: ${err.message}. Status reconciliation required.`,
      };
    }
  }

  /**
   * 5. Status Inquiry & Reconciliation
   */
  public async getPayout(payoutId: string, paymentReference?: string): Promise<RazorpayXPayoutResult> {
    if (this.isMockMode) {
      let record = paymentReference ? this.mockLedger.get(paymentReference) : null;
      if (!record && payoutId) {
        for (const val of this.mockLedger.values()) {
          if (val.id === payoutId) {
            record = val;
            break;
          }
        }
      }

      const utr = record?.utr || `RZPXRECON${Date.now().toString().slice(-8)}`;
      return {
        success: true,
        payoutId: payoutId || record?.id || 'pout_reconciled',
        status: 'PAID',
        razorpayxStatus: 'processed',
        utr,
        fees: 400,
        tax: 72,
        rawResponse: {
          id: payoutId,
          status: 'processed',
          utr,
        },
      };
    }

    try {
      const res = await fetch(`https://api.razorpay.com/v1/payouts/${payoutId}`, {
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });

      const data: any = await res.json();
      if (!res.ok) {
        return {
          success: false,
          payoutId,
          status: 'UNKNOWN',
          razorpayxStatus: 'error',
          failureReason: data.error?.description || 'Failed to fetch payout status from RazorpayX',
        };
      }

      const mappedStatus = this.mapRazorpayXStatus(data.status);
      return {
        success: mappedStatus !== 'FAILED',
        payoutId: data.id,
        status: mappedStatus,
        razorpayxStatus: data.status,
        utr: data.utr,
        fees: data.fees,
        tax: data.tax,
        failureReason: data.failure_reason,
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        success: false,
        payoutId,
        status: 'UNKNOWN',
        razorpayxStatus: 'timeout',
        failureReason: err.message,
      };
    }
  }

  /**
   * 6. Webhook Signature Verification using exact raw body
   */
  public verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature || !this.webhookSecret) return false;
    try {
      const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(bodyBuffer)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedSignature, 'utf8'));
    } catch {
      return false;
    }
  }

  /**
   * Helper to generate a valid signature for testing
   */
  public generateWebhookSignature(rawBody: string | Buffer): string {
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(bodyBuffer)
      .digest('hex');
  }

  /**
   * Map RazorpayX Statuses to SiteTrack internal lifecycle
   */
  public mapRazorpayXStatus(rzpStatus: string): PaymentRequestStatus {
    const status = (rzpStatus || '').toLowerCase();
    switch (status) {
      case 'processed':
      case 'paid':
        return 'PAID';
      case 'processing':
      case 'initiated':
      case 'pending':
      case 'queued':
        return 'PROCESSING';
      case 'reversed':
        return 'REVERSED';
      case 'rejected':
      case 'cancelled':
      case 'failed':
        return 'FAILED';
      default:
        return 'UNKNOWN';
    }
  }
}

// Export singleton instance
export const razorpayXService = new RazorpayXService();
