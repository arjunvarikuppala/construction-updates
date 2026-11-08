/**
 * "MD approves by paying": In-Charge raises a request (for themselves or a
 * vendor), the MD pays from their own UPI/bank/cheque/cash and records it.
 * Covers part payments, overpay and duplicate-UTR protection, idempotency,
 * receipt confirmation, undo, summary, register and company isolation.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  startTestServer,
  stopTestServer,
  api,
  registerMD,
  createProject,
  assignNewInCharge,
  tinyPng,
} from './helpers.js';

let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let project: any;
let ic: { token: string; userId: string };
let ic2: { token: string; userId: string };
let proofUrl = '';

const key = () => `k-${crypto.randomBytes(8).toString('hex')}`;
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const utr = () => String(100000000000 + Math.floor(Math.random() * 899999999999));

before(async () => {
  await startTestServer();
  md = await registerMD('PayMD');
  otherMd = await registerMD('OtherMD');
  project = await createProject(md.token, 'Paysite');
  ic = await assignNewInCharge(md.token, project._id, 'Suresh');
  ic2 = await assignNewInCharge(md.token, project._id, 'Kiran');
  const form = new FormData();
  form.append('receipt', tinyPng(), 'upi-proof.png');
  const up = await api('POST', '/api/v1/expenses/upload-receipt', { token: md.token, form });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  proofUrl = up.body.receiptUrl;
});

after(async () => {
  await stopTestServer();
});

async function inChargeRequest(amountRupees: number, extra: Record<string, any> = {}) {
  const r = await api('POST', '/api/v1/payments/requests', {
    token: ic.token,
    body: {
      projectId: project._id,
      payeeKind: 'INCHARGE',
      payeeVpa: 'suresh@okaxis',
      amountRupees,
      paymentMethod: 'UPI',
      purpose: 'Site expenses reimbursement',
      ...extra,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.payment;
}

describe('in-charge payment requests', () => {
  test('in-charge can ask to be paid without any bank details', async () => {
    const p = await inChargeRequest(5000);
    assert.equal(p.payeeKind, 'INCHARGE');
    assert.equal(String(p.payeeUser), ic.userId);
    assert.equal(p.payeeNameSnapshot, 'Suresh');
    assert.equal(p.vpaSnapshot, 'suresh@okaxis');
    assert.equal(p.status, 'SUBMITTED');
    assert.equal(p.paidPaise, 0);
  });

  test('a bad UPI ID is refused', async () => {
    const r = await api('POST', '/api/v1/payments/requests', {
      token: ic.token,
      body: { projectId: project._id, payeeKind: 'INCHARGE', payeeVpa: 'not a upi', amountRupees: 10, purpose: 'x' },
    });
    assert.equal(r.status, 400);
  });

  test('an in-charge cannot request money on behalf of another in-charge', async () => {
    const p = await inChargeRequest(100, { payeeUserId: ic2.userId });
    assert.equal(String(p.payeeUser), ic.userId, 'payee is always the caller for an in-charge');
  });

  test('an in-charge cannot record a payment', async () => {
    const p = await inChargeRequest(100);
    const r = await api('POST', `/api/v1/payments/requests/${p._id}/pay`, {
      token: ic.token,
      body: { settlementKey: key(), amountRupees: 100, mode: 'CASH', paidOn: today() },
    });
    assert.equal(r.status, 403);
  });
});

describe('MD approves by paying', () => {
  let paymentId = '';
  let firstUtr = '';

  test('part payment by UPI moves the request to PARTIALLY_PAID', async () => {
    const p = await inChargeRequest(10000);
    paymentId = p._id;
    firstUtr = utr();
    const r = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees: 4000, mode: 'UPI', reference: firstUtr, paidOn: today(), proofUrl },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.payment.status, 'PARTIALLY_PAID');
    assert.equal(r.body.payment.paidPaise, 400000);
    assert.equal(String(r.body.payment.authorizedBy), md.userId, 'paying counts as the approval');
    assert.match(r.body.message, /Balance ₹6,000/);
  });

  test('paying more than the balance is refused', async () => {
    const r = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees: 6000.5, mode: 'CASH', paidOn: today() },
    });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /more than the balance/);
  });

  test('the same UTR cannot be recorded twice', async () => {
    const r = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees: 100, mode: 'UPI', reference: firstUtr, paidOn: today() },
    });
    assert.equal(r.status, 409);
  });

  test('a UTR already used for UPI cannot be reused as a bank transfer', async () => {
    const r = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees: 100, mode: 'BANK_TRANSFER', reference: firstUtr, paidOn: today() },
    });
    assert.equal(r.status, 409);
  });

  test('UPI and bank transfers need a reference; cash does not', async () => {
    const noRef = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees: 100, mode: 'BANK_TRANSFER', paidOn: today() },
    });
    assert.equal(noRef.status, 400);
    const future = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees: 100, mode: 'CASH', paidOn: '2999-01-01' },
    });
    assert.equal(future.status, 400);
  });

  test('a proof file uploaded by someone else is refused', async () => {
    const form = new FormData();
    form.append('receipt', tinyPng(), 'other.png');
    const up = await api('POST', '/api/v1/expenses/upload-receipt', { token: otherMd.token, form });
    const r = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees: 100, mode: 'CASH', paidOn: today(), proofUrl: up.body.receiptUrl },
    });
    assert.equal(r.status, 400);
  });

  test('a repeated tap with the same key records it only once', async () => {
    const k = key();
    const body = { settlementKey: k, amountRupees: 1000, mode: 'CHEQUE', reference: '004512', paidOn: today() };
    const a = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, { token: md.token, body });
    const b = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, { token: md.token, body });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.match(b.body.message, /already recorded/);
    assert.equal(b.body.payment.paidPaise, 500000);
  });

  test('paying the balance marks it PAID', async () => {
    const r = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees: 5000, mode: 'CASH', paidOn: today(), note: 'Given at site' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.payment.status, 'PAID');
    assert.equal(r.body.payment.paidPaise, 1000000);
    const again = await api('POST', `/api/v1/payments/requests/${paymentId}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees: 1, mode: 'CASH', paidOn: today() },
    });
    assert.equal(again.status, 400);
  });

  test('a paid request can no longer be rejected or cancelled', async () => {
    const rej = await api('POST', `/api/v1/payments/requests/${paymentId}/reject`, { token: md.token, body: { reason: 'x' } });
    assert.equal(rej.status, 400);
    const can = await api('POST', `/api/v1/payments/requests/${paymentId}/cancel`, { token: md.token, body: {} });
    assert.equal(can.status, 400);
  });

  test('the in-charge was notified and can see the MD proof file', async () => {
    const n = await api('GET', '/api/v1/notifications', { token: ic.token });
    assert.equal(n.status, 200);
    const list = n.body.notifications || n.body.data || [];
    assert.ok(list.some((x: any) => /paid you/.test(x.message)), 'payee notification');
    const sign = await api('POST', '/api/v1/files/sign', { token: ic.token, body: { urls: [proofUrl] } });
    assert.equal(sign.status, 200, JSON.stringify(sign.body));
    assert.ok(sign.body.signed[proofUrl], 'in-charge may open the proof of a payment on their project');
    const outsider = await api('POST', '/api/v1/files/sign', { token: otherMd.token, body: { urls: [proofUrl] } });
    assert.equal(outsider.body.signed[proofUrl], null);
  });

  test('only the payee can confirm receipt', async () => {
    const detail = await api('GET', `/api/v1/payments/requests/${paymentId}`, { token: md.token });
    const entry = detail.body.payment.settlements[0];
    const byMd = await api('POST', `/api/v1/payments/requests/${paymentId}/settlements/${entry._id}/confirm`, { token: md.token, body: {} });
    assert.equal(byMd.status, 403);
    const byOther = await api('POST', `/api/v1/payments/requests/${paymentId}/settlements/${entry._id}/confirm`, { token: ic2.token, body: {} });
    assert.equal(byOther.status, 403);
    const ok = await api('POST', `/api/v1/payments/requests/${paymentId}/settlements/${entry._id}/confirm`, { token: ic.token, body: {} });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.payment.settlements[0].receivedConfirmedAt);
  });

  test('undoing a wrong entry restores the balance and keeps the record', async () => {
    const detail = await api('GET', `/api/v1/payments/requests/${paymentId}`, { token: md.token });
    const cash = detail.body.payment.settlements.find((s: any) => s.mode === 'CASH');
    const noReason = await api('POST', `/api/v1/payments/requests/${paymentId}/settlements/${cash._id}/void`, { token: md.token, body: {} });
    assert.equal(noReason.status, 400);
    const byIc = await api('POST', `/api/v1/payments/requests/${paymentId}/settlements/${cash._id}/void`, { token: ic.token, body: { reason: 'x' } });
    assert.equal(byIc.status, 403);
    const r = await api('POST', `/api/v1/payments/requests/${paymentId}/settlements/${cash._id}/void`, {
      token: md.token,
      body: { reason: 'Entered twice' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.payment.status, 'PARTIALLY_PAID');
    assert.equal(r.body.payment.paidPaise, 500000);
    assert.equal(r.body.payment.settlements.length, 3);
    assert.ok(r.body.payment.settlements.find((s: any) => s._id === cash._id).voided);
  });
});

describe('MD records a vendor payment directly', () => {
  test('MD can add and pay a vendor in one step, linking the expense', async () => {
    const form = new FormData();
    form.append('file', tinyPng(), 'cement-bill.png');
    const up = await api('POST', '/api/v1/uploads/single', { token: ic.token, form });
    const exp = await api('POST', '/api/v1/expenses', {
      token: ic.token,
      body: {
        project: project._id,
        date: new Date().toISOString(),
        category: 'CONSTRUCTION_MATERIALS',
        description: 'Cement 50 bags',
        vendor: 'Sri Cements',
        amount: 20000,
        receiptUrl: up.body.fileUrl,
      },
    });
    assert.equal(exp.status, 201, JSON.stringify(exp.body));
    const expenseId = exp.body.expense?._id || exp.body.data?._id;
    assert.ok(expenseId);

    const r = await api('POST', '/api/v1/payments/requests', {
      token: md.token,
      body: {
        projectId: project._id,
        payeeKind: 'VENDOR',
        newBeneficiary: { name: 'Sri Cements', payeeType: 'SUPPLIER', vpa: 'sricements@okicici' },
        amountRupees: 20000,
        paymentMethod: 'UPI',
        purpose: 'Cement 50 bags',
        expenseId,
        payNow: { settlementKey: key(), amountRupees: 20000, mode: 'BANK_TRANSFER', reference: 'HDFCN52026110912345', paidOn: today() },
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.payment.status, 'PAID');
    assert.equal(r.body.payment.payeeKind, 'VENDOR');
    const e = await api('GET', `/api/v1/expenses/${expenseId}`, { token: md.token });
    assert.equal((e.body.expense || e.body.data)?.paymentStatus, 'PAID');
  });

  test('MD can approve a payment for a chosen in-charge (site advance) and it starts AUTHORIZED', async () => {
    const r = await api('POST', '/api/v1/payments/requests', {
      token: md.token,
      body: { projectId: project._id, payeeKind: 'INCHARGE', payeeUserId: ic2.userId, amountRupees: 250000, purpose: 'Site advance – November' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.payment.status, 'AUTHORIZED', 'an MD-raised request, even high-value, needs no second approval');
    assert.equal(r.body.payment.payeeNameSnapshot, 'Kiran');
  });

  test('MD cannot pick a payee who is not an in-charge on the project', async () => {
    const r = await api('POST', '/api/v1/payments/requests', {
      token: md.token,
      body: { projectId: project._id, payeeKind: 'INCHARGE', payeeUserId: otherMd.userId, amountRupees: 100, purpose: 'x' },
    });
    assert.equal(r.status, 400);
  });

  test('a pay-now amount above the request total is refused and nothing is saved', async () => {
    const before = await api('GET', '/api/v1/payments/requests', { token: md.token });
    const r = await api('POST', '/api/v1/payments/requests', {
      token: md.token,
      body: {
        projectId: project._id,
        payeeKind: 'INCHARGE',
        payeeUserId: ic.userId,
        amountRupees: 100,
        purpose: 'x',
        payNow: { settlementKey: key(), amountRupees: 200, mode: 'CASH', paidOn: today() },
      },
    });
    assert.equal(r.status, 400);
    const afterList = await api('GET', '/api/v1/payments/requests', { token: md.token });
    assert.equal(afterList.body.count, before.body.count);
  });
});

describe('payment summary, register and isolation', () => {
  test('summary adds up this month', async () => {
    const r = await api('GET', '/api/v1/payments/summary', { token: md.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = r.body.summary;
    // 4,000 UPI + 1,000 cheque (5,000 cash undone) to in-charge + 20,000 to vendor
    assert.equal(s.paidToInChargesPaise, 500000);
    assert.equal(s.paidToVendorsPaise, 2000000);
    assert.equal(s.paidThisMonthPaise, 2500000);
    assert.equal(s.partialCount, 1);
    assert.equal(s.partialBalancePaise, 500000);
    assert.ok(s.unconfirmedReceipts >= 1);
  });

  test('other company sees nothing in its summary and cannot pay', async () => {
    const r = await api('GET', '/api/v1/payments/summary', { token: otherMd.token });
    assert.equal(r.body.summary.paidThisMonthPaise, 0);
    const list = await api('GET', '/api/v1/payments/requests', { token: md.token });
    const target = list.body.payments.find((p: any) => p.status === 'PARTIALLY_PAID');
    const pay = await api('POST', `/api/v1/payments/requests/${target._id}/pay`, {
      token: otherMd.token,
      body: { settlementKey: key(), amountRupees: 100, mode: 'CASH', paidOn: today() },
    });
    assert.equal(pay.status, 404);
  });

  test('MD downloads the monthly payments register; in-charge cannot', async () => {
    const month = today().slice(0, 7);
    const r = await api('GET', `/api/v1/payments/register?month=${month}`, { token: md.token });
    assert.equal(r.status, 200);
    assert.match(String(r.headers.get('content-type')), /spreadsheetml/);
    const ic403 = await api('GET', `/api/v1/payments/register?month=${month}`, { token: ic.token });
    assert.equal(ic403.status, 403);
    const bad = await api('GET', '/api/v1/payments/register?month=2026-13', { token: md.token });
    assert.equal(bad.status, 400);
  });

  test('RazorpayX payout is refused for an in-charge request (no saved vendor)', async () => {
    const p = await inChargeRequest(500);
    const r = await api('POST', `/api/v1/payments/requests/${p._id}/initiate`, { token: md.token, body: {} });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Pay/);
  });
});
