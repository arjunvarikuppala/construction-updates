/**
 * Material log: stock added by the MD or in-charge, taken off by daily reports,
 * corrected when a report is edited, and visible to both on the project.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge } from './helpers.js';

let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let project: any;
let ic: { token: string; userId: string };

const stock = async (token = md.token) => {
  const r = await api('GET', `/api/v1/projects/${project._id}/materials`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.materials as any[];
};
const bal = async (name: string) => (await stock()).find((m) => m.name.toLowerCase() === name.toLowerCase())?.balance;
const addEntry = (token: string, body: Record<string, any>) =>
  api('POST', `/api/v1/projects/${project._id}/materials/entries`, { token, body });
const report = (body: Record<string, any>) =>
  api('POST', '/api/v1/daily-reports', {
    token: ic.token,
    body: { project: project._id, workDate: new Date().toISOString(), workSummary: 'Site work', status: 'SUBMITTED', ...body },
  });

before(async () => {
  await startTestServer();
  md = await registerMD('StockMD');
  otherMd = await registerMD('StockOther');
  project = await createProject(md.token, 'Stock site');
  ic = await assignNewInCharge(md.token, project._id, 'Ravi');
});

after(async () => {
  await stopTestServer();
});

describe('material log', () => {
  test('MD and in-charge both add stock', async () => {
    const a = await addEntry(md.token, { name: 'River sand', unit: 'tons', quantity: 10, supplier: 'Sri Lakshmi', billNo: '2231' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.material.balance, 10);
    const b = await addEntry(ic.token, { name: 'Cement (OPC 53)', unit: 'bags', quantity: 50 });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    // same material, different spacing / case → same row
    const c = await addEntry(ic.token, { name: 'river  SAND', unit: 'Tons', quantity: 2 });
    assert.equal(c.status, 201);
    assert.equal(await bal('River sand'), 12);
    assert.equal((await stock()).length, 2);
  });

  test('a submitted daily report takes the used quantity off the stock', async () => {
    const r = await report({
      titleOfWork: 'Footing PCC',
      materials: [
        { name: 'River sand', unit: 'tons', quantity: 2 },
        { name: 'cement (opc 53)', unit: 'bags', quantity: 4, received: 10 },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(await bal('River sand'), 10);
    assert.equal(await bal('Cement (OPC 53)'), 56); // 50 + 10 received − 4 used

    // editing the report corrects the stock instead of deducting twice
    const e = await api('PUT', `/api/v1/daily-reports/${r.body.report._id}`, {
      token: ic.token,
      body: { materials: [{ name: 'River sand', unit: 'tons', quantity: 3 }] },
    });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.equal(await bal('River sand'), 9);
    assert.equal(await bal('Cement (OPC 53)'), 50);
  });

  test('drafts and work before the start date do not change the stock', async () => {
    const d = await report({ titleOfWork: 'Draft work', status: 'DRAFT', materials: [{ name: 'River sand', unit: 'tons', quantity: 5 }] });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    const old = await report({
      titleOfWork: 'Old work',
      workDate: '2026-11-10T10:00:00+05:30',
      materials: [{ name: 'River sand', unit: 'tons', quantity: 5 }],
    });
    assert.equal(old.status, 201, JSON.stringify(old.body));
    assert.equal(await bal('River sand'), 9);
  });

  test('using more than is on site still saves and shows as low', async () => {
    const r = await report({ titleOfWork: 'Brick wall', materials: [{ name: 'Red bricks', unit: 'nos', quantity: 300 }] });
    assert.equal(r.status, 201);
    const bricks = (await stock()).find((m) => m.name === 'Red bricks');
    assert.equal(bricks.balance, -300);
    assert.equal(bricks.isLow, true);
  });

  test('low-stock level is set by the MD only', async () => {
    const sand = (await stock()).find((m) => m.name === 'River sand');
    const no = await api('PATCH', `/api/v1/projects/${project._id}/materials/${sand._id}`, { token: ic.token, body: { lowStockLevel: 9 } });
    assert.equal(no.status, 403);
    const ok = await api('PATCH', `/api/v1/projects/${project._id}/materials/${sand._id}`, { token: md.token, body: { lowStockLevel: 9 } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await stock()).find((m) => m.name === 'River sand').isLow, true);
  });

  test('count correction sets the balance to the counted figure', async () => {
    const sand = (await stock()).find((m) => m.name === 'River sand');
    const r = await addEntry(md.token, { materialId: sand._id, type: 'ADJUST', quantity: 8.5, note: 'Physical count' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.entry.change, -0.5);
    assert.equal(await bal('River sand'), 8.5);
    const same = await addEntry(md.token, { materialId: sand._id, type: 'ADJUST', quantity: 8.5 });
    assert.equal(same.status, 400);
  });

  test('log shows every change with running balance, for both roles', async () => {
    const sand = (await stock()).find((m) => m.name === 'River sand');
    const r = await api('GET', `/api/v1/projects/${project._id}/materials/log?materialId=${sand._id}`, { token: ic.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const e = r.body.entries;
    assert.equal(e[0].balanceAfter, 8.5); // newest first
    assert.equal(e[e.length - 1].balanceAfter, 10); // first: +10 stock added
    const used = e.find((x: any) => x.source === 'REPORT');
    assert.equal(used.change, -3);
    assert.equal(used.reportTitle, 'Footing PCC');
  });

  test('report entries cannot be deleted; manual ones only by their author or the MD', async () => {
    const log = (await api('GET', `/api/v1/projects/${project._id}/materials/log`, { token: md.token })).body.entries;
    const fromReport = log.find((x: any) => x.source === 'REPORT');
    const r1 = await api('DELETE', `/api/v1/projects/${project._id}/materials/entries/${fromReport._id}`, { token: md.token });
    assert.equal(r1.status, 400);

    const mdEntry = log.find((x: any) => x.source === 'MANUAL' && x.createdBy?._id === md.userId && x.type === 'IN');
    const r2 = await api('DELETE', `/api/v1/projects/${project._id}/materials/entries/${mdEntry._id}`, { token: ic.token });
    assert.equal(r2.status, 403);

    const icEntry = log.find((x: any) => x.source === 'MANUAL' && x.createdBy?._id === ic.userId);
    const r3 = await api('DELETE', `/api/v1/projects/${project._id}/materials/entries/${icEntry._id}`, { token: ic.token });
    assert.equal(r3.status, 200, JSON.stringify(r3.body));
  });

  test('another company cannot see or change the stock', async () => {
    const r = await api('GET', `/api/v1/projects/${project._id}/materials`, { token: otherMd.token });
    assert.equal(r.status, 404);
    const w = await addEntry(otherMd.token, { name: 'River sand', unit: 'tons', quantity: 1 });
    assert.equal(w.status, 404);
  });

  test('bad input is refused', async () => {
    assert.equal((await addEntry(md.token, { name: 'Sand', unit: 'tons', quantity: 0 })).status, 400);
    assert.equal((await addEntry(md.token, { name: '', unit: 'tons', quantity: 1 })).status, 400);
    assert.equal((await addEntry(md.token, { name: 'Sand', unit: 'tons', quantity: 1, date: '2099-01-01' })).status, 400);
    assert.equal((await addEntry(md.token, { name: 'Sand', unit: 'tons', quantity: 1, type: 'GIFT' })).status, 400);
  });
});
