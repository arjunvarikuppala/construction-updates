/**
 * Daily report reminders and escalation.
 *
 * Every few minutes, for each active site (IN_PROGRESS) with no SUBMITTED report
 * for today (India time):
 *   - after the reminder time (default 6 PM) → remind its Site In-Charge(s);
 *   - after the escalation time (default 8 PM) → tell the MD, one summary per MD.
 * Each alert goes out at most once per site per day (ReportReminderLog).
 * Times, work days and on/off are the MD's company settings.
 */
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { DailyReport } from '../models/DailyReport.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { User } from '../models/User.js';
import { CompanySettings } from '../models/CompanySettings.js';
import { ReportReminderLog } from '../models/ReportReminderLog.js';
import { createNotification } from './notificationService.js';

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReminderConfig {
  enabled: boolean;
  reminderTime: string;
  escalationTime: string;
  workDays: number[];
}

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  reminderTime: '18:00',
  escalationTime: '20:00',
  workDays: [1, 2, 3, 4, 5, 6], // Monday–Saturday
};

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** "20:00" → "8:00 PM" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Company settings → a complete, valid config (falls back to defaults). */
export function reminderConfigOf(settings: any): ReminderConfig {
  const r = settings?.reportReminders || {};
  const reminderTime = TIME_RE.test(r.reminderTime) ? r.reminderTime : DEFAULT_REMINDER_CONFIG.reminderTime;
  const escalationTime = TIME_RE.test(r.escalationTime) ? r.escalationTime : DEFAULT_REMINDER_CONFIG.escalationTime;
  const workDays =
    Array.isArray(r.workDays) && r.workDays.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)
      ? [...new Set<number>(r.workDays)]
      : DEFAULT_REMINDER_CONFIG.workDays;
  return { enabled: r.enabled !== false, reminderTime, escalationTime, workDays };
}

/** Today's IST calendar day, minutes since IST midnight and weekday. */
function istNow(now: Date) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const dayKey = ist.toISOString().slice(0, 10);
  return {
    dayKey,
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    weekday: ist.getUTCDay(),
    // Report work dates are stored as UTC midnight of the chosen calendar day
    dayStart: new Date(`${dayKey}T00:00:00.000Z`),
  };
}

/** Claim an alert for a site and day; false if it was already sent. */
async function claim(project: mongoose.Types.ObjectId, day: string, kind: 'REMINDER' | 'ESCALATION', now: Date) {
  const r = await ReportReminderLog.updateOne(
    { project, day, kind },
    { $setOnInsert: { sentAt: now } },
    { upsert: true }
  );
  return r.upsertedCount === 1;
}

export async function runReportReminders(now: Date = new Date()): Promise<{ reminded: number; escalated: number }> {
  const { dayKey, minutes, weekday, dayStart } = istNow(now);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const result = { reminded: 0, escalated: 0 };

  const projects = await Project.find({ status: 'IN_PROGRESS' }).select('name code owner createdBy assignedInCharge startDate');
  if (projects.length === 0) return result;

  // Each site follows its own company's (MD's) settings
  const companyOf = (p: any) => String(p.owner || p.createdBy);
  const settingsRows = await CompanySettings.find({ owner: { $in: [...new Set(projects.map(companyOf))] } }).select(
    'owner reportReminders'
  );
  const configByCompany = new Map(settingsRows.map((s) => [String(s.owner), reminderConfigOf(s)]));
  const configOf = (p: any) => configByCompany.get(companyOf(p)) || DEFAULT_REMINDER_CONFIG;

  const due = projects.filter((p) => {
    const c = configOf(p);
    return (
      c.enabled &&
      c.workDays.includes(weekday) &&
      minutes >= toMinutes(c.reminderTime) &&
      (!p.startDate || p.startDate < dayEnd)
    );
  });
  if (due.length === 0) return result;

  const reported = new Set(
    (
      await DailyReport.distinct('project', {
        project: { $in: due.map((p) => p._id) },
        status: 'SUBMITTED',
        workDate: { $gte: dayStart, $lt: dayEnd },
      })
    ).map(String)
  );
  const missing = due.filter((p) => !reported.has(String(p._id)));
  if (missing.length === 0) return result;

  // Site In-Charges of each missing site: active assignments plus the older single-assignee field
  const assignments = await ProjectAssignment.find({
    project: { $in: missing.map((p) => p._id) },
    assignmentStatus: 'ACTIVE',
  }).select('project siteInCharge');
  const inChargeIdsByProject = new Map<string, Set<string>>();
  for (const p of missing) {
    const ids = new Set<string>();
    if (p.assignedInCharge) ids.add(String(p.assignedInCharge));
    inChargeIdsByProject.set(String(p._id), ids);
  }
  for (const a of assignments) inChargeIdsByProject.get(String(a.project))?.add(String(a.siteInCharge));
  const allInChargeIds = [...new Set([...inChargeIdsByProject.values()].flatMap((s) => [...s]))];
  const activeInCharges = await User.find({
    _id: { $in: allInChargeIds },
    isActive: true,
    role: { $in: ['SITE_INCHARGE', 'IN_CHARGE'] },
  }).select('name');
  const inChargeName = new Map(activeInCharges.map((u) => [String(u._id), u.name]));

  // MD summaries, grouped by MD
  const escalationsByMd = new Map<string, Array<{ name: string; who: string }>>();

  for (const p of missing) {
    const c = configOf(p);
    const pid = String(p._id);
    const inCharges = [...(inChargeIdsByProject.get(pid) || [])].filter((id) => inChargeName.has(id));
    const siteName = p.code ? `${p.name} (${p.code})` : p.name;

    if (await claim(p._id, dayKey, 'REMINDER', now)) {
      for (const icId of inCharges) {
        await createNotification({
          recipient: icId,
          project: p._id,
          type: 'DAILY_REPORT_REMINDER',
          title: 'Daily report due',
          message: `No report yet today for ${siteName}. Please submit it before ${formatTime(c.escalationTime)}.`,
          relatedEntity: 'PROJECT',
          relatedId: pid,
        });
      }
      result.reminded += 1;
    }

    if (minutes >= toMinutes(c.escalationTime) && (await claim(p._id, dayKey, 'ESCALATION', now))) {
      const who = inCharges.length ? inCharges.map((id) => inChargeName.get(id)).join(', ') : 'no In-Charge assigned';
      const mdIds = new Set([p.owner, p.createdBy].filter(Boolean).map(String));
      for (const mdId of mdIds) {
        if (!escalationsByMd.has(mdId)) escalationsByMd.set(mdId, []);
        escalationsByMd.get(mdId)!.push({ name: p.name, who });
      }
      result.escalated += 1;
    }
  }

  if (escalationsByMd.size > 0) {
    const activeMds = await User.find({
      _id: { $in: [...escalationsByMd.keys()] },
      isActive: true,
      role: { $in: ['MD', 'OWNER'] },
    }).select('_id');
    for (const md of activeMds) {
      const sites = escalationsByMd.get(String(md._id)) || [];
      const list = sites.map((s) => `${s.name} — ${s.who}`).join('; ');
      const message = `${sites.length === 1 ? '1 site has' : `${sites.length} sites have`} no daily report today: ${list}`;
      await createNotification({
        recipient: md._id,
        type: 'DAILY_REPORT_MISSING',
        title: 'Daily reports missing',
        message: message.length > 500 ? `${message.slice(0, 497)}…` : message,
        relatedEntity: 'DAILY_REPORT',
      });
    }
  }

  return result;
}

let timer: NodeJS.Timeout | null = null;

/** Checks every 5 minutes. Off in tests, or with REPORT_REMINDERS_DISABLED=true. */
export function startReportReminderScheduler(): void {
  if (timer || process.env.NODE_ENV === 'test' || process.env.REPORT_REMINDERS_DISABLED === 'true') return;
  const tick = () => {
    runReportReminders().catch((err) => console.error('Report reminders failed:', err?.message || err));
  };
  setTimeout(tick, 30 * 1000).unref();
  timer = setInterval(tick, 5 * 60 * 1000);
  timer.unref();
}
