import crypto from 'crypto';
import { IBeneficiary } from '../../models/Beneficiary.js';
import { PaymentMethod, PaymentRequestStatus } from '../../models/PaymentRequest.js';

export interface RazorpayXContactPayload {
  name: string;
  email?: string;
  contact?: string;
  type: 'vendor' | 'customer' | 'employee' | 'self';
  reference_id: string;
  notes?: Record<string, any>;
}

export interface RazorpayXFundAccountPayload {
  contact_id: string;
  account_type: 'bank_account' | 'vpa';
  bank_account?: {
    name: string;
    ifsc: string;
    account_number: string;
  };
  vpa?: {
    address: string;
  };
}

export interface RazorpayXPayoutPayload {
  account_number: string; // Business Source Account Number
  fund_account_id: string;
  amount: number; // In Paise
  currency: 'INR';
  mode: 'NEFT' | 'RTGS' | 'UPI';
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

export interface ParsedUpiData {
  isValid: boolean;
  vpa?: string;
  payeeName?: string;
  amountRupees?: number;
  currency?: string;
  transactionNote?: string;
  referenceUrl?: string;
  rawUri: string;
  errorMessage?: string;
}

export interface DynamicPaymentQrResult {
  qrId: string;
  qrPayload: string;
  amountPaise: number;
  referenceId: string;
  expiresAt: Date;
  status: 'PENDING' | 'PAID' | 'EXPIRED';
}

export class RazorpayXService {
  private keyId: string;
  private keySecret: string;
  private accountNumber: string;
  private webhookSecret: string;
  public readonly isLiveEnabled: boolean;
  public readonly isMockMode: boolean;

  // In-memory ledger for safe deterministic testing simulation
  private mockLedger = new Map<string, any>();
  private mockQrLedger = new Map<string, DynamicPaymentQrResult>();

  constructor() {
    this.keyId = process.env.RAZORPAYX_KEY_ID || '';
    this.keySecret = process.env.RAZORPAYX_KEY_SECRET || '';
    this.accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER || '';
    this.webhookSecret =
      process.env.RAZORPAYX_WEBHOOK_SECRET ||
      process.env.PAYMENTS_WEBHOOK_SECRET ||
      'sitetrack_rzpx_secret_key_2026';
    this.isLiveEnabled = process.env.PAYMENTS_LIVE_ENABLED === 'true';

    // If live credentials are not set or explicit mock mode is set, use safe simulation
    this.isMockMode =
      !this.keyId ||
      !this.keySecret ||
      process.env.NODE_ENV === 'test' ||
      this.keyId.includes('test_dummy') ||
      !this.isLiveEnabled;
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
   * 2. Create or retrieve Fund Account on RazorpayX (Supports Bank Account and UPI VPA)
   */
  public async getOrCreateFundAccount(
    beneficiary: IBeneficiary,
    method: 'NEFT' | 'RTGS' | 'UPI'
  ): Promise<string> {
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
      let payload: RazorpayXFundAccountPayload;

      if (method === 'UPI' && beneficiary.vpa) {
        payload = {
          contact_id: contactId,
          account_type: 'vpa',
          vpa: {
            address: beneficiary.vpa,
          },
        };
      } else {
        if (!beneficiary.accountNumber || !beneficiary.ifsc) {
          throw new Error('Bank account number and IFSC are required for NEFT/RTGS fund account creation.');
        }
        payload = {
          contact_id: contactId,
          account_type: 'bank_account',
          bank_account: {
            name: beneficiary.name,
            ifsc: beneficiary.ifsc,
            account_number: beneficiary.accountNumber,
          },
        };
      }

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
   * 3. Penny Drop Beneficiary Bank Account Validation
   */
  public async validateBeneficiary(beneficiary: IBeneficiary): Promise<RazorpayXValidationResult> {
    if (beneficiary.vpa && !beneficiary.accountNumber) {
      // UPI VPA Validation
      const isValidVpa = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(beneficiary.vpa);
      if (!isValidVpa) {
        return {
          isValid: false,
          accountExists: false,
          failureReason: 'Invalid UPI ID format (e.g., vendor@okhdfcbank)',
        };
      }

      await this.getOrCreateContact(beneficiary);
      await this.getOrCreateFundAccount(beneficiary, 'UPI');

      return {
        isValid: true,
        accountExists: true,
        registeredName: beneficiary.name.toUpperCase(),
        validationId: `vpa_val_${Date.now()}`,
      };
    }

    const cleanAccount = (beneficiary.accountNumber || '').replace(/\s+/g, '');
    const cleanIFSC = (beneficiary.ifsc || '').trim().toUpperCase();

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
      if (cleanAccount.startsWith('00000000') || cleanAccount.startsWith('99999999')) {
        return {
          isValid: false,
          accountExists: false,
          failureReason: 'Bank network reported: Account does not exist or is inactive (NPCI Error Code: B1)',
        };
      }

      await this.getOrCreateContact(beneficiary);
      await this.getOrCreateFundAccount(beneficiary, 'NEFT');

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
      const fundAccountId = await this.getOrCreateFundAccount(beneficiary, 'NEFT');

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
   * 4. Create Payout via RazorpayX (Supports NEFT, RTGS, and UPI)
   */
  public async createPayout(params: {
    paymentReference: string;
    idempotencyKey: string;
    amountPaise: number;
    mode: 'NEFT' | 'RTGS' | 'UPI';
    purpose: string;
    narration?: string;
    beneficiary: IBeneficiary;
    projectId?: string;
  }): Promise<RazorpayXPayoutResult> {
    const { paymentReference, idempotencyKey, amountPaise, mode, purpose, beneficiary } = params;

    // Validate RBI rules for RTGS (Minimum ₹2,00,000 = 20,000,000 paise)
    if (mode === 'RTGS' && amountPaise < 20000000) {
      return {
        success: false,
        payoutId: '',
        status: 'FAILED',
        razorpayxStatus: 'rejected',
        failureReason: 'RBI Regulation: RTGS requires a minimum transaction amount of ₹2,00,000. Please select NEFT or UPI.',
      };
    }

    // Validate NPCI rules for UPI (Maximum ₹1,00,000 = 10,000,000 paise)
    if (mode === 'UPI' && amountPaise > 10000000) {
      return {
        success: false,
        payoutId: '',
        status: 'FAILED',
        razorpayxStatus: 'rejected',
        failureReason: 'UPI Limit: Standard UPI transfers are restricted to ₹1,00,000 maximum per NPCI guidelines. Please select NEFT or RTGS for higher amounts.',
      };
    }

    // Safe simulation mode
    if (this.isMockMode) {
      const payoutId = `pout_rzpx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const utr = `RZPX${mode}${Date.now().toString().slice(-8)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      const mockRecord = {
        payoutId,
        paymentReference,
        idempotencyKey,
        amountPaise,
        mode,
        status: 'PAID' as PaymentRequestStatus,
        razorpayxStatus: 'processed',
        utr,
        fees: mode === 'RTGS' ? 1500 : mode === 'UPI' ? 0 : 300,
        tax: mode === 'RTGS' ? 270 : 54,
        beneficiaryName: beneficiary.name,
      };

      this.mockLedger.set(payoutId, mockRecord);
      this.mockLedger.set(paymentReference, mockRecord);

      return {
        success: true,
        payoutId,
        status: 'PAID',
        razorpayxStatus: 'processed',
        utr,
        fees: mockRecord.fees,
        tax: mockRecord.tax,
        rawResponse: mockRecord,
      };
    }

    // Official RazorpayX API call
    try {
      const fundAccountId = await this.getOrCreateFundAccount(beneficiary, mode);

      const payload: RazorpayXPayoutPayload = {
        account_number: this.accountNumber,
        fund_account_id: fundAccountId,
        amount: amountPaise,
        currency: 'INR',
        mode: mode,
        purpose: 'vendor_payment',
        queue_if_low_balance: true,
        reference_id: paymentReference,
        narration: (params.narration || purpose).slice(0, 30),
        notes: {
          sitetrackRef: paymentReference,
          projectId: params.projectId,
          beneficiaryType: beneficiary.payeeType,
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
          payoutId: '',
          status: 'FAILED',
          razorpayxStatus: 'failed',
          failureReason: data.error?.description || 'RazorpayX transfer execution rejected',
          rawResponse: data,
        };
      }

      const mappedStatus = this.mapRazorpayXStatus(data.status);
      return {
        success: true,
        payoutId: data.id,
        fundAccountId: data.fund_account_id,
        status: mappedStatus,
        razorpayxStatus: data.status,
        utr: data.utr || undefined,
        fees: data.fees || 0,
        tax: data.tax || 0,
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        success: false,
        payoutId: '',
        status: 'UNKNOWN',
        razorpayxStatus: 'error',
        failureReason: `Network Timeout or Gateway Error: ${err.message}. Status must be reconciled before retry.`,
      };
    }
  }

  /**
   * 5. Status Inquiry & Reconciliation
   */
  public async getPayout(payoutId: string, paymentReference?: string): Promise<RazorpayXPayoutResult> {
    if (this.isMockMode) {
      const record =
        this.mockLedger.get(payoutId) ||
        (paymentReference ? this.mockLedger.get(paymentReference) : null);

      const utr = record?.utr || `RZPXNEFT${Date.now().toString().slice(-8)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      return {
        success: true,
        payoutId,
        status: 'PAID',
        razorpayxStatus: 'processed',
        utr,
        fees: record?.fees || 300,
        tax: record?.tax || 54,
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
        utr: data.utr || undefined,
        fees: data.fees || 0,
        tax: data.tax || 0,
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        success: false,
        payoutId,
        status: 'UNKNOWN',
        razorpayxStatus: 'error',
        failureReason: `Reconciliation query error: ${err.message}`,
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

  public generateWebhookSignature(rawBody: string | Buffer): string {
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(bodyBuffer)
      .digest('hex');
  }

  /**
   * 7. Feature 3.1: Untrusted UPI QR Parser
   * Parses standard UPI URI format: upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...
   */
  public parseUpiQrString(rawInput: string): ParsedUpiData {
    if (!rawInput || typeof rawInput !== 'string') {
      return { isValid: false, rawUri: '', errorMessage: 'Empty or invalid QR code string' };
    }

    const trimmed = rawInput.trim();
    if (!trimmed.toLowerCase().startsWith('upi://pay')) {
      return {
        isValid: false,
        rawUri: trimmed,
        errorMessage: 'The scanned QR code is not a valid standard UPI payment QR (must start with upi://pay).',
      };
    }

    try {
      const url = new URL(trimmed);
      const params = url.searchParams;

      const pa = params.get('pa')?.trim() || ''; // Payee VPA / UPI ID
      const pn = params.get('pn')?.trim() || ''; // Payee Name
      const am = params.get('am')?.trim() || ''; // Amount
      const cu = params.get('cu')?.trim() || 'INR'; // Currency
      const tn = params.get('tn')?.trim() || ''; // Note
      const urlRef = params.get('url')?.trim() || '';

      // Validate VPA format: e.g. someone@bank or 9876543210@upi
      const vpaRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
      if (!pa || !vpaRegex.test(pa)) {
        return {
          isValid: false,
          rawUri: trimmed,
          errorMessage: `Invalid or missing UPI VPA in QR code: "${pa}". Expected format: username@bank`,
        };
      }

      let parsedAmount: number | undefined;
      if (am) {
        const num = parseFloat(am);
        if (!isNaN(num) && num > 0) {
          parsedAmount = num;
        }
      }

      return {
        isValid: true,
        vpa: pa.toLowerCase(),
        payeeName: decodeURIComponent(pn) || undefined,
        amountRupees: parsedAmount,
        currency: cu.toUpperCase(),
        transactionNote: decodeURIComponent(tn) || undefined,
        referenceUrl: urlRef || undefined,
        rawUri: trimmed,
      };
    } catch (err: any) {
      return {
        isValid: false,
        rawUri: trimmed,
        errorMessage: `Failed to parse UPI QR content: ${err.message}`,
      };
    }
  }

  /**
   * 8. Feature 3.2: Create Dynamic Payment-Collection QR
   */
  public async createPaymentQr(params: {
    amountPaise: number;
    referenceId: string;
    purpose: string;
    expiryMinutes?: number;
  }): Promise<DynamicPaymentQrResult> {
    const { amountPaise, referenceId, purpose, expiryMinutes = 15 } = params;
    const qrId = `qr_rzpx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
    const amountINR = (amountPaise / 100).toFixed(2);

    // Standard NPCI / UPI merchant URI payload
    const merchantVpa = process.env.MERCHANT_UPI_VPA || 'sitetrack.corporate@icici';
    const merchantName = encodeURIComponent(process.env.MERCHANT_BUSINESS_NAME || 'SiteTrack Infra Pvt Ltd');
    const note = encodeURIComponent(`SiteTrack Ref ${referenceId} - ${purpose.slice(0, 20)}`);
    const qrPayload = `upi://pay?pa=${merchantVpa}&pn=${merchantName}&am=${amountINR}&cu=INR&tn=${note}&tr=${referenceId}`;

    const qrRecord: DynamicPaymentQrResult = {
      qrId,
      qrPayload,
      amountPaise,
      referenceId,
      expiresAt,
      status: 'PENDING',
    };

    this.mockQrLedger.set(qrId, qrRecord);
    this.mockQrLedger.set(referenceId, qrRecord);

    return qrRecord;
  }

  public async getPaymentQrStatus(qrId: string): Promise<DynamicPaymentQrResult | null> {
    const record = this.mockQrLedger.get(qrId);
    if (!record) return null;

    if (record.status === 'PENDING' && new Date() > record.expiresAt) {
      record.status = 'EXPIRED';
    }

    return record;
  }

  /**
   * 9. Map RazorpayX Statuses to SiteTrack internal lifecycle
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
        return 'REJECTED';
      case 'cancelled':
      case 'failed':
        return 'FAILED';
      default:
        return 'UNKNOWN';
    }
  }
}

export const razorpayXService = new RazorpayXService();
