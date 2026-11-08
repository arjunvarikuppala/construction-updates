/**
 * RazorpayX Payouts client (https://razorpay.com/docs/api/x/).
 *
 * Money moves from BKR INFRA's RazorpayX account to a vendor's bank account /
 * UPI ID or a Site In-Charge's UPI ID. Nothing is ever simulated: without keys
 * payouts are simply "not set up". Test keys (rzp_test_…) talk to Razorpay's
 * test mode; live keys (rzp_live_…) additionally need PAYMENTS_LIVE_ENABLED=true.
 *
 * Env:
 *   RAZORPAYX_KEY_ID / RAZORPAYX_KEY_SECRET   API keys (Dashboard → Settings → API Keys)
 *   RAZORPAYX_ACCOUNT_NUMBER                  your RazorpayX account number (Dashboard → My Account)
 *   RAZORPAYX_WEBHOOK_SECRET                  secret set on the webhook (Dashboard → Settings → Webhooks)
 *   PAYMENTS_LIVE_ENABLED=true                required to use live keys
 *   RAZORPAYX_API_BASE                        override for tests only
 */
import crypto from 'crypto';

export type PayoutMode = 'UPI' | 'IMPS' | 'NEFT' | 'RTGS';
export const PAYOUT_MODES: PayoutMode[] = ['UPI', 'IMPS', 'NEFT', 'RTGS'];

/** Per-payout limits (paise) enforced by banks / NPCI */
export const PAYOUT_LIMITS: Record<PayoutMode, { min: number; max: number }> = {
  UPI: { min: 100, max: 10000000 }, // up to ₹1,00,000
  IMPS: { min: 100, max: 50000000 }, // up to ₹5,00,000
  NEFT: { min: 100, max: 1000000000 }, // no practical cap (₹1 crore here)
  RTGS: { min: 20000000, max: 1000000000 }, // from ₹2,00,000
};

/** Our simplified view of a payout's state */
export type PayoutState = 'processed' | 'pending' | 'failed' | 'reversed';

export interface PayoutEntity {
  id: string;
  status: string;
  amount: number;
  mode?: string;
  utr?: string | null;
  fees?: number;
  tax?: number;
  reference_id?: string;
  failure_reason?: string | null;
  status_details?: { description?: string; reason?: string; source?: string } | null;
  notes?: Record<string, any>;
  fund_account_id?: string;
}

export interface ProviderStatus {
  enabled: boolean;
  mode: 'off' | 'test' | 'live';
  webhookConfigured: boolean;
  accountConfigured: boolean;
  /** Why payouts are off (for the setup card) */
  reason?: string;
}

export class RazorpayXError extends Error {
  constructor(
    message: string,
    /** HTTP status from Razorpay; 0 = network error / timeout (outcome unknown) */
    public httpStatus: number,
    public code?: string
  ) {
    super(message);
  }
  /** True when Razorpay definitely did not create anything (a 4xx validation error) */
  get isDefinite(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500;
  }
}

/** Razorpay allows only letters, digits and spaces in narration (max 30) */
export function cleanNarration(text: string): string {
  return text.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30) || 'BKR INFRA payment';
}

/** Names on contacts / bank accounts: letters, digits, spaces and . ' - & only */
function cleanName(text: string, max = 50): string {
  const s = text.replace(/[^A-Za-z0-9 .'&-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s.length >= 3 ? s : `${s} BKR`.trim();
}

export function mapPayoutState(status: string): PayoutState {
  switch ((status || '').toLowerCase()) {
    case 'processed':
      return 'processed';
    case 'reversed':
      return 'reversed';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'failed';
    default:
      // queued (low balance), pending (approval), scheduled, processing
      return 'pending';
  }
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
  private qrLedger = new Map<string, DynamicPaymentQrResult>();

  // Read lazily so the environment can be configured before first use
  private get keyId() {
    return (process.env.RAZORPAYX_KEY_ID || '').trim();
  }
  private get keySecret() {
    return (process.env.RAZORPAYX_KEY_SECRET || '').trim();
  }
  get accountNumber() {
    return (process.env.RAZORPAYX_ACCOUNT_NUMBER || '').replace(/\s+/g, '');
  }
  private get webhookSecret() {
    return (process.env.RAZORPAYX_WEBHOOK_SECRET || process.env.PAYMENTS_WEBHOOK_SECRET || '').trim();
  }
  private get apiBase() {
    return (process.env.RAZORPAYX_API_BASE || 'https://api.razorpay.com').replace(/\/$/, '');
  }

  status(): ProviderStatus {
    const webhookConfigured = Boolean(this.webhookSecret);
    const accountConfigured = Boolean(this.accountNumber);
    if (!this.keyId || !this.keySecret) {
      return { enabled: false, mode: 'off', webhookConfigured, accountConfigured, reason: 'RazorpayX API keys are not added on the server yet.' };
    }
    const mode = this.keyId.startsWith('rzp_live_') ? 'live' : 'test';
    if (!accountConfigured) {
      return { enabled: false, mode: 'off', webhookConfigured, accountConfigured, reason: 'RAZORPAYX_ACCOUNT_NUMBER is missing on the server.' };
    }
    const liveAllowed = process.env.PAYMENTS_LIVE_ENABLED === 'true' || process.env.RAZORPAYX_LIVE_TRANSFERS_ENABLED === 'true';
    if (mode === 'live' && !liveAllowed) {
      return {
        enabled: false,
        mode: 'off',
        webhookConfigured,
        accountConfigured,
        reason: 'Live keys are added but PAYMENTS_LIVE_ENABLED is not "true" — real money is blocked until you turn it on.',
      };
    }
    return { enabled: true, mode, webhookConfigured, accountConfigured };
  }

  get isEnabled(): boolean {
    return this.status().enabled;
  }

  private async call<T = any>(method: 'GET' | 'POST', path: string, body?: any, extraHeaders: Record<string, string> = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let res: Response;
    try {
      res = await fetch(`${this.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      throw new RazorpayXError(
        err?.name === 'AbortError' ? 'RazorpayX did not answer in time.' : `Could not reach RazorpayX: ${err?.message || 'network error'}`,
        0
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      const desc = data?.error?.description || `RazorpayX error (${res.status})`;
      throw new RazorpayXError(res.status === 401 ? 'RazorpayX rejected the API keys — check them on the server.' : desc, res.status, data?.error?.code);
    }
    return data as T;
  }

  /** Create (or get the existing) RazorpayX contact. Razorpay de-duplicates identical contacts. */
  async createContact(p: { name: string; type: 'vendor' | 'employee'; referenceId: string; phone?: string; email?: string }) {
    const phone = (p.phone || '').replace(/\D/g, '');
    const email = (p.email || '').trim();
    const contact = await this.call<{ id: string }>('POST', '/v1/contacts', {
      name: cleanName(p.name),
      type: p.type,
      reference_id: p.referenceId.slice(0, 40),
      ...(phone.length >= 8 && phone.length <= 15 ? { contact: phone } : {}),
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : {}),
      notes: { app: 'BKR INFRA' },
    });
    return contact.id;
  }

  async createVpaFundAccount(contactId: string, vpa: string) {
    const fa = await this.call<{ id: string }>('POST', '/v1/fund_accounts', {
      contact_id: contactId,
      account_type: 'vpa',
      vpa: { address: vpa.trim().toLowerCase() },
    });
    return fa.id;
  }

  async createBankFundAccount(contactId: string, b: { name: string; ifsc: string; accountNumber: string }) {
    const fa = await this.call<{ id: string }>('POST', '/v1/fund_accounts', {
      contact_id: contactId,
      account_type: 'bank_account',
      bank_account: { name: cleanName(b.name, 120), ifsc: b.ifsc.trim().toUpperCase(), account_number: b.accountNumber.replace(/\s+/g, '') },
    });
    return fa.id;
  }

  /**
   * Send money. The idempotency key MUST stay the same when retrying the same
   * payout: Razorpay then returns the original payout instead of paying twice.
   */
  async createPayout(p: {
    fundAccountId: string;
    amountPaise: number;
    mode: PayoutMode;
    purpose: 'vendor bill' | 'payout';
    referenceId: string;
    narration: string;
    idempotencyKey: string;
    notes: Record<string, string>;
  }): Promise<PayoutEntity> {
    return this.call<PayoutEntity>(
      'POST',
      '/v1/payouts',
      {
        account_number: this.accountNumber,
        fund_account_id: p.fundAccountId,
        amount: p.amountPaise,
        currency: 'INR',
        mode: p.mode,
        purpose: p.purpose,
        queue_if_low_balance: true,
        reference_id: p.referenceId.slice(0, 40),
        narration: cleanNarration(p.narration),
        notes: p.notes,
      },
      { 'X-Payout-Idempotency': p.idempotencyKey }
    );
  }

  async getPayout(payoutId: string): Promise<PayoutEntity> {
    return this.call<PayoutEntity>('GET', `/v1/payouts/${encodeURIComponent(payoutId)}`);
  }

  /** ₹1 penny-drop bank account check. Waits briefly for the result. */
  async validateBankAccount(fundAccountId: string): Promise<{ id: string; status: string; accountStatus?: string; registeredName?: string }> {
    let v = await this.call<any>('POST', '/v1/fund_accounts/validations', {
      account_number: this.accountNumber,
      fund_account: { id: fundAccountId },
      amount: 100,
      currency: 'INR',
      notes: { app: 'BKR INFRA' },
    });
    for (let i = 0; i < 4 && v.status !== 'completed' && v.status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, process.env.NODE_ENV === 'test' ? 10 : 1500));
      v = await this.call<any>('GET', `/v1/fund_accounts/validations/${encodeURIComponent(v.id)}`);
    }
    return { id: v.id, status: v.status, accountStatus: v.results?.account_status, registeredName: v.results?.registered_name };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature || !this.webhookSecret) return false;
    try {
      const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
      const a = Buffer.from(signature, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  generateWebhookSignature(rawBody: string | Buffer): string {
    return crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
  }

  /** Parses a scanned upi://pay?... QR. Treated as untrusted input. */
  parseUpiQrString(rawInput: string): ParsedUpiData {
    if (!rawInput || typeof rawInput !== 'string') {
      return { isValid: false, rawUri: '', errorMessage: 'Empty or invalid QR code string' };
    }
    const trimmed = rawInput.trim();
    if (!trimmed.toLowerCase().startsWith('upi://pay')) {
      return { isValid: false, rawUri: trimmed, errorMessage: 'This is not a UPI payment QR code.' };
    }
    try {
      const params = new URL(trimmed).searchParams;
      const pa = params.get('pa')?.trim() || '';
      const pn = params.get('pn')?.trim() || '';
      const am = params.get('am')?.trim() || '';
      const cu = params.get('cu')?.trim() || 'INR';
      const tn = params.get('tn')?.trim() || '';
      const urlRef = params.get('url')?.trim() || '';
      if (!pa || !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/.test(pa)) {
        return { isValid: false, rawUri: trimmed, errorMessage: `The QR code has no valid UPI ID ("${pa.slice(0, 60)}").` };
      }
      const num = parseFloat(am);
      return {
        isValid: true,
        vpa: pa.toLowerCase(),
        payeeName: pn.slice(0, 100) || undefined,
        amountRupees: !isNaN(num) && num > 0 ? num : undefined,
        currency: cu.toUpperCase(),
        transactionNote: tn.slice(0, 200) || undefined,
        referenceUrl: urlRef || undefined,
        rawUri: trimmed,
      };
    } catch (err: any) {
      return { isValid: false, rawUri: trimmed, errorMessage: `Could not read the UPI QR: ${err.message}` };
    }
  }

  /**
   * Static UPI collection QR for the company's own UPI ID (MERCHANT_UPI_VPA).
   * Refuses to make one without a real company UPI ID configured.
   */
  async createPaymentQr(params: { amountPaise: number; referenceId: string; purpose: string; expiryMinutes?: number }): Promise<DynamicPaymentQrResult> {
    const merchantVpa = (process.env.MERCHANT_UPI_VPA || '').trim();
    if (!merchantVpa) throw new Error('Set MERCHANT_UPI_VPA (the company UPI ID) on the server to create collection QR codes.');
    const { amountPaise, referenceId, purpose, expiryMinutes = 15 } = params;
    const qrId = `qr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const merchantName = encodeURIComponent(process.env.MERCHANT_BUSINESS_NAME || 'BKR INFRA');
    const note = encodeURIComponent(cleanNarration(`${referenceId} ${purpose}`));
    const record: DynamicPaymentQrResult = {
      qrId,
      qrPayload: `upi://pay?pa=${merchantVpa}&pn=${merchantName}&am=${(amountPaise / 100).toFixed(2)}&cu=INR&tn=${note}&tr=${encodeURIComponent(referenceId)}`,
      amountPaise,
      referenceId,
      expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
      status: 'PENDING',
    };
    this.qrLedger.set(qrId, record);
    return record;
  }

  async getPaymentQrStatus(qrId: string): Promise<DynamicPaymentQrResult | null> {
    const record = this.qrLedger.get(qrId);
    if (!record) return null;
    if (record.status === 'PENDING' && new Date() > record.expiresAt) record.status = 'EXPIRED';
    return record;
  }
}

export const razorpayXService = new RazorpayXService();
