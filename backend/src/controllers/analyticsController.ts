/**
 * MD analytics: every figure is aggregated from stored reports and expenses
 * for the caller's own projects. Nothing is synthesised; empty ranges return
 * empty series so the UI can show empty states.
 */
import { Response } from 'express';
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { Expense } from '../models/Expense.js';
import { DailyReport } from '../models/DailyReport.js';
import { AuthenticatedRequest } from '../types/index.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { getAccessibleProjectIds } from '../services/tenantService.js';
import { parseDate } from '../utils/validation.js';

type Granularity = 'day' | 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Kolkata';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Bucket key used by both Mongo ($dateToString) and the gap-filler below. */
function bucketExpression(field: string, granularity: Granularity) {
  if (granularity === 'month') {
    return { $dateToString: { format: '%Y-%m', date: `$${field}`, timezone: TIMEZONE } };
  }
  if (granularity === 'week') {
    // ISO week label e.g. 2026-W07
    return {
      $concat: [
        { $toString: { $isoWeekYear: { date: `$${field}`, timezone: TIMEZONE } } },
        '-W',
        {
          $cond: [
            { $lt: [{ $isoWeek: { date: `$${field}`, timezone: TIMEZONE } }, 10] },
            { $concat: ['0', { $toString: { $isoWeek: { date: `$${field}`, timezone: TIMEZONE } } }] },
            { $toString: { $isoWeek: { date: `$${field}`, timezone: TIMEZONE } } },
          ],
        },
      ],
    };
  }
  return { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: TIMEZONE } };
}

const tzFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date parts of `d` in the reporting timezone (matches Mongo's $dateToString timezone). */
function tzParts(d: Date): { y: number; m: number; day: number } {
  const [y, m, day] = tzFormatter.format(d).split('-').map(Number);
  return { y, m, day };
}

function isoWeekKey(d: Date): string {
  const { y, m, day } = tzParts(d);
  const date = new Date(Date.UTC(y, m - 1, day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Ordered list of bucket keys covering [start, end] so charts have no missing periods. */
function bucketKeys(start: Date, end: Date, granularity: Granularity): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS / 2) {
    const d = new Date(t);
    const { y, m, day } = tzParts(d);
    const key =
      granularity === 'month'
        ? `${y}-${String(m).padStart(2, '0')}`
        : granularity === 'week'
        ? isoWeekKey(d)
        : `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export async function getOwnerAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = req.user!;

    // ---- Filters -----------------------------------------------------------
    const now = new Date();
    const end = parseDate(req.query.endDate) || now;
    end.setHours(23, 59, 59, 999);
    const defaultStart = new Date(end.getTime() - 29 * DAY_MS);
    let start = parseDate(req.query.startDate) || defaultStart;
    start = startOfDay(start);
    if (start > end) start = startOfDay(defaultStart);
    // Cap at ~2 years to keep aggregations bounded
    if (end.getTime() - start.getTime() > 731 * DAY_MS) start = startOfDay(new Date(end.getTime() - 731 * DAY_MS));

    const rangeDays = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    const requested = String(req.query.granularity || '');
    const granularity: Granularity =
      requested === 'day' || requested === 'week' || requested === 'month'
        ? requested
        : rangeDays > 120
        ? 'month'
        : rangeDays > 45
        ? 'week'
        : 'day';

    let projectIds: mongoose.Types.ObjectId[];
    if (req.query.projectId) {
      const access = await verifyUserProjectAccess(String(req.query.projectId), user.userId, user.role);
      if (!access.allowed || !access.project) {
        res.status(404).json({ success: false, message: 'Project not found' });
        return;
      }
      projectIds = [access.project._id as mongoose.Types.ObjectId];
    } else {
      projectIds = await getAccessibleProjectIds(user);
    }

    const projects = await Project.find({ _id: { $in: projectIds } })
      .select('name code status budget startDate expectedCompletionDate')
      .sort({ name: 1 });
    const keys = bucketKeys(start, end, granularity);

    const reportMatch = {
      project: { $in: projectIds },
      status: 'SUBMITTED',
      workDate: { $gte: start, $lte: end },
    };
    const expenseMatch = {
      project: { $in: projectIds },
      status: { $in: ['PENDING', 'APPROVED'] },
      date: { $gte: start, $lte: end },
    };

    const [expenseSeriesRaw, expenseByProjectRaw, allTimeSpendRaw, labourSeriesRaw, labourCategoryRaw, reportStatsRaw, workItemRaw, progressRaw, latestProgressRaw, issuesRaw] =
      await Promise.all([
        // Expenditure over time (approved vs pending)
        Expense.aggregate([
          { $match: expenseMatch },
          { $group: { _id: { bucket: bucketExpression('date', granularity), status: '$status' }, total: { $sum: '$amount' } } },
        ]),
        // Expenditure in range per project
        Expense.aggregate([
          { $match: expenseMatch },
          { $group: { _id: { project: '$project', status: '$status' }, total: { $sum: '$amount' } } },
        ]),
        // Lifetime approved spend per project (budget vs actual is a lifetime comparison)
        Expense.aggregate([
          { $match: { project: { $in: projectIds }, status: { $in: ['PENDING', 'APPROVED'] } } },
          { $group: { _id: { project: '$project', status: '$status' }, total: { $sum: '$amount' } } },
        ]),
        // Labour headcount per period (sum of daily headcounts = labour-days)
        DailyReport.aggregate([
          { $match: reportMatch },
          {
            $group: {
              _id: bucketExpression('workDate', granularity),
              labourDays: { $sum: '$totalLabourCount' },
              reports: { $sum: 1 },
            },
          },
        ]),
        // Labour by category (skilled / unskilled / supervisor) and labour-hours
        DailyReport.aggregate([
          { $match: reportMatch },
          { $unwind: '$labourBreakdown' },
          {
            $group: {
              _id: { $ifNull: ['$labourBreakdown.category', 'UNCATEGORISED'] },
              count: { $sum: '$labourBreakdown.count' },
              hours: { $sum: { $multiply: ['$labourBreakdown.count', { $ifNull: ['$labourBreakdown.hours', 0] }] } },
            },
          },
        ]),
        // Reports + labour per project
        DailyReport.aggregate([
          { $match: reportMatch },
          {
            $group: {
              _id: '$project',
              reports: { $sum: 1 },
              labourDays: { $sum: '$totalLabourCount' },
              reportDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$workDate', timezone: TIMEZONE } } },
              lastReportAt: { $max: '$workDate' },
            },
          },
        ]),
        // Work items by completion status per period
        DailyReport.aggregate([
          { $match: reportMatch },
          { $unwind: '$workItems' },
          {
            $group: {
              _id: { bucket: bucketExpression('workDate', granularity), status: { $ifNull: ['$workItems.status', 'UNSPECIFIED'] } },
              count: { $sum: 1 },
            },
          },
        ]),
        // Reported site progress % over time, per project (max per bucket)
        DailyReport.aggregate([
          { $match: { ...reportMatch, overallProgressPercent: { $ne: null } } },
          {
            $group: {
              _id: { bucket: bucketExpression('workDate', granularity), project: '$project' },
              progress: { $max: '$overallProgressPercent' },
            },
          },
        ]),
        // Latest reported progress per project (all time)
        DailyReport.aggregate([
          { $match: { project: { $in: projectIds }, status: 'SUBMITTED', overallProgressPercent: { $ne: null } } },
          { $sort: { workDate: -1, createdAt: -1 } },
          { $group: { _id: '$project', progress: { $first: '$overallProgressPercent' }, at: { $first: '$workDate' } } },
        ]),
        // Reports flagging issues / delays in range
        DailyReport.aggregate([
          { $match: { ...reportMatch, issuesAndDelays: { $nin: [null, ''] } } },
          { $group: { _id: '$project', count: { $sum: 1 } } },
        ]),
      ]);

    // ---- Shape time series -------------------------------------------------
    const expenseMap = new Map<string, { approved: number; pending: number }>();
    expenseSeriesRaw.forEach((r: any) => {
      const row = expenseMap.get(r._id.bucket) || { approved: 0, pending: 0 };
      if (r._id.status === 'APPROVED') row.approved += r.total;
      else row.pending += r.total;
      expenseMap.set(r._id.bucket, row);
    });
    const expenditureSeries = keys.map((k) => ({ period: k, approvedPaise: expenseMap.get(k)?.approved || 0, pendingPaise: expenseMap.get(k)?.pending || 0 }));

    const labourMap = new Map(labourSeriesRaw.map((r: any) => [r._id, r]));
    const labourSeries = keys.map((k) => ({
      period: k,
      labourDays: (labourMap.get(k) as any)?.labourDays || 0,
      reports: (labourMap.get(k) as any)?.reports || 0,
    }));

    const workMap = new Map<string, Record<string, number>>();
    workItemRaw.forEach((r: any) => {
      const row = workMap.get(r._id.bucket) || {};
      row[r._id.status] = (row[r._id.status] || 0) + r.count;
      workMap.set(r._id.bucket, row);
    });
    const workCompletionSeries = keys.map((k) => {
      const row = workMap.get(k) || {};
      return {
        period: k,
        completed: row.COMPLETED || 0,
        inProgress: row.IN_PROGRESS || 0,
        notStarted: row.NOT_STARTED || 0,
        unspecified: row.UNSPECIFIED || 0,
      };
    });

    const projectName = new Map(projects.map((p) => [p._id.toString(), p.code || p.name]));
    const progressByBucket = new Map<string, Record<string, number>>();
    progressRaw.forEach((r: any) => {
      const row = progressByBucket.get(r._id.bucket) || {};
      row[r._id.project.toString()] = r.progress;
      progressByBucket.set(r._id.bucket, row);
    });
    const progressSeries = keys
      .filter((k) => progressByBucket.has(k))
      .map((k) => ({ period: k, values: progressByBucket.get(k)! }));

    // ---- Per-project comparison --------------------------------------------
    const sumBy = (raw: any[]) => {
      const m = new Map<string, { approved: number; pending: number }>();
      raw.forEach((r: any) => {
        const id = r._id.project.toString();
        const row = m.get(id) || { approved: 0, pending: 0 };
        if (r._id.status === 'APPROVED') row.approved += r.total;
        else row.pending += r.total;
        m.set(id, row);
      });
      return m;
    };
    const rangeSpend = sumBy(expenseByProjectRaw);
    const lifetimeSpend = sumBy(allTimeSpendRaw);
    const reportStats = new Map(reportStatsRaw.map((r: any) => [r._id.toString(), r]));
    const latestProgress = new Map(latestProgressRaw.map((r: any) => [r._id.toString(), r]));
    const issues = new Map(issuesRaw.map((r: any) => [r._id.toString(), r.count]));

    const today = startOfDay(now);
    const projectComparison = projects.map((p) => {
      const id = p._id.toString();
      const stats: any = reportStats.get(id);
      // Expected reporting days = days in range the project was active (bounded by start date and today)
      const activeFrom = p.startDate && p.startDate > start ? startOfDay(p.startDate) : start;
      const activeTo = end < today ? end : today;
      const expectedDays =
        p.status === 'IN_PROGRESS' && activeTo >= activeFrom
          ? Math.floor((startOfDay(activeTo).getTime() - activeFrom.getTime()) / DAY_MS) + 1
          : 0;
      const daysReported = stats?.reportDays?.length || 0;
      const lifetime = lifetimeSpend.get(id) || { approved: 0, pending: 0 };
      const budget = p.budget || 0;
      const lp: any = latestProgress.get(id);
      const plannedPercent =
        p.startDate && p.expectedCompletionDate && p.expectedCompletionDate > p.startDate
          ? Math.max(
              0,
              Math.min(
                100,
                Math.round(((now.getTime() - p.startDate.getTime()) / (p.expectedCompletionDate.getTime() - p.startDate.getTime())) * 100)
              )
            )
          : null;
      return {
        projectId: id,
        name: p.name,
        code: p.code,
        status: p.status,
        budgetPaise: budget,
        approvedLifetimePaise: lifetime.approved,
        pendingLifetimePaise: lifetime.pending,
        approvedInRangePaise: rangeSpend.get(id)?.approved || 0,
        pendingInRangePaise: rangeSpend.get(id)?.pending || 0,
        budgetUsedPercent: budget > 0 ? Math.round((lifetime.approved / budget) * 100) : null,
        reportsInRange: stats?.reports || 0,
        daysReported,
        expectedReportDays: expectedDays,
        reportingCompliancePercent: expectedDays > 0 ? Math.min(100, Math.round((daysReported / expectedDays) * 100)) : null,
        labourDays: stats?.labourDays || 0,
        avgDailyLabour: daysReported > 0 ? Math.round((stats?.labourDays || 0) / daysReported) : 0,
        lastReportDate: stats?.lastReportAt || null,
        latestProgressPercent: lp ? lp.progress : null,
        latestProgressDate: lp ? lp.at : null,
        plannedProgressPercent: plannedPercent,
        issueReports: issues.get(id) || 0,
      };
    });

    const labourByCategory = labourCategoryRaw
      .map((r: any) => ({ category: r._id, headcount: r.count, labourHours: r.hours }))
      .sort((a: any, b: any) => b.headcount - a.headcount);

    const totals = {
      approvedInRangePaise: expenditureSeries.reduce((s, r) => s + r.approvedPaise, 0),
      pendingInRangePaise: expenditureSeries.reduce((s, r) => s + r.pendingPaise, 0),
      labourDays: labourSeries.reduce((s, r) => s + r.labourDays, 0),
      reports: labourSeries.reduce((s, r) => s + r.reports, 0),
      workItemsCompleted: workCompletionSeries.reduce((s, r) => s + r.completed, 0),
      workItemsTotal: workCompletionSeries.reduce((s, r) => s + r.completed + r.inProgress + r.notStarted + r.unspecified, 0),
      issueReports: Array.from(issues.values()).reduce((s, n) => s + n, 0),
    };

    res.json({
      success: true,
      filters: { startDate: start, endDate: end, granularity, projectId: req.query.projectId || null, timezone: TIMEZONE },
      projects: projects.map((p) => ({ id: p._id, name: p.name, code: p.code, label: projectName.get(p._id.toString()) })),
      totals,
      expenditureSeries,
      labourSeries,
      labourByCategory,
      workCompletionSeries,
      progressSeries,
      projectComparison,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to compute analytics', error: error.message });
  }
}
