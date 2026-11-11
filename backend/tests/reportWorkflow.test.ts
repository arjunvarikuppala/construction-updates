/**
 * End-to-end daily report workflow over HTTP:
 * MD creates project → assigns In-Charge → In-Charge drafts a detailed report
 * (work items, labour, materials, machinery, expenses, photos) → submits →
 * MD sees full detail → dashboard + analytics reflect the stored data.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge, tinyPng } from './helpers.js';

let md: { token: string; userId: string; email: string };
let project: any;
let ic: { token: string; email: string; userId: string };
let photoUrl: string;
let receiptUrl: string;
let reportId: string;

const today = new Date();
const todayIso = today.toISOString();

before(async () => {
  await startTestServer();
  md = await registerMD('WorkflowMD');
  project = await createProject(md.token, 'Workflow', {
    expectedCompletionDate: new Date(Date.now() + 200 * 86400000).toISOString(),
  });
  ic = await assignNewInCharge(md.token, project._id, 'Lakshmi');

  for (const name of ['photo.png', 'receipt.png']) {
    const form = new FormData();
    form.append('file', tinyPng(), name);
    const r = await api('POST', '/api/v1/uploads/single', { token: ic.token, form });
    assert.equal(r.status, 200);
    if (name === 'photo.png') photoUrl = r.body.fileUrl;
    else receiptUrl = r.body.fileUrl;
  }
});

after(async () => {
  await stopTestServer();
});

const fullReport = () => ({
  project: project._id,
  titleOfWork: 'Second floor slab casting',
  workDate: todayIso,
  workSummary: 'Shuttering checked, reinforcement inspected, M25 concrete poured for slab S2.',
  workLocation: 'Block A – 2nd floor',
  shift: 'DAY',
  overallProgressPercent: 35,
  workItems: [
    { description: 'Slab concreting', quantity: 42.5, unit: 'cu.m', status: 'COMPLETED', location: 'Block A' },
    { description: 'Column shuttering', quantity: 12, unit: 'units', status: 'IN_PROGRESS', progressPercent: 60 },
    { description: '', quantity: 5, unit: 'units' }, // blank row should be dropped
  ],
  labourBreakdown: [
    { role: 'Mason', count: 6, category: 'SKILLED', hours: 8 },
    { role: 'Helper / Unskilled', count: 10, hours: 8 },
    { role: 'Site Supervisor', count: 1 },
    { role: 'Painter', count: 0 }, // zero rows dropped
  ],
  materials: [
    { name: 'Cement OPC 53', quantity: 120, unit: 'bags' },
    { name: 'TMT Steel 12mm', quantity: 1.2, unit: 'Tons' },
  ],
  machinery: [{ name: 'Transit mixer', quantity: 2, hoursUsed: 6 }],
  issuesAndDelays: 'Pump arrived 1 hour late.',
  nextDayPlan: 'Curing and column box removal.',
  remarks: 'Cube samples taken.',
  photos: [{ url: photoUrl, caption: 'Slab pour' }],
  expenses: [
    { category: 'DIESEL_AND_FUEL', description: 'Diesel for mixer', amount: 3450.5, vendor: 'HP Fuels', receiptUrl },
    { category: 'FOOD_AND_ACCOMMODATION', description: 'Tea and snacks', amount: 600 },
  ],
  status: 'DRAFT',
  clientRequestId: 'wf-test-request-0001',
});

describe('daily report workflow', () => {
  test('in-charge saves a detailed draft', async () => {
    const r = await api('POST', '/api/v1/daily-reports', { token: ic.token, body: fullReport() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const rep = r.body.report;
    reportId = rep._id;
    assert.equal(rep.status, 'DRAFT');
    assert.equal(rep.workItems.length, 2);
    assert.equal(rep.labourBreakdown.length, 3);
    assert.equal(rep.totalLabourCount, 17);
    assert.equal(rep.labourBreakdown[1].category, 'UNSKILLED');
    assert.equal(rep.labourBreakdown[2].category, 'SUPERVISOR');
    assert.equal(rep.materials.length, 2);
    assert.equal(rep.machinery[0].hoursUsed, 6);
    assert.equal(rep.workItems[0].progressPercent, 100);
    assert.equal(rep.submittedAt, undefined);
  });

  test('double-tap with the same clientRequestId does not create a duplicate', async () => {
    const r = await api('POST', '/api/v1/daily-reports', { token: ic.token, body: fullReport() });
    assert.equal(r.status, 200);
    assert.equal(r.body.duplicate, true);
    assert.equal(r.body.report._id, reportId);
  });

  test('draft is invisible to the MD and draft expenses are not in the approval queue', async () => {
    const list = await api('GET', `/api/v1/daily-reports?projectId=${project._id}`, { token: md.token });
    assert.ok(!list.body.reports.some((r: any) => r._id === reportId));
    const detail = await api('GET', `/api/v1/daily-reports/${reportId}`, { token: md.token });
    assert.equal(detail.status, 404);
    const exp = await api('GET', `/api/v1/expenses?projectId=${project._id}`, { token: md.token });
    assert.equal(exp.body.expenses.length, 0);
  });

  test('in-charge edits the draft (remove one expense, change a quantity)', async () => {
    const own = await api('GET', `/api/v1/daily-reports/${reportId}`, { token: ic.token });
    assert.equal(own.status, 200);
    assert.equal(own.body.report.expenses.length, 2);
    const keep = own.body.report.expenses.find((e: any) => e.category === 'DIESEL_AND_FUEL');
    assert.equal(keep.amount, 345050, 'amount stored as integer paise');
    assert.equal(keep.status, 'DRAFT');

    const upd = await api('PUT', `/api/v1/daily-reports/${reportId}`, {
      token: ic.token,
      body: {
        workItems: [
          { description: 'Slab concreting', quantity: 44, unit: 'cu.m', status: 'COMPLETED' },
          { description: 'Column shuttering', quantity: 12, unit: 'units', status: 'IN_PROGRESS' },
        ],
        expenses: [{ _id: keep._id, category: 'DIESEL_AND_FUEL', description: 'Diesel for mixer', amount: 3500, vendor: 'HP Fuels', receiptUrl }],
        status: 'DRAFT',
      },
    });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    const again = await api('GET', `/api/v1/daily-reports/${reportId}`, { token: ic.token });
    assert.equal(again.body.report.expenses.length, 1);
    assert.equal(again.body.report.expenses[0].amount, 350000);
    assert.equal(again.body.report.workItems[0].quantity, 44);
  });

  test('in-charge submits the report; expenses enter approval queue', async () => {
    const r = await api('PUT', `/api/v1/daily-reports/${reportId}`, { token: ic.token, body: { status: 'SUBMITTED' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.report.status, 'SUBMITTED');
    assert.ok(r.body.report.submittedAt);
    const exp = await api('GET', `/api/v1/expenses?projectId=${project._id}&status=PENDING`, { token: md.token });
    assert.equal(exp.body.expenses.length, 1);
    assert.equal(exp.body.expenses[0].dailyReport, reportId);
  });

  test('submitted report cannot go back to draft', async () => {
    const r = await api('PUT', `/api/v1/daily-reports/${reportId}`, { token: ic.token, body: { status: 'DRAFT' } });
    assert.equal(r.status, 400);
  });

  test('duplicate submission with same title/date is blocked', async () => {
    const body = { ...fullReport(), status: 'SUBMITTED', clientRequestId: 'wf-test-request-0002', expenses: [] };
    const r = await api('POST', '/api/v1/daily-reports', { token: ic.token, body });
    assert.equal(r.status, 409);
  });

  test('MD sees the complete report detail with attribution', async () => {
    const r = await api('GET', `/api/v1/daily-reports/${reportId}`, { token: md.token });
    assert.equal(r.status, 200);
    const rep = r.body.report;
    assert.equal(rep.submittedBy.name, 'Lakshmi');
    assert.equal(rep.workLocation, 'Block A – 2nd floor');
    assert.equal(rep.shift, 'DAY');
    assert.equal(rep.materials.length, 2);
    assert.equal(rep.machinery.length, 1);
    assert.equal(rep.remarks, 'Cube samples taken.');
    assert.equal(rep.photos.length, 1);
    assert.equal(rep.expenses.length, 1);
    assert.equal(rep.version, 3);

    const signed = await api('POST', '/api/v1/files/sign', { token: md.token, body: { urls: [photoUrl, receiptUrl] } });
    assert.ok(signed.body.signed[photoUrl], 'MD can open site photo');
    assert.ok(signed.body.signed[receiptUrl], 'MD can open receipt');
  });

  test('another in-charge on the project cannot edit this report', async () => {
    const other = await assignNewInCharge(md.token, project._id, 'Imran');
    const r = await api('PUT', `/api/v1/daily-reports/${reportId}`, { token: other.token, body: { remarks: 'hijack' } });
    assert.equal(r.status, 403);
  });

  test('MD approves the report expense', async () => {
    const exp = await api('GET', `/api/v1/expenses?projectId=${project._id}&status=PENDING`, { token: md.token });
    const r = await api('POST', `/api/v1/expenses/${exp.body.expenses[0]._id}/approve`, { token: md.token, body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  test('dashboard reflects the stored report data', async () => {
    const r = await api('GET', '/api/v1/dashboard/owner', { token: md.token });
    assert.equal(r.status, 200);
    const k = r.body.kpis;
    assert.equal(k.todayReportsSubmitted, 1);
    assert.equal(k.todayLabourCount, 17);
    assert.equal(k.todayExpenditurePaise, 350000);
    assert.equal(k.averageReportedProgress, 35);
    assert.equal(k.activeProjectsMissingTodayReport, 0);
    assert.equal(k.delayedReportsLast7Days, 1);
    assert.equal(r.body.projectExpenditures[0].latestProgressPercent, 35);
  });

  test('analytics aggregates real report and expense data', async () => {
    const r = await api('GET', '/api/v1/dashboard/analytics?granularity=day', { token: md.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const a = r.body;
    assert.equal(a.totals.reports, 1);
    assert.equal(a.totals.labourDays, 17);
    assert.equal(a.totals.approvedInRangePaise, 350000);
    assert.equal(a.totals.workItemsCompleted, 1);
    assert.equal(a.totals.workItemsTotal, 2);
    assert.equal(a.totals.issueReports, 1);
    const skilled = a.labourByCategory.find((c: any) => c.category === 'SKILLED');
    assert.equal(skilled.headcount, 6);
    assert.equal(skilled.labourHours, 48);
    const cmp = a.projectComparison[0];
    assert.equal(cmp.latestProgressPercent, 35);
    assert.equal(cmp.approvedLifetimePaise, 350000);
    assert.equal(cmp.daysReported, 1);
    assert.ok(a.expenditureSeries.length >= 28);
    assert.equal(a.expenditureSeries.reduce((s: number, p: any) => s + p.approvedPaise, 0), 350000);
  });

  test('analytics returns empty series (not fake data) for a project with no activity', async () => {
    const empty = await createProject(md.token, 'Empty');
    const r = await api('GET', `/api/v1/dashboard/analytics?projectId=${empty._id}`, { token: md.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.totals.reports, 0);
    assert.equal(r.body.totals.approvedInRangePaise, 0);
    assert.equal(r.body.progressSeries.length, 0);
    assert.equal(r.body.labourByCategory.length, 0);
  });

  test('invalid report payloads are rejected with validation messages', async () => {
    const r = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: { project: project._id, titleOfWork: '', workDate: 'not-a-date', workSummary: '' },
    });
    assert.equal(r.status, 400);
    // Title and date errors; the work description is optional (any one section is enough)
    assert.ok(r.body.errors.length >= 2);
    const future = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: { project: project._id, titleOfWork: 'x', workDate: new Date(Date.now() + 10 * 86400000).toISOString(), workSummary: 'x' },
    });
    assert.equal(future.status, 400);
    const badExpense = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: { ...fullReport(), clientRequestId: 'wf-test-request-0003', expenses: [{ category: 'NOPE', description: 'x', amount: 0.5 }] },
    });
    assert.equal(badExpense.status, 400);
  });

  test('a submitted report needs at least one section filled, but no particular one', async () => {
    const base = { project: project._id, workDate: new Date(Date.now() - 5 * 86400000).toISOString(), status: 'SUBMITTED' };
    const empty = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: { ...base, titleOfWork: 'Empty report' },
    });
    assert.equal(empty.status, 400);
    assert.match(empty.body.message, /at least one entry/i);

    // Only machinery — no description, no work items — is enough to submit
    const machineryOnly = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: { ...base, titleOfWork: 'Machinery only', machinery: [{ name: 'JCB', quantity: 1, hoursUsed: 4 }] },
    });
    assert.equal(machineryOnly.status, 201, JSON.stringify(machineryOnly.body));
    assert.equal(machineryOnly.body.report.status, 'SUBMITTED');
  });

  test('work item amount is quantity × rate per unit, computed on the server', async () => {
    const r = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: {
        project: project._id,
        titleOfWork: 'Excavation with JCB',
        workDate: new Date(Date.now() - 86400000).toISOString(),
        workSummary: 'Foundation excavation',
        status: 'DRAFT',
        workItems: [
          // client sends a tampered amount; server must use 6 hours × ₹1,250
          { description: 'JCB excavation', quantity: 6, unit: 'hours', rate: 1250, budget: 999999 },
          { description: 'Steel unloading', quantity: 2.5, unit: 'Tons', rate: 800 },
          { description: 'Site cleaning', quantity: 1, unit: 'nos', budget: 1500 }, // lump sum, no rate
        ],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const items = r.body.report.workItems;
    assert.equal(items[0].rate, 1250);
    assert.equal(items[0].budget, 7500);
    assert.equal(items[1].budget, 2000);
    assert.equal(items[2].rate, undefined);
    assert.equal(items[2].budget, 1500);
    assert.equal(r.body.report.totalWorkBudget, 11000);
  });

  test('labour cost is workers × daily wage, computed on the server', async () => {
    const r = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: {
        project: project._id,
        titleOfWork: 'Plastering block C',
        workDate: new Date(Date.now() - 2 * 86400000).toISOString(),
        workSummary: 'Internal plastering',
        status: 'DRAFT',
        totalLabourCost: 1, // tampered total must be ignored
        labourBreakdown: [
          { role: 'Mason', count: 3, category: 'SKILLED', wagePerDay: 900 },
          { role: 'Helper (Female)', count: 4, wagePerDay: 550 },
          { role: 'Helper (Male)', count: 2 }, // no wage entered
        ],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const rows = r.body.report.labourBreakdown;
    assert.equal(rows[0].wagePerDay, 900);
    assert.equal(rows[1].category, 'UNSKILLED');
    assert.equal(rows[2].wagePerDay, undefined);
    assert.equal(r.body.report.totalLabourCount, 9);
    assert.equal(r.body.report.totalLabourCost, 4900);
  });

  test('material and machinery costs are computed on the server (per unit, per day, per hour)', async () => {
    const r = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: {
        project: project._id,
        titleOfWork: 'Foundation PCC',
        workDate: new Date(Date.now() - 3 * 86400000).toISOString(),
        workSummary: 'PCC for footings',
        status: 'DRAFT',
        totalMaterialCost: 1, // tampered totals must be ignored
        totalMachineryCost: 1,
        materials: [
          { name: 'Cement OPC 53', quantity: 120, unit: 'bags', rate: 380 },
          { name: 'Sand', quantity: 2, unit: 'Tons', rate: 1450.5 },
          { name: 'Binding wire', quantity: 5, unit: 'kg' }, // no rate
        ],
        machinery: [
          { name: 'JCB', quantity: 1, hoursUsed: 6, rate: 1200, rateBasis: 'HOUR' },
          { name: 'Transit mixer', quantity: 2, hoursUsed: 8, rate: 6000, rateBasis: 'DAY' },
          { name: 'Vibrator', quantity: 1, rate: 500, rateBasis: 'bogus' }, // unknown basis → per day
          { name: 'Water pump', quantity: 1, hoursUsed: 4 }, // no rate
        ],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const rep = r.body.report;
    assert.equal(rep.materials[0].rate, 380);
    assert.equal(rep.materials[2].rate, undefined);
    assert.equal(rep.totalMaterialCost, 45600 + 2901);
    assert.equal(rep.machinery[0].rateBasis, 'HOUR');
    assert.equal(rep.machinery[2].rateBasis, 'DAY');
    assert.equal(rep.machinery[3].rateBasis, undefined);
    assert.equal(rep.totalMachineryCost, 7200 + 12000 + 500);
  });
});
