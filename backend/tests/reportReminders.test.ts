/**
 * Daily report reminders: the In-Charge is reminded after the reminder time,
 * the MD is alerted after the escalation time, each once per site per day,
 * only on work days, and never for a site that already reported.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge } from './helpers.js';
import { runReportReminders } from '../src/services/reportReminderService.js';

// Tuesday 10 Nov 2026, given as UTC instants (IST = UTC + 5:30)
const TUE_1700_IST = new Date('2026-11-10T11:30:00Z');
const TUE_1830_IST = new Date('2026-11-10T13:00:00Z');
const TUE_2030_IST = new Date('2026-11-10T15:00:00Z');
const SUN_2030_IST = new Date('2026-11-15T15:00:00Z');

let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let silent: any; // no report on Tuesday
let reported: any; // reported on Tuesday
let icSilent: { token: string; userId: string };
let icReported: { token: string; userId: string };

async function notes(token: string, type: string) {
  const r = await api('GET', '/api/v1/notifications?limit=100', { token });
  return (r.body.notifications || r.body.data || []).filter((n: any) => n.type === type);
}

before(async () => {
  await startTestServer();
  md = await registerMD('RemindMD');
  otherMd = await registerMD('OtherRemindMD');
  silent = await createProject(md.token, 'QuietSite');
  reported = await createProject(md.token, 'BusySite');
  icSilent = await assignNewInCharge(md.token, silent._id, 'Kiran');
  icReported = await assignNewInCharge(md.token, reported._id, 'Mohan');
  const rep = await api('POST', '/api/v1/daily-reports', {
    token: icReported.token,
    body: {
      project: reported._id,
      titleOfWork: 'Slab shuttering',
      workDate: '2026-11-10',
      workSummary: 'Shuttering for slab 2 done',
      status: 'SUBMITTED',
    },
  });
  assert.equal(rep.status, 201, JSON.stringify(rep.body));
});

after(async () => {
  await stopTestServer();
});

describe('report reminders', () => {
  test('nothing before the reminder time', async () => {
    const r = await runReportReminders(TUE_1700_IST);
    assert.deepEqual(r, { reminded: 0, escalated: 0 });
  });

  test('after 6 PM the In-Charge of the silent site is reminded, once', async () => {
    const r = await runReportReminders(TUE_1830_IST);
    assert.equal(r.reminded, 1);
    assert.equal(r.escalated, 0);
    const again = await runReportReminders(TUE_1830_IST);
    assert.equal(again.reminded, 0, 'no second reminder the same day');

    const got = await notes(icSilent.token, 'DAILY_REPORT_REMINDER');
    assert.equal(got.length, 1);
    assert.match(got[0].message, /QuietSite/);
    assert.equal((await notes(icReported.token, 'DAILY_REPORT_REMINDER')).length, 0, 'site that reported is left alone');
    assert.equal((await notes(md.token, 'DAILY_REPORT_MISSING')).length, 0, 'MD not told yet');
  });

  test('after 8 PM the MD gets one alert naming the site and In-Charge', async () => {
    const r = await runReportReminders(TUE_2030_IST);
    assert.equal(r.escalated, 1);
    assert.equal(r.reminded, 0);
    await runReportReminders(TUE_2030_IST);

    const alerts = await notes(md.token, 'DAILY_REPORT_MISSING');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].message, /QuietSite/);
    assert.match(alerts[0].message, /Kiran/);
    assert.ok(!/BusySite/.test(alerts[0].message));
    assert.equal((await notes(otherMd.token, 'DAILY_REPORT_MISSING')).length, 0, 'other companies are not told');
  });

  test('no reminders on Sunday by default', async () => {
    const r = await runReportReminders(SUN_2030_IST);
    assert.deepEqual(r, { reminded: 0, escalated: 0 });
  });

  test('MD settings: validated, MD only, and turning them off stops reminders', async () => {
    const byIc = await api('PUT', '/api/v1/company-settings/report-reminders', {
      token: icSilent.token,
      body: { enabled: true, reminderTime: '17:00', escalationTime: '19:00', workDays: [1] },
    });
    assert.equal(byIc.status, 403);

    const wrongOrder = await api('PUT', '/api/v1/company-settings/report-reminders', {
      token: md.token,
      body: { enabled: true, reminderTime: '20:00', escalationTime: '19:00', workDays: [1] },
    });
    assert.equal(wrongOrder.status, 400);
    const noDays = await api('PUT', '/api/v1/company-settings/report-reminders', {
      token: md.token,
      body: { enabled: true, reminderTime: '17:00', escalationTime: '19:00', workDays: [] },
    });
    assert.equal(noDays.status, 400);

    const sundayOn = await api('PUT', '/api/v1/company-settings/report-reminders', {
      token: md.token,
      body: { enabled: true, reminderTime: '17:00', escalationTime: '19:00', workDays: [0, 1, 2, 3, 4, 5, 6] },
    });
    assert.equal(sundayOn.status, 200);
    assert.deepEqual(sundayOn.body.settings.reportReminders.workDays, [0, 1, 2, 3, 4, 5, 6]);
    const sunday = await runReportReminders(SUN_2030_IST);
    assert.equal(sunday.reminded, 2, 'both sites remind on Sunday once it is a work day');

    const off = await api('PUT', '/api/v1/company-settings/report-reminders', {
      token: md.token,
      body: { enabled: false, reminderTime: '17:00', escalationTime: '19:00', workDays: [1] },
    });
    assert.equal(off.status, 200);
    const read = await api('GET', '/api/v1/company-settings', { token: md.token });
    assert.equal(read.body.settings.reportReminders.enabled, false);
    const later = await runReportReminders(new Date('2026-11-16T15:00:00Z')); // Monday 8:30 PM IST
    assert.deepEqual(later, { reminded: 0, escalated: 0 });
  });
});
