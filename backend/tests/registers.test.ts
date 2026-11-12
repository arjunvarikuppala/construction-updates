/**
 * Excel registers for the MD: per project (payments, daily work, expenses) and
 * per Site In-Charge (every payment made to them, salary + requests, by date).
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge } from './helpers.js';

let base = '';
let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let project: any;
let ic: { token: string; userId: string };

const key = () => `k-${crypto.randomBytes(8).toString('hex')}`;
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const utr = () => String(100000000000 + Math.floor(Math.random() * 899999999999));

const round2 = (n: number) => Math.round(n * 100) / 100;
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** Data rows (from row 4) as plain arrays, 0-based columns */
function rowsOf(ws: ExcelJS.Worksheet): any[][] {
  const out: any[][] = [];
  ws.eachRow((row, i) => {
    if (i > 3) out.push((row.values as any[]).slice(1));
  });
  return out;
}

async function workbook(path: string, token: string) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200, await res.clone().text());
  assert.match(res.headers.get('content-type') || '', /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as any);
  return wb;
}

before(async () => {
  base = await startTestServer();
  md = await registerMD('RegMD');
  otherMd = await registerMD('RegOther');
  project = await createProject(md.token, 'Register site');
  ic = await assignNewInCharge(md.token, project._id, 'Sara');
  await api('PUT', `/api/v1/users/in-charge/${ic.userId}`, { token: md.token, body: { salary: 30000, salaryFrequency: 'MONTHLY' } });

  // A payment request to the in-charge, paid in two parts
  const req = await api('POST', '/api/v1/payments/requests', {
    token: ic.token,
    body: { projectId: project._id, payeeKind: 'INCHARGE', payeeVpa: 'sara@okaxis', amountRupees: 12000, paymentMethod: 'UPI', purpose: 'Cement 40 bags', quantity: 40, unit: 'bags', rate: 300 },
  });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  for (const amountRupees of [5000, 7000]) {
    const p = await api('POST', `/api/v1/payments/requests/${req.body.payment._id}/pay`, {
      token: md.token,
      body: { settlementKey: key(), amountRupees, mode: 'UPI', reference: utr(), paidOn: today() },
    });
    assert.equal(p.status, 200, JSON.stringify(p.body));
  }
  // An unpaid request
  await api('POST', '/api/v1/payments/requests', {
    token: ic.token,
    body: { projectId: project._id, payeeKind: 'INCHARGE', amountRupees: 900, paymentMethod: 'UPI', purpose: 'Tea and snacks' },
  });
  // Salary
  const s = await api('POST', `/api/v1/salaries/employees/${ic.userId}/payments`, {
    token: md.token,
    body: { settlementKey: key(), month: today().slice(0, 7), amountRupees: 30000, mode: 'BANK_TRANSFER', reference: utr(), paidOn: today() },
  });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  // A daily work report
  const rep = await api('POST', '/api/v1/daily-reports', {
    token: ic.token,
    body: {
      project: project._id,
      titleOfWork: 'Brick work',
      workDate: new Date().toISOString(),
      workSummary: 'Brick placing on bathroom roof',
      workItems: [{ description: 'Brick masonry', quantity: 12, unit: 'cum', machineUsed: 'JCB 3DX (TS08EK4417)' }],
      labourBreakdown: [
        { role: 'Mason', count: 4, wagePerDay: 1000, contractor: 'Ramesh gang', inTime: '08:00', outTime: '17:00', hours: 8, otHours: 2, otRate: 150 },
        { role: 'Helper', count: 6, wagePerDay: 650 },
      ],
      materials: [{ name: 'Cement', quantity: 30, unit: 'bags', rate: 380, received: 100, supplier: 'Sri Sai Traders', billNo: 'SST-1' }],
      machinery: [
        { name: 'JCB', model: 'JCB 3DX', regNo: 'ts08ek4417', ownership: 'HIRED', operator: 'Suresh', quantity: 1, meterStart: 2150, meterEnd: 2155, rate: 1600, rateBasis: 'HOUR', dieselLitres: 20, dieselRate: 95, bata: 400, workDone: 'Backfilling', workQty: 28, workUnit: 'cum' },
        { name: 'Tipper', quantity: 1, rate: 1200, rateBasis: 'TRIP', trips: 3 },
      ],
      status: 'SUBMITTED',
    },
  });
  assert.equal(rep.status, 201, JSON.stringify(rep.body));
});

after(async () => {
  await stopTestServer();
});

describe('project payments & work register', () => {
  test('on-screen register lists every payment entry, unpaid requests and the work', async () => {
    const r = await api('GET', `/api/v1/export/projects/${project._id}/register`, { token: md.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const cement = r.body.payments.filter((p: any) => p.purpose === 'Cement 40 bags');
    assert.equal(cement.length, 2, 'one row per part payment');
    assert.deepEqual(cement.map((p: any) => p.paidPaise).sort(), [500000, 700000]);
    assert.ok(cement.every((p: any) => p.date === today() && p.utr));
    const tea = r.body.payments.find((p: any) => p.purpose === 'Tea and snacks');
    assert.equal(tea.paidPaise, 0);
    assert.equal(r.body.totals.paidPaise, 1200000);
    assert.equal(r.body.totals.duePaise, 90000);
    assert.equal(r.body.work.length, 1);
    assert.equal(r.body.work[0].labour, 10);
    assert.match(r.body.work[0].workItems, /Brick masonry: 12 cum/);
    assert.ok(!r.body.payments.some((p: any) => /Salary/.test(p.purpose)), 'salaries are not project payments');
  });

  test('Payments file: one row per payment, by date, with day totals and a timeline', async () => {
    const wb = await workbook(`/api/v1/export/projects/${project._id}/payments.xlsx`, md.token);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Payments', 'Payment timeline']);
    const ws = wb.getWorksheet('Payments')!;
    assert.equal(ws.getRow(3).getCell(1).value, 'Paid on');
    const data = rowsOf(ws).filter((r) => r[0] instanceof Date);
    assert.equal(data.length, 2, 'two part payments of the cement request');
    assert.deepEqual(data.map((r) => r[7]).sort(), [5000, 7000]);
    assert.equal(data[0][3], 40, 'quantity from the request');
    assert.equal(data[0][5], 300, 'rate from the request');
    assert.ok(rowsOf(ws).some((r) => typeof r[0] === 'string' && r[0].startsWith('Total ')), 'day total line');
    assert.equal(rowsOf(ws).find((r) => r[0] === 'GRAND TOTAL')![7], 12000);
    const tl = rowsOf(wb.getWorksheet('Payment timeline')!);
    assert.ok(tl.some((r) => r[3] === 'Raised') && tl.some((r) => r[3] === 'Part paid') && tl.some((r) => r[3] === 'Paid (full)'));
    assert.ok(!JSON.stringify(rowsOf(ws)).match(/budget/i), 'no budget anywhere');
    // Frozen header + date column, scrolling pane starts at B4 (column A must not show twice)
    const view: any = ws.views[0];
    assert.equal(view.state, 'frozen');
    assert.equal(view.topLeftCell, 'B4');
    assert.equal(view.activeCell, 'B4', 'selection inside the scrolling pane, not the frozen column');
    assert.ok((ws.getColumn(1).width || 0) >= 25, 'date column wide enough for day totals');
  });

  test('Work file: every day listed, labour / materials / machinery in detail', async () => {
    const from = shiftDay(today(), -2);
    const wb = await workbook(`/api/v1/export/projects/${project._id}/work.xlsx?from=${from}&to=${today()}`, md.token);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Daily work', 'Work items', 'Labour', 'Materials', 'Machinery']);
    const daily = rowsOf(wb.getWorksheet('Daily work')!);
    assert.equal(daily.filter((r) => r[1] === 'No daily report submitted').length, 2, 'the two days without a report are listed');
    const rep = daily.find((r) => r[3] === 'Brick work')!;
    // labour: 4 masons × 1000 + 4 × 2h OT × 150 = 5200; helpers 6 × 650 = 3900
    assert.equal(rep[6], 9100);
    // machinery: JCB 5h × 1600 = 8000 + diesel 20 L × 95 = 1900 + bata 400 = 10300; tipper 3 trips × 1200 = 3600
    assert.equal(rep[8], 13900);
    assert.match(String(rep[9]), /JCB 3DX \(TS08EK4417\) – 5 h/);
    assert.match(String(rep[9]), /Tipper – 3 trips/);
    const items = rowsOf(wb.getWorksheet('Work items')!).filter((r) => r[0] instanceof Date);
    assert.equal(items[0][8], 'JCB 3DX (TS08EK4417)');
    const labour = rowsOf(wb.getWorksheet('Labour')!).filter((r) => r[0] instanceof Date);
    const mason = labour.find((r) => r[2] === 'Mason')!;
    assert.equal(mason[1], 'Ramesh gang');
    assert.equal(mason[12], 1200, 'OT pay');
    assert.equal(mason[13], 5200);
    const mats = rowsOf(wb.getWorksheet('Materials')!).filter((r) => r[0] instanceof Date);
    const cement = mats.find((r) => r[1] === 'Cement')!;
    assert.equal(cement[4], 0, 'opening');
    assert.equal(cement[5], 100, 'received');
    assert.equal(cement[8], 30, 'used');
    assert.equal(cement[10], 70, 'closing = opening + received − used');
    const mach = rowsOf(wb.getWorksheet('Machinery')!).filter((r) => r[0] instanceof Date);
    const jcb = mach.find((r) => r[1] === 'JCB')!;
    assert.equal(jcb[4], 'TS08EK4417');
    assert.equal(jcb[12], 5, 'hours taken from the hour meter');
    assert.equal(jcb[24], 10300);
    assert.equal(jcb[25], round2(10300 / 28), 'cost per cum backfilled');
  });

  test('Expenses file is date-wise', async () => {
    const wb = await workbook(`/api/v1/export/projects/${project._id}/expenses.xlsx`, md.token);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Expenses']);
  });

  test('in-charges and other companies cannot download it', async () => {
    assert.equal((await api('GET', `/api/v1/export/projects/${project._id}/register`, { token: ic.token })).status, 403);
    assert.equal((await api('GET', `/api/v1/export/projects/${project._id}/register`, { token: otherMd.token })).status, 404);
  });
});

describe('in-charge payment history', () => {
  test('lists salary and paid requests by date with totals', async () => {
    const r = await api('GET', `/api/v1/export/in-charges/${ic.userId}/payments`, { token: md.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.rows.length, 3);
    assert.equal(r.body.rows.filter((x: any) => x.type === 'Salary').length, 1);
    assert.equal(r.body.totals.salaryPaise, 3000000);
    assert.equal(r.body.totals.requestsPaise, 1200000);
    assert.equal(r.body.totals.totalPaise, 4200000);
    assert.equal(r.body.totals.unpaidRequestsPaise, 90000);
    assert.ok(r.body.rows.every((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(x.date)));
  });

  test('Salary file per person: payments by date and month-wise', async () => {
    const wb = await workbook(`/api/v1/export/in-charges/${ic.userId}/salary.xlsx`, md.token);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Salary payments', 'Month-wise']);
    const pay = rowsOf(wb.getWorksheet('Salary payments')!).filter((r) => r[0] instanceof Date);
    assert.equal(pay.length, 1);
    assert.equal(pay[0][3], 30000);
    assert.equal(pay[0][4], 0, 'month fully paid');
    assert.match(String(pay[0][9]), /^SAL-\d{6}-[0-9A-F]{4}-1$/);
    const months = rowsOf(wb.getWorksheet('Month-wise')!);
    assert.ok(months.some((r) => r[4] === 'Paid'));
    assert.equal((await api('GET', `/api/v1/export/in-charges/${ic.userId}/salary.xlsx`, { token: otherMd.token })).status, 404);
  });

  test('Excel has Summary, All payments, Salary and Payment requests sheets', async () => {
    const wb = await workbook(`/api/v1/export/in-charges/${ic.userId}/payments.xlsx`, md.token);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'All payments', 'Salary', 'Payment requests']);
    assert.ok(wb.getWorksheet('All payments')!.getRow(4).getCell(1).value instanceof Date);
  });

  test("another company's MD gets nothing", async () => {
    assert.equal((await api('GET', `/api/v1/export/in-charges/${ic.userId}/payments`, { token: otherMd.token })).status, 404);
  });
});
