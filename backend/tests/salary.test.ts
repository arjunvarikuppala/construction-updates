/**
 * Monthly salaries: the MD pays each Site In-Charge against a salary month
 * (in parts if needed), the in-charge is notified, sees only their own
 * history and confirms receipt. Covers overpay, duplicate UTR (also against
 * payment requests), idempotency, undo, proof access and company isolation.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge, tinyPng } from './helpers.js';

let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let ic: { token: string; userId: string };
let ic2: { token: string; userId: string };
let proofUrl = '';

const key = () => `k-${crypto.randomBytes(8).toString('hex')}`;
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const utr = () => String(100000000000 + Math.floor(Math.random() * 899999999999));
const shift = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const pay = (token: string, employeeId: string, body: Record<string, any>) =>
  api('POST', `/api/v1/salaries/employees/${employeeId}/payments`, {
    token,
    body: { settlementKey: key(), mode: 'UPI', reference: utr(), paidOn: today(), month: thisMonth(), ...body },
  });

before(async () => {
  await startTestServer();
  md = await registerMD('SalaryMD');
  otherMd = await registerMD('OtherSalaryMD');
  const project = await createProject(md.token, 'Salary site');
  ic = await assignNewInCharge(md.token, project._id, 'Karthik');
  ic2 = await assignNewInCharge(md.token, project._id, 'Praveen');
  // Monthly salaries: ₹45,000 and ₹50,000
  for (const [u, rupees] of [
    [ic, 45000],
    [ic2, 50000],
  ] as const) {
    const r = await api('PUT', `/api/v1/users/in-charge/${u.userId}`, { token: md.token, body: { salary: rupees, salaryFrequency: 'MONTHLY' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const form = new FormData();
  form.append('receipt', tinyPng(), 'salary-proof.png');
  const up = await api('POST', '/api/v1/expenses/upload-receipt', { token: md.token, form });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  proofUrl = up.body.receiptUrl;
});

after(async () => {
  await stopTestServer();
});

describe('paying salaries', () => {
  let firstUtr = '';
  let firstId = '';

  test('summary starts with everyone unpaid for the month', async () => {
    const r = await api('GET', `/api/v1/salaries/summary?month=${thisMonth()}`, { token: md.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = r.body.rows.find((x: any) => x.employee._id === ic.userId);
    assert.equal(row.status, 'UNPAID');
    assert.equal(row.duePaise, 4500000);
    assert.equal(r.body.totals.duePaise, 9500000);
  });

  test('an advance makes the month part-paid and notifies the in-charge', async () => {
    firstUtr = utr();
    const r = await pay(md.token, ic.userId, { amountRupees: 15000, reference: firstUtr, proofUrl, note: 'Advance' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    firstId = r.body.payment._id;
    const s = await api('GET', `/api/v1/salaries/summary?month=${thisMonth()}`, { token: md.token });
    const row = s.body.rows.find((x: any) => x.employee._id === ic.userId);
    assert.equal(row.status, 'PARTIAL');
    assert.equal(row.balancePaise, 3000000);
    const n = await api('GET', '/api/v1/notifications', { token: ic.token });
    const list = n.body.notifications || [];
    assert.ok(list.some((x: any) => x.type === 'SALARY_PAID' && x.relatedId === firstId), 'in-charge was notified');
  });

  test('the same tap twice records only once', async () => {
    const settlementKey = key();
    const body = { settlementKey, amountRupees: 1000, mode: 'CASH', reference: undefined };
    const a = await pay(md.token, ic.userId, body);
    const b = await pay(md.token, ic.userId, body);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(b.status, 200);
    assert.equal(b.body.duplicate, true);
    const undo = await api('POST', `/api/v1/salaries/payments/${a.body.payment._id}/void`, { token: md.token, body: { reason: 'test cash entry' } });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
  });

  test('paying more than the month balance is refused', async () => {
    const r = await pay(md.token, ic.userId, { amountRupees: 30001 });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /balance/);
  });

  test('a UTR already used is refused', async () => {
    const r = await pay(md.token, ic2.userId, { amountRupees: 100, reference: firstUtr });
    assert.equal(r.status, 409);
  });

  test('paying the balance completes the month', async () => {
    const r = await pay(md.token, ic.userId, { amountRupees: 30000 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const s = await api('GET', `/api/v1/salaries/summary?month=${thisMonth()}`, { token: md.token });
    const row = s.body.rows.find((x: any) => x.employee._id === ic.userId);
    assert.equal(row.status, 'PAID');
    assert.equal(row.paidPaise, 4500000);
    const again = await pay(md.token, ic.userId, { amountRupees: 100 });
    assert.equal(again.status, 400, 'a fully paid month takes no more');
  });

  test('more than one month in advance is refused', async () => {
    const r = await pay(md.token, ic.userId, { amountRupees: 100, month: shift(thisMonth(), 2) });
    assert.equal(r.status, 400);
  });

  test('history lists the month with every entry, undone ones kept', async () => {
    const r = await api('GET', `/api/v1/salaries/employees/${ic.userId}`, { token: md.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = r.body.history.find((h: any) => h.month === thisMonth());
    assert.equal(m.status, 'PAID');
    assert.equal(m.entries.length, 3);
    assert.equal(m.entries.filter((e: any) => e.voided).length, 1);
    assert.equal(r.body.totals.paidPaise, 4500000);
  });
});

describe('the in-charge side', () => {
  test('sees and confirms their own salary', async () => {
    const r = await api('GET', '/api/v1/salaries/me', { token: ic.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const entry = r.body.history.find((h: any) => h.month === thisMonth()).entries.find((e: any) => !e.voided);
    const c = await api('POST', `/api/v1/salaries/payments/${entry._id}/confirm`, { token: ic.token, body: {} });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.ok(c.body.payment.receivedConfirmedAt);
  });

  test("cannot see another in-charge's salary or use MD endpoints", async () => {
    assert.equal((await api('GET', `/api/v1/salaries/employees/${ic2.userId}`, { token: ic.token })).status, 403);
    assert.equal((await api('GET', '/api/v1/salaries/summary', { token: ic.token })).status, 403);
    assert.equal((await pay(ic.token, ic.userId, { amountRupees: 100 })).status, 403);
  });

  test('cannot confirm a payment made to someone else', async () => {
    const p = await pay(md.token, ic2.userId, { amountRupees: 1000 });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    const c = await api('POST', `/api/v1/salaries/payments/${p.body.payment._id}/confirm`, { token: ic.token, body: {} });
    assert.equal(c.status, 404);
  });

  test('can open the payment proof; another company cannot', async () => {
    const mine = await api('POST', '/api/v1/files/sign', { token: ic.token, body: { urls: [proofUrl] } });
    const theirs = await api('POST', '/api/v1/files/sign', { token: otherMd.token, body: { urls: [proofUrl] } });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.ok(mine.body.signed[proofUrl], 'in-charge gets a signed link to the proof');
    assert.equal(theirs.body.signed[proofUrl], null, 'another company gets nothing');
  });
});

describe('company isolation', () => {
  test("another MD cannot see or pay this company's in-charges", async () => {
    assert.equal((await api('GET', `/api/v1/salaries/employees/${ic.userId}`, { token: otherMd.token })).status, 404);
    assert.equal((await pay(otherMd.token, ic.userId, { amountRupees: 100 })).status, 404);
    const s = await api('GET', '/api/v1/salaries/summary', { token: otherMd.token });
    assert.equal(s.status, 200);
    assert.equal(s.body.rows.length, 0);
  });
});
