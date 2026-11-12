/**
 * Project search: one box over work, labour, materials, machinery, payments
 * and expenses, with type counts, payment-status and date filters.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge } from './helpers.js';

let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let project: any;
let ic: { token: string; userId: string };
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const utr = '412788901123';

const search = (token: string, params: Record<string, string>) =>
  api('GET', `/api/v1/projects/${project._id}/search?${new URLSearchParams(params)}`, { token });

before(async () => {
  await startTestServer();
  md = await registerMD('SearchMD');
  otherMd = await registerMD('SearchOther');
  project = await createProject(md.token, 'Search site');
  ic = await assignNewInCharge(md.token, project._id, 'Praveen');

  const rep = await api('POST', '/api/v1/daily-reports', {
    token: ic.token,
    body: {
      project: project._id,
      titleOfWork: 'Footing excavation',
      workDate: new Date().toISOString(),
      workSummary: 'Grids A1 to C4',
      workItems: [{ description: 'Excavation for footings', quantity: 42, unit: 'cum', rate: 350, machineUsed: 'JCB 3DX (TS08EK4417)' }],
      labourBreakdown: [{ role: 'Mason', count: 4, wagePerDay: 1000, contractor: 'Ramesh gang' }],
      materials: [{ name: 'Cement', quantity: 20, unit: 'bags', rate: 380, supplier: 'Sri Sai Traders' }],
      machinery: [{ name: 'JCB', model: '3DX', regNo: 'TS 08 EK 4417', operator: 'Suresh', quantity: 1, hoursUsed: 8, rate: 1600, rateBasis: 'HOUR' }],
      status: 'SUBMITTED',
    },
  });
  assert.equal(rep.status, 201, JSON.stringify(rep.body));

  const paid = await api('POST', '/api/v1/payments/requests', {
    token: ic.token,
    body: { projectId: project._id, payeeKind: 'INCHARGE', amountRupees: 45600, paymentMethod: 'UPI', purpose: 'For the jcb owner', quantity: 28.5, unit: 'hours', rate: 1600 },
  });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  const pay = await api('POST', `/api/v1/payments/requests/${paid.body.payment._id}/pay`, {
    token: md.token,
    body: { settlementKey: `k-${crypto.randomBytes(6).toString('hex')}`, amountRupees: 45600, mode: 'UPI', reference: utr, paidOn: today() },
  });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  await api('POST', '/api/v1/payments/requests', {
    token: ic.token,
    body: { projectId: project._id, payeeKind: 'INCHARGE', amountRupees: 900, paymentMethod: 'UPI', purpose: 'Tea and snacks' },
  });
});

after(async () => {
  await stopTestServer();
});

describe('project search', () => {
  test('an empty search returns nothing', async () => {
    const r = await search(md.token, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
  });

  test('"jcb" finds the machine, the work item and the payment, with counts per type', async () => {
    const r = await search(md.token, { q: 'jcb' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.counts.machinery, 1);
    assert.equal(r.body.counts.work, 1);
    assert.equal(r.body.counts.payments, 1);
    const p = r.body.results.find((x: any) => x.type === 'payments');
    assert.equal(p.status, 'Paid');
    assert.match(p.link, /^\/payments\?id=/);
    assert.match(r.body.results.find((x: any) => x.type === 'machinery').link, /^\/reports\//);
    assert.equal(r.body.summary.paidPaise, 4560000);
  });

  test('every word must match; number plate with or without spaces', async () => {
    assert.equal((await search(md.token, { q: 'jcb suresh' })).body.total, 1, 'only the machine has the operator');
    assert.equal((await search(md.token, { q: 'TS08EK4417' })).body.counts.machinery, 1);
    assert.equal((await search(md.token, { q: 'ramesh gang' })).body.counts.labour, 1);
    assert.equal((await search(md.token, { q: 'sri sai' })).body.counts.materials, 1);
  });

  test('finds payments by UTR, amount and date', async () => {
    assert.equal((await search(md.token, { q: utr })).body.counts.payments, 1);
    assert.equal((await search(md.token, { q: '45,600' })).body.counts.payments, 1);
    assert.equal((await search(md.token, { q: '45600' })).body.counts.payments, 1);
    const [y, m, d] = today().split('-');
    const r = await search(md.token, { q: `${d}-${m}-${y}` });
    assert.ok(r.body.total >= 3, 'everything from today');
  });

  test('payment status chips work without a search word', async () => {
    const waiting = await search(md.token, { status: 'WAITING' });
    assert.equal(waiting.body.total, 1);
    assert.equal(waiting.body.results[0].title, 'Tea and snacks');
    assert.equal(waiting.body.summary.duePaise, 90000);
    const paid = await search(md.token, { status: 'PAID' });
    assert.equal(paid.body.results[0].title, 'For the jcb owner');
  });

  test('type filter and date range', async () => {
    const only = await search(md.token, { q: 'jcb', types: 'payments' });
    assert.ok(only.body.results.every((x: any) => x.type === 'payments'));
    assert.equal(only.body.counts.machinery, 1, 'counts still show the other types');
    const past = await search(md.token, { q: 'jcb', from: '2020-01-01', to: '2020-12-31' });
    assert.equal(past.body.total, 0);
  });

  test('the assigned in-charge can search; another company cannot', async () => {
    assert.equal((await search(ic.token, { q: 'jcb' })).status, 200);
    assert.equal((await search(otherMd.token, { q: 'jcb' })).status, 404);
  });
});
