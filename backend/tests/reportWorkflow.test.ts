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
    assert.ok(r.body.errors.length >= 3);
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
});
