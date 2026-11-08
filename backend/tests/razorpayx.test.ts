/**
 * RazorpayX payouts end to end, against a fake RazorpayX API that enforces the
 * real API's rules (auth, idempotency header, purposes, narration, fund
 * account types). No real money and no network access.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import {
  startTestServer,
  stopTestServer,
  api,
  registerMD,
  createProject,
  assignNewInCharge,
  webhookSignature,
} from './helpers.js';

// ---------- fake RazorpayX ----------
type Payout = { id: string; status: string; amount: number; mode: string; utr: string | null; reference_id: string; notes: any; fund_account_id: string; purpose: string; narration: string; fees: number; tax: number };
const fake = {
  contacts: new Map<string, any>(),
  fundAccounts: new Map<string, any>(),
  payouts: new Map<string, Payout>(),
  byIdem: new Map<string, string>(),
  validations: new Map<string, any>(),
  /** status a new payout gets */
  nextStatus: 'processing',
  /** reject the next payout with this 400 description */
  rejectNext: '' as string,
  /** create the next payout but answer 500 (outcome unknown) */
  crashNext: false,
  posts: 0,
  violations: [] as string[],
};
const KEY_ID = 'rzp_test_bkr123';
const KEY_SECRET = 'secret_bkr123';
const ACCOUNT = '2323230041626905';
let fakeServer: http.Server;

function send(res: http.ServerResponse, status: number, body: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
const rid = (p: string) => `${p}_${crypto.randomBytes(7).toString('hex')}`;

function startFake(): Promise<string> {
  fakeServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const auth = String(req.headers.authorization || '');
      if (auth !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`) {
        return send(res, 401, { error: { code: 'BAD_REQUEST_ERROR', description: 'The api key provided is invalid' } });
      }
      const body = raw ? JSON.parse(raw) : {};
      const url = req.url || '';
      if (req.method === 'POST' && url === '/v1/contacts') {
        if (!['vendor', 'employee', 'customer', 'self'].includes(body.type)) fake.violations.push(`contact type ${body.type}`);
        if (!/^[A-Za-z0-9 .'&-]{3,50}$/.test(body.name)) fake.violations.push(`contact name "${body.name}"`);
        const existing = [...fake.contacts.values()].find((c) => c.reference_id === body.reference_id && c.name === body.name);
        if (existing) return send(res, 200, existing);
        const c = { id: rid('cont'), ...body };
        fake.contacts.set(c.id, c);
        return send(res, 201, c);
      }
      if (req.method === 'POST' && url === '/v1/fund_accounts') {
        if (!fake.contacts.has(body.contact_id)) return send(res, 400, { error: { description: 'contact not found' } });
        const fa = { id: rid('fa'), ...body };
        fake.fundAccounts.set(fa.id, fa);
        return send(res, 201, fa);
      }
      if (req.method === 'POST' && url === '/v1/payouts') {
        fake.posts++;
        const idem = String(req.headers['x-payout-idempotency'] || '');
        if (!idem) return send(res, 400, { error: { description: 'X-Payout-Idempotency header is required' } });
        if (fake.byIdem.has(idem)) return send(res, 200, fake.payouts.get(fake.byIdem.get(idem)!));
        if (body.account_number !== ACCOUNT) fake.violations.push('account_number');
        if (!['refund', 'cashback', 'payout', 'salary', 'utility bill', 'vendor bill'].includes(body.purpose)) fake.violations.push(`purpose ${body.purpose}`);
        if (!/^[A-Za-z0-9 ]{1,30}$/.test(body.narration || '')) fake.violations.push(`narration "${body.narration}"`);
        if (String(body.reference_id || '').length > 40) fake.violations.push('reference_id length');
        const fa = fake.fundAccounts.get(body.fund_account_id);
        if (!fa) return send(res, 400, { error: { description: 'fund account not found' } });
        if ((fa.account_type === 'vpa') !== (body.mode === 'UPI')) {
          return send(res, 400, { error: { description: `Mode ${body.mode} is not allowed for ${fa.account_type}` } });
        }
        if (fake.rejectNext) {
          const d = fake.rejectNext;
          fake.rejectNext = '';
          return send(res, 400, { error: { code: 'BAD_REQUEST_ERROR', description: d } });
        }
        const p: Payout = {
          id: rid('pout'),
          status: fake.nextStatus,
          amount: body.amount,
          mode: body.mode,
          utr: fake.nextStatus === 'processed' ? String(Math.floor(1e11 + Math.random() * 8e11)) : null,
          reference_id: body.reference_id,
          notes: body.notes,
          fund_account_id: body.fund_account_id,
          purpose: body.purpose,
          narration: body.narration,
          fees: 590,
          tax: 90,
        };
        fake.payouts.set(p.id, p);
        fake.byIdem.set(idem, p.id);
        if (fake.crashNext) {
          fake.crashNext = false;
          return send(res, 502, { error: { description: 'Gateway timeout' } });
        }
        return send(res, 200, p);
      }
      const getPayout = url.match(/^\/v1\/payouts\/([^/?]+)$/);
      if (req.method === 'GET' && getPayout) {
        const p = fake.payouts.get(decodeURIComponent(getPayout[1]));
        return p ? send(res, 200, p) : send(res, 404, { error: { description: 'not found' } });
      }
      if (req.method === 'POST' && url === '/v1/fund_accounts/validations') {
        const v = { id: rid('fav'), status: 'created', fund_account: body.fund_account, results: null as any };
        fake.validations.set(v.id, v);
        return send(res, 200, v);
      }
      const getVal = url.match(/^\/v1\/fund_accounts\/validations\/([^/?]+)$/);
      if (req.method === 'GET' && getVal) {
        const v = fake.validations.get(getVal[1]);
        if (!v) return send(res, 404, { error: { description: 'not found' } });
        v.status = 'completed';
        v.results = { account_status: 'active', registered_name: 'SRI LAKSHMI STEEL TRADERS' };
        return send(res, 200, v);
      }
      send(res, 404, { error: { description: `no route ${req.method} ${url}` } });
    });
  });
  return new Promise((resolve) => fakeServer.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`)));
}

// ---------- app ----------
let md: { token: string; userId: string };
let project: any;
let ic: { token: string; userId: string };
let vendorId = '';

before(async () => {
  const base = await startFake();
  process.env.RAZORPAYX_KEY_ID = KEY_ID;
  process.env.RAZORPAYX_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAYX_ACCOUNT_NUMBER = ACCOUNT;
  process.env.RAZORPAYX_API_BASE = base;
  await startTestServer();
  md = await registerMD('RzpMD');
  project = await createProject(md.token, 'RzpSite');
  ic = await assignNewInCharge(md.token, project._id, 'Praveen');
  const b = await api('POST', '/api/v1/payments/beneficiaries', {
    token: md.token,
    body: { name: 'Sri Lakshmi Steel Traders', payeeType: 'SUPPLIER', vpa: 'srilakshmi@okicici', accountNumber: '50100012345678', ifsc: 'HDFC0001234' },
  });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  vendorId = b.body.beneficiary?._id || b.body.beneficiary?.id;
});

after(async () => {
  await stopTestServer();
  await new Promise<void>((r) => fakeServer.close(() => r()));
});

async function icRequest(amountRupees: number, vpa = 'praveen@okaxis') {
  const r = await api('POST', '/api/v1/payments/requests', {
    token: ic.token,
    body: { projectId: project._id, payeeKind: 'INCHARGE', payeeVpa: vpa, amountRupees, purpose: 'Site advance – labour & diesel' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.payment;
}
async function vendorRequest(amountRupees: number) {
  const r = await api('POST', '/api/v1/payments/requests', {
    token: ic.token,
    body: { projectId: project._id, payeeKind: 'VENDOR', beneficiaryId: vendorId, amountRupees, purpose: 'TMT steel 12mm (2.5 t)' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.payment;
}
const detail = async (id: string) => (await api('GET', `/api/v1/payments/requests/${id}`, { token: md.token })).body.payment;
let eventSeq = 0;
async function webhook(event: string, payout: Payout, eventId = `evt_${++eventSeq}_${Date.now()}`) {
  const body = JSON.stringify({ entity: 'event', account_id: 'acc_test', event, contains: ['payout'], payload: { payout: { entity: payout } }, created_at: Math.floor(Date.now() / 1000) });
  return api('POST', '/api/v1/payments/webhook', {
    body,
    headers: { 'x-razorpay-signature': webhookSignature(body), 'x-razorpay-event-id': eventId },
  });
}

describe('setup status', () => {
  test('MD sees test mode without any secret; in-charge cannot see it', async () => {
    const r = await api('GET', '/api/v1/payments/provider-status', { token: md.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.provider.enabled, true);
    assert.equal(r.body.provider.mode, 'test');
    assert.equal(r.body.provider.accountNumberHint, '•••• 6905');
    assert.ok(!JSON.stringify(r.body).includes(KEY_SECRET));
    assert.equal((await api('GET', '/api/v1/payments/provider-status', { token: ic.token })).status, 403);
  });

  test('live keys stay blocked until PAYMENTS_LIVE_ENABLED=true', async () => {
    process.env.RAZORPAYX_KEY_ID = 'rzp_live_abc';
    try {
      const r = await api('GET', '/api/v1/payments/provider-status', { token: md.token });
      assert.equal(r.body.provider.enabled, false);
      assert.match(r.body.provider.reason, /PAYMENTS_LIVE_ENABLED/);
    } finally {
      process.env.RAZORPAYX_KEY_ID = KEY_ID;
    }
  });

  test('payout options follow the payee details', async () => {
    const p1 = await icRequest(100);
    const o1 = await api('GET', `/api/v1/payments/requests/${p1._id}/payout-options`, { token: md.token });
    assert.deepEqual(o1.body.modes, ['UPI']);
    const p2 = await vendorRequest(100);
    const o2 = await api('GET', `/api/v1/payments/requests/${p2._id}/payout-options`, { token: md.token });
    assert.deepEqual(o2.body.modes, ['UPI', 'IMPS', 'NEFT', 'RTGS']);
    const noVpa = await api('POST', '/api/v1/payments/requests', {
      token: ic.token,
      body: { projectId: project._id, payeeKind: 'INCHARGE', amountRupees: 10, purpose: 'x' },
    });
    const o3 = await api('GET', `/api/v1/payments/requests/${noVpa.body.payment._id}/payout-options`, { token: md.token });
    assert.deepEqual(o3.body.modes, []);
  });
});

describe('paying an in-charge by UPI', () => {
  let id = '';
  let payout: Payout;

  test('part payout goes to RazorpayX and the request is locked while processing', async () => {
    fake.nextStatus = 'processing';
    const p = await icRequest(12500);
    id = p._id;
    const r = await api('POST', `/api/v1/payments/requests/${id}/initiate`, { token: md.token, body: { amountRupees: 5000, mode: 'UPI' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.outcome, 'pending');
    assert.equal(r.body.payment.status, 'PROCESSING');
    assert.equal(r.body.payment.paidPaise, 0, 'not counted until RazorpayX says processed');
    payout = [...fake.payouts.values()].find((x) => x.notes.paymentId === id)!;
    assert.equal(payout.amount, 500000);
    assert.equal(payout.purpose, 'payout');
    assert.equal(payout.mode, 'UPI');
    const contact = fake.contacts.get(fake.fundAccounts.get(payout.fund_account_id).contact_id);
    assert.equal(contact.type, 'employee');
    assert.equal(fake.fundAccounts.get(payout.fund_account_id).vpa.address, 'praveen@okaxis');
  });

  test('no second payout or manual payment while one is running', async () => {
    const again = await api('POST', `/api/v1/payments/requests/${id}/initiate`, { token: md.token, body: { amountRupees: 100, mode: 'UPI' } });
    assert.equal(again.status, 409);
    const manual = await api('POST', `/api/v1/payments/requests/${id}/pay`, {
      token: md.token,
      body: { settlementKey: 'k-manual-while-processing', amountRupees: 100, mode: 'CASH' },
    });
    assert.equal(manual.status, 400);
    const cancel = await api('POST', `/api/v1/payments/requests/${id}/cancel`, { token: ic.token, body: {} });
    assert.equal(cancel.status, 400);
  });

  test('payout.processed webhook records the payment with its UTR, once', async () => {
    payout.status = 'processed';
    payout.utr = '612345678901';
    const evt = `evt_processed_${Date.now()}`;
    const w = await webhook('payout.processed', payout, evt);
    assert.equal(w.status, 200, JSON.stringify(w.body));
    let d = await detail(id);
    assert.equal(d.status, 'PARTIALLY_PAID');
    assert.equal(d.paidPaise, 500000);
    assert.equal(d.pendingPayout, null);
    const entry = d.settlements.find((s: any) => s.mode === 'RAZORPAYX');
    assert.equal(entry.reference, '612345678901');
    assert.equal(entry.amountPaise, 500000);

    // same event again, and a different event for the same payout: no double count
    await webhook('payout.processed', payout, evt);
    await webhook('payout.updated', payout);
    d = await detail(id);
    assert.equal(d.paidPaise, 500000);
    assert.equal(d.settlements.length, 1);

    const n = await api('GET', '/api/v1/notifications', { token: ic.token });
    const list = n.body.notifications || n.body.data || [];
    assert.ok(list.some((x: any) => /paid you ₹5,000/.test(x.message)), 'in-charge notified');
  });

  test('UPI above ₹1,00,000 is refused before anything is sent', async () => {
    const p = await icRequest(150000);
    const before = fake.posts;
    const r = await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: { amountRupees: 150000, mode: 'UPI' } });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /at most ₹1,00,000/);
    assert.equal(fake.posts, before);
    assert.equal((await detail(p._id)).status, p.status, 'status unchanged');
  });

  test('an in-charge cannot send a payout', async () => {
    const r = await api('POST', `/api/v1/payments/requests/${id}/initiate`, { token: ic.token, body: { amountRupees: 100, mode: 'UPI' } });
    assert.equal(r.status, 403);
  });
});

describe('paying a vendor', () => {
  test('IMPS to the bank account, processed at once → PAID, vendor bill purpose, clean narration', async () => {
    fake.nextStatus = 'processed';
    const p = await vendorRequest(148000);
    const r = await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: { mode: 'IMPS' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.outcome, 'paid');
    assert.equal(r.body.payment.status, 'PAID');
    assert.equal(r.body.payment.paidPaise, 14800000);
    const payout = [...fake.payouts.values()].find((x) => x.notes.paymentId === p._id)!;
    assert.equal(payout.purpose, 'vendor bill');
    assert.equal(fake.fundAccounts.get(payout.fund_account_id).account_type, 'bank_account');
    assert.equal(r.body.payment.fees, 590);
  });

  test('UPI and bank fund accounts are kept apart for the same vendor', async () => {
    fake.nextStatus = 'processed';
    const p = await vendorRequest(2000);
    const r = await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: { mode: 'UPI' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const payout = [...fake.payouts.values()].find((x) => x.notes.paymentId === p._id)!;
    assert.equal(fake.fundAccounts.get(payout.fund_account_id).account_type, 'vpa');
  });

  test('RazorpayX refusing the payout leaves the request payable with the reason', async () => {
    fake.rejectNext = 'Your account does not have enough balance to carry out the payout operation.';
    const p = await vendorRequest(3000);
    const r = await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: { mode: 'NEFT' } });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /enough balance/);
    const d = await detail(p._id);
    assert.equal(d.status, 'SUBMITTED');
    assert.equal(d.pendingPayout, null);
    assert.equal(d.paidPaise, 0);
    assert.match(d.failureReason, /enough balance/);
  });

  test('timeout: stays locked, and "check status" finds the same payout without paying twice', async () => {
    fake.nextStatus = 'processed';
    fake.crashNext = true;
    const p = await vendorRequest(4000);
    const r = await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: { mode: 'NEFT' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.outcome, 'unknown');
    assert.match(r.body.message, /Do NOT pay again/);
    assert.equal((await detail(p._id)).status, 'PROCESSING');

    const count = () => [...fake.payouts.values()].filter((x) => x.notes.paymentId === p._id).length;
    assert.equal(count(), 1);
    const rec = await api('POST', `/api/v1/payments/requests/${p._id}/reconcile`, { token: md.token, body: {} });
    assert.equal(rec.status, 200, JSON.stringify(rec.body));
    assert.equal(rec.body.outcome, 'paid');
    assert.equal(rec.body.payment.status, 'PAID');
    assert.equal(count(), 1, 'the retry reused the idempotency key — still one payout');
  });

  test('payout.failed webhook puts the request back as it was', async () => {
    fake.nextStatus = 'processing';
    const p = await vendorRequest(5000);
    await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: { mode: 'NEFT' } });
    const payout = [...fake.payouts.values()].find((x) => x.notes.paymentId === p._id)!;
    payout.status = 'failed';
    (payout as any).status_details = { description: 'Beneficiary bank was offline' };
    await webhook('payout.failed', payout);
    const d = await detail(p._id);
    assert.equal(d.status, 'SUBMITTED');
    assert.equal(d.paidPaise, 0);
    assert.match(d.failureReason, /offline/);
    // and it can be paid again
    fake.nextStatus = 'processed';
    const again = await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: { mode: 'IMPS' } });
    assert.equal(again.body.payment.status, 'PAID');
  });

  test('payout.reversed after processed undoes the entry and the balance is due again', async () => {
    fake.nextStatus = 'processed';
    const p = await vendorRequest(6000);
    await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: { mode: 'IMPS' } });
    const payout = [...fake.payouts.values()].find((x) => x.notes.paymentId === p._id)!;
    payout.status = 'reversed';
    (payout as any).status_details = { description: 'Account closed' };
    const w = await webhook('payout.reversed', payout);
    assert.equal(w.status, 200);
    const d = await detail(p._id);
    assert.equal(d.paidPaise, 0);
    assert.notEqual(d.status, 'PAID');
    const entry = d.settlements.find((s: any) => s.mode === 'RAZORPAYX');
    assert.equal(entry.voided, true);
    assert.match(entry.voidReason, /Account closed/);
  });

  test('no fake contact names, purposes or narrations were sent', () => {
    assert.deepEqual(fake.violations, []);
  });
});

describe('webhooks and verification', () => {
  test('unsigned webhooks are refused; unknown payouts are acknowledged', async () => {
    const body = JSON.stringify({ event: 'payout.processed', payload: { payout: { entity: { id: 'pout_x', status: 'processed', amount: 100 } } } });
    assert.equal((await api('POST', '/api/v1/payments/webhook', { body })).status, 401);
    const ok = await webhook('payout.processed', { id: 'pout_unknown', status: 'processed', amount: 100 } as any);
    assert.equal(ok.status, 200);
  });

  test('₹1 bank account verification marks the vendor VERIFIED with the bank name', async () => {
    const r = await api('POST', `/api/v1/payments/beneficiaries/${vendorId}/validate`, { token: md.token, body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.verification.status, 'VERIFIED');
    assert.equal(r.body.verification.verifiedName, 'SRI LAKSHMI STEEL TRADERS');
  });

  test('without keys, payouts and verification are refused (never simulated)', async () => {
    const saved = process.env.RAZORPAYX_KEY_ID;
    process.env.RAZORPAYX_KEY_ID = '';
    try {
      const p = await vendorRequest(700);
      const r = await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: { mode: 'IMPS' } });
      assert.equal(r.status, 400);
      assert.match(r.body.message, /not switched on/);
      const v = await api('POST', `/api/v1/payments/beneficiaries/${vendorId}/validate`, { token: md.token, body: {} });
      assert.equal(v.status, 400);
      const list = await api('GET', '/api/v1/payments/requests', { token: md.token });
      assert.equal(list.body.summary.payoutsEnabled, false);
    } finally {
      process.env.RAZORPAYX_KEY_ID = saved;
    }
  });
});
