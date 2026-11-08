import { Response } from 'express';
import mongoose from 'mongoose';
import { DailyReport, IDailyReport } from '../models/DailyReport.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { ReportView } from '../models/ReportView.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { AuthenticatedRequest, isMD, isSiteInCharge } from '../types/index.js';
import { logAudit } from '../services/auditService.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { emitToProject, emitToUser, broadcastReportViewed, broadcastReportCreated } from '../services/socketService.js';
import { getAccessibleProjectIds, getProjectMDIds } from '../services/tenantService.js';
import {
  sanitizeReportInput,
  sanitizeReportExpenses,
  syncReportExpenses,
  promoteDraftExpenses,
  getReportExpenses,
} from '../services/reportService.js';
import { escapeRegex, parseDate } from '../utils/validation.js';

async function attachReadReceipts(reports: any[], callerRole?: string) {
  if (!reports || reports.length === 0) return [];

  // Role-specific enforcement: If caller is MD or OWNER, do not attach read receipt tracking to response
  if (callerRole && isMD(callerRole)) {
    return reports.map((r) => {
      const reportObj = r.toObject ? r.toObject() : { ...r };
      delete reportObj.readReceipt;
      return reportObj;
    });
  }

  const reportIds = reports.map((r) => r._id);
  const views = await ReportView.find({ report: { $in: reportIds } }).populate('viewer', 'name email role');

  const viewsByReportId = new Map<string, any[]>();
  views.forEach((v) => {
    const rId = v.report.toString();
    if (!viewsByReportId.has(rId)) viewsByReportId.set(rId, []);
    viewsByReportId.get(rId)!.push(v);
  });

  return reports.map((r) => {
    const reportObj = r.toObject ? r.toObject() : { ...r };
    const rViews = viewsByReportId.get(reportObj._id.toString()) || [];

    if (rViews.length === 0) {
      reportObj.readReceipt = {
        status: 'NOT_VIEWED',
        isCurrentRevisionSeen: false,
      };
      return reportObj;
    }

    rViews.sort((a, b) => new Date(b.lastViewedAt).getTime() - new Date(a.lastViewedAt).getTime());
    const latestView = rViews[0];

    const currentVersion = reportObj.version || 1;
    const viewedVersion = latestView.reportVersion || 1;
    const reportUpdatedTime = new Date(reportObj.updatedAt).getTime();
    const lastViewedTime = new Date(latestView.lastViewedAt).getTime();

    // If report was edited to a newer version or edited after the last recorded MD view (with 3-second grace)
    const isNewRevision = currentVersion > viewedVersion || (reportUpdatedTime - lastViewedTime > 3000);

    reportObj.readReceipt = {
      status: isNewRevision ? 'REVISION_NOT_VIEWED' : 'SEEN_BY_MD',
      lastViewedAt: latestView.lastViewedAt,
      lastViewedByName: latestView.viewer?.name || 'Managing Director',
      lastViewedById: latestView.viewer?._id,
      isCurrentRevisionSeen: !isNewRevision,
      reportVersion: currentVersion,
      viewedVersion: viewedVersion,
      viewedBy: rViews.map((v) => ({
        viewerId: v.viewer?._id,
        viewerName: v.viewer?.name,
        viewerRole: v.viewerRole,
        reportVersion: v.reportVersion || 1,
        firstViewedAt: v.firstViewedAt,
        lastViewedAt: v.lastViewedAt,
      })),
    };

    return reportObj;
  });
}

export async function getUnreadReportsSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = req.user!;
    if (!user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const accessibleProjectIds = await getAccessibleProjectIds(user);

    if (accessibleProjectIds.length === 0) {
      res.json({
        success: true,
        totalUnread: 0,
        unreadByProject: {},
        unreadReportIds: [],
      });
      return;
    }

    // Reports that are submitted and not authored by the requesting user
    const submittedReports = await DailyReport.find({
      project: { $in: accessibleProjectIds },
      status: 'SUBMITTED',
      submittedBy: { $ne: new mongoose.Types.ObjectId(user.userId) },
    }).select('_id project version updatedAt');

    if (submittedReports.length === 0) {
      const emptyUnreadByProject: Record<string, number> = {};
      accessibleProjectIds.forEach((pId) => {
        emptyUnreadByProject[pId.toString()] = 0;
      });
      res.json({
        success: true,
        totalUnread: 0,
        unreadByProject: emptyUnreadByProject,
        unreadReportIds: [],
      });
      return;
    }

    const reportIds = submittedReports.map((r) => r._id);

    // Fetch view records for this viewer
    const views = await ReportView.find({
      report: { $in: reportIds },
      viewer: new mongoose.Types.ObjectId(user.userId),
    });

    const viewsMap = new Map<string, any>();
    views.forEach((v) => {
      viewsMap.set(v.report.toString(), v);
    });

    const unreadByProject: Record<string, number> = {};
    accessibleProjectIds.forEach((pId) => {
      unreadByProject[pId.toString()] = 0;
    });

    const unreadReportIds: string[] = [];

    submittedReports.forEach((report) => {
      const rId = report._id.toString();
      const pId = report.project.toString();
      const view = viewsMap.get(rId);

      let isUnread = false;

      if (!view) {
        isUnread = true;
      } else {
        const currentVersion = report.version || 1;
        const viewedVersion = view.reportVersion || 1;
        const reportUpdatedTime = new Date(report.updatedAt).getTime();
        const lastViewedTime = new Date(view.lastViewedAt).getTime();

        if (currentVersion > viewedVersion || (reportUpdatedTime - lastViewedTime > 3000)) {
          isUnread = true;
        }
      }

      if (isUnread) {
        unreadReportIds.push(rId);
        unreadByProject[pId] = (unreadByProject[pId] || 0) + 1;
      }
    });

    res.json({
      success: true,
      totalUnread: unreadReportIds.length,
      unreadByProject,
      unreadReportIds,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch unread reports summary', error: error.message });
  }
}

export async function listDailyReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = req.user!;
    const { projectId, startDate, endDate, status, search } = req.query;

    let query: any = {};

    if (search) {
      const searchStr = escapeRegex(String(search).trim());
      query.$or = [
        { titleOfWork: { $regex: searchStr, $options: 'i' } },
        { workSummary: { $regex: searchStr, $options: 'i' } },
        { workLocation: { $regex: searchStr, $options: 'i' } },
      ];
    }

    if (projectId) {
      const accessCheck = await verifyUserProjectAccess(String(projectId), user.userId, user.role);
      if (!accessCheck.allowed || !accessCheck.project) {
        res.status(403).json({ success: false, message: 'Forbidden: You do not have access to this project.' });
        return;
      }
      query.project = accessCheck.project._id;
    } else {
      query.project = { $in: await getAccessibleProjectIds(user) };
    }

    if (status === 'DRAFT' || status === 'SUBMITTED') {
      query.status = status;
    } else if (isMD(user.role) && !req.query.includeDrafts) {
      query.status = 'SUBMITTED';
    }

    // Drafts are private to their author: MDs never see other people's drafts,
    // In-Charges never see a colleague's drafts.
    if (query.status !== 'SUBMITTED') {
      query.$and = [{ $or: [{ status: 'SUBMITTED' }, { submittedBy: new mongoose.Types.ObjectId(user.userId) }] }];
    }

    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (start || end) {
      query.workDate = {};
      if (start) query.workDate.$gte = start;
      if (end) {
        end.setHours(23, 59, 59, 999);
        query.workDate.$lte = end;
      }
    }

    const reports = await DailyReport.find(query)
      .populate('project', 'name code location')
      .populate('submittedBy', 'name email role')
      .populate('lastEditedBy', 'name email role')
      .sort({ workDate: -1, createdAt: -1 });

    const enrichedReports = await attachReadReceipts(reports, user.role);

    res.json({ success: true, count: enrichedReports.length, reports: enrichedReports });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to list daily reports', error: error.message });
  }
}

export async function getDailyReportById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      res.status(404).json({ success: false, message: 'Daily report not found' });
      return;
    }
    const report = await DailyReport.findById(id)
      .populate('project', 'name code location budget assignedInCharge')
      .populate('submittedBy', 'name email role')
      .populate('lastEditedBy', 'name email role');

    if (!report) {
      res.status(404).json({ success: false, message: 'Daily report not found' });
      return;
    }

    const projectId = String((report.project as any)?._id || report.project);
    const accessCheck = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to this report.' });
      return;
    }

    const authorIdStr = String((report.submittedBy as any)?._id || report.submittedBy);
    if (report.status === 'DRAFT' && authorIdStr !== req.user!.userId) {
      res.status(404).json({ success: false, message: 'Daily report not found' });
      return;
    }

    // Record view if authenticated user is MD
    if (isMD(req.user!.role)) {
      const now = new Date();
      const currentVersion = report.version || 1;

      await ReportView.findOneAndUpdate(
        { report: report._id, viewer: req.user!.userId },
        {
          project: projectId,
          viewerRole: 'MD',
          lastViewedAt: now,
          reportVersion: currentVersion,
          reportUpdatedAtSnapshot: report.updatedAt,
          $setOnInsert: { firstViewedAt: now },
        },
        { upsert: true, new: true }
      );

      // Instant real-time broadcast so In-Charge receives updated Seen status immediately
      broadcastReportViewed({
        reportId: report._id.toString(),
        projectId,
        viewerId: req.user!.userId,
        viewerName: req.user!.name || 'Managing Director',
        viewedAt: now.toISOString(),
        authorId: authorIdStr,
      });

      // Mark MD's own notifications for this report as read
      await Notification.updateMany(
        {
          recipient: req.user!.userId,
          relatedEntity: 'DAILY_REPORT',
          relatedId: report._id.toString(),
          isRead: false,
        },
        { isRead: true }
      );

      // Send In-App notification to the In-Charge who submitted this report (debounced)
      if (report.submittedBy) {
        const authorId = String((report.submittedBy as any)._id || report.submittedBy);
        if (authorId !== req.user!.userId) {
          try {
            const twoMinutesAgo = new Date(Date.now() - 120000);
            const recentNotif = await Notification.findOne({
              recipient: authorId,
              relatedEntity: 'DAILY_REPORT',
              relatedId: report._id.toString(),
              type: 'DAILY_REPORT_VIEWED',
              createdAt: { $gte: twoMinutesAgo },
            });

            if (!recentNotif) {
              const notif = await Notification.create({
                recipient: authorId,
                sender: req.user!.userId,
                project: projectId,
                type: 'DAILY_REPORT_VIEWED',
                title: 'Daily Report Viewed by MD',
                message: `${req.user!.name || 'Managing Director'} viewed your daily report "${report.titleOfWork || 'Daily Work Log'}".`,
                relatedEntity: 'DAILY_REPORT',
                relatedId: report._id.toString(),
                isRead: false,
              });
              emitToUser(authorId, 'notification:new', notif);
            }
          } catch (notifErr) {
            console.error('Failed to create report view notification:', notifErr);
          }
        }
      }
    }

    const [enrichedReport] = await attachReadReceipts([report], req.user!.role);
    const expenses = await getReportExpenses(report._id as mongoose.Types.ObjectId);
    res.json({ success: true, report: { ...enrichedReport, expenses } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch daily report', error: error.message });
  }
}

export async function recordDailyReportView(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const report = await DailyReport.findById(id).populate('project', 'name code');
    if (!report) {
      res.status(404).json({ success: false, message: 'Daily report not found' });
      return;
    }

    const projectId = String((report.project as any)?._id || report.project);
    const accessCheck = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden.' });
      return;
    }

    if (isMD(req.user!.role)) {
      const now = new Date();
      const currentVersion = report.version || 1;

      await ReportView.findOneAndUpdate(
        { report: report._id, viewer: req.user!.userId },
        {
          project: projectId,
          viewerRole: 'MD',
          lastViewedAt: now,
          reportVersion: currentVersion,
          reportUpdatedAtSnapshot: report.updatedAt,
          $setOnInsert: { firstViewedAt: now },
        },
        { upsert: true, new: true }
      );

      await logAudit('DAILY_REPORT_VIEWED', req.user!.userId, 'REPORT_VIEW', report._id, {
        reportId: report._id,
        projectId,
      });

      // Real-time update to the project room and the author
      broadcastReportViewed({
        reportId: report._id.toString(),
        projectId,
        viewerId: req.user!.userId,
        viewerName: req.user!.name || 'Managing Director',
        viewedAt: now.toISOString(),
        authorId: String(report.submittedBy),
      });

      // Mark MD's own notifications for this report as read
      await Notification.updateMany(
        {
          recipient: req.user!.userId,
          relatedEntity: 'DAILY_REPORT',
          relatedId: report._id.toString(),
          isRead: false,
        },
        { isRead: true }
      );

      // Send In-App notification to the In-Charge who submitted this report (debounced)
      if (report.submittedBy) {
        const authorId = String((report.submittedBy as any)._id || report.submittedBy);
        if (authorId !== req.user!.userId) {
          try {
            const twoMinutesAgo = new Date(Date.now() - 120000);
            const recentNotif = await Notification.findOne({
              recipient: authorId,
              relatedEntity: 'DAILY_REPORT',
              relatedId: report._id.toString(),
              type: 'DAILY_REPORT_VIEWED',
              createdAt: { $gte: twoMinutesAgo },
            });

            if (!recentNotif) {
              const notif = await Notification.create({
                recipient: authorId,
                sender: req.user!.userId,
                project: projectId,
                type: 'DAILY_REPORT_VIEWED',
                title: 'Daily Report Viewed by MD',
                message: `${req.user!.name || 'Managing Director'} viewed your daily report "${report.titleOfWork || 'Daily Work Log'}".`,
                relatedEntity: 'DAILY_REPORT',
                relatedId: report._id.toString(),
                isRead: false,
              });
              emitToUser(authorId, 'notification:new', notif);
            }
          } catch (notifErr) {
            console.error('Failed to create report view notification:', notifErr);
          }
        }
      }
    }

    const [enrichedReport] = await attachReadReceipts([report], req.user!.role);
    res.json({ success: true, message: 'Report view recorded', readReceipt: enrichedReport?.readReceipt });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to record report view', error: error.message });
  }
}

/** Notify the project's MDs (and confirm to the author) that a report was submitted or updated. */
async function dispatchReportNotifications(
  report: IDailyReport,
  actor: { userId: string; name?: string },
  kind: 'SUBMITTED' | 'UPDATED'
): Promise<void> {
  try {
    const targetProjId = report.project.toString();
    const projectDoc = await Project.findById(targetProjId).select('name code createdBy owner');
    const projectName = projectDoc?.name || 'Construction Project';
    const projectCode = projectDoc?.code || '';

    // Only this project's MD/Owner(s) — never every MD in the system
    const mdIds = await getProjectMDIds(targetProjId);
    const mdRecipients = await User.find({ _id: { $in: mdIds }, role: { $in: ['MD', 'OWNER'] }, isActive: true });

    for (const md of mdRecipients) {
      if (md._id.toString() === actor.userId) continue;
      const notif = await Notification.create({
        recipient: md._id,
        sender: actor.userId,
        project: targetProjId,
        type: 'DAILY_REPORT_SUBMITTED',
        title:
          kind === 'SUBMITTED'
            ? `New Daily Report: ${report.titleOfWork || 'Site Progress Log'}`
            : `Daily Report Updated: ${report.titleOfWork || 'Site Progress Log'}`,
        message:
          kind === 'SUBMITTED'
            ? `${actor.name || 'Site In-Charge'} submitted a new daily report for ${projectName} (${projectCode}): "${report.titleOfWork}".`
            : `${actor.name || 'Site In-Charge'} updated the daily report for ${projectName} (${projectCode}): "${report.titleOfWork}".`,
        relatedEntity: 'DAILY_REPORT',
        relatedId: report._id.toString(),
        isRead: false,
      });
      emitToUser(md._id.toString(), 'notification:new', notif);
    }

    const inChargeNotif = await Notification.create({
      recipient: actor.userId,
      sender: actor.userId,
      project: targetProjId,
      type: 'DAILY_REPORT_SUBMITTED',
      title: kind === 'SUBMITTED' ? 'Report Submitted Successfully' : 'Report Updated Successfully',
      message:
        kind === 'SUBMITTED'
          ? `Your daily report "${report.titleOfWork || 'Daily Work Log'}" for ${projectName} was successfully submitted.`
          : `Your changes to daily report "${report.titleOfWork || 'Daily Work Log'}" for ${projectName} were saved.`,
      relatedEntity: 'DAILY_REPORT',
      relatedId: report._id.toString(),
      isRead: false,
    });
    emitToUser(actor.userId, 'notification:new', inChargeNotif);
  } catch (notifDispatchErr) {
    console.error('Failed to dispatch report notifications:', notifDispatchErr);
  }
}

export async function createDailyReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const status: 'DRAFT' | 'SUBMITTED' = req.body.status === 'DRAFT' ? 'DRAFT' : 'SUBMITTED';
    const targetProjectId = req.body.project || req.body.projectId;
    const clientRequestId =
      typeof req.body.clientRequestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(req.body.clientRequestId)
        ? req.body.clientRequestId
        : undefined;

    if (!targetProjectId) {
      res.status(400).json({ success: false, message: 'Please select a project' });
      return;
    }

    const accessCheck = await verifyUserProjectAccess(String(targetProjectId), req.user!.userId, req.user!.role);
    if (!accessCheck.allowed || !accessCheck.project) {
      res.status(403).json({ success: false, message: 'Forbidden: You are not assigned to this project.' });
      return;
    }

    // Idempotent retry / double-tap: return the report already created for this request
    if (clientRequestId) {
      const existing = await DailyReport.findOne({ submittedBy: req.user!.userId, clientRequestId });
      if (existing) {
        res.status(200).json({ success: true, duplicate: true, message: 'This report was already saved.', report: existing });
        return;
      }
    }

    const { data, errors } = sanitizeReportInput(req.body, { partial: false });
    const { expenses, errors: expenseErrors } = sanitizeReportExpenses(req.body.expenses);
    const allErrors = [...errors, ...expenseErrors];
    if (allErrors.length) {
      res.status(400).json({ success: false, message: allErrors[0], errors: allErrors });
      return;
    }

    // Guard against accidental duplicate submissions (same author, project, date and title)
    if (status === 'SUBMITTED') {
      const dayStart = new Date(data.workDate!);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const dup = await DailyReport.findOne({
        project: accessCheck.project._id,
        submittedBy: req.user!.userId,
        status: 'SUBMITTED',
        titleOfWork: data.titleOfWork,
        workDate: { $gte: dayStart, $lt: dayEnd },
      }).select('_id');
      if (dup) {
        res.status(409).json({
          success: false,
          message: 'You already submitted a report with this title for this date. Open it to edit instead.',
          existingReportId: dup._id,
        });
        return;
      }
    }

    const report = await DailyReport.create({
      ...data,
      project: accessCheck.project._id,
      submittedBy: req.user!.userId,
      status,
      version: 1,
      submittedAt: status === 'SUBMITTED' ? new Date() : undefined,
      clientRequestId,
    });

    if (expenses.length) await syncReportExpenses(report, expenses, req.user!.userId);

    await logAudit('DAILY_REPORT_CREATED', req.user!.userId, 'DAILY_REPORT', report._id, {
      titleOfWork: report.titleOfWork,
      project: report.project,
      status: report.status,
      workItems: report.workItems.length,
      expenses: expenses.length,
    });

    if (report.status === 'SUBMITTED') {
      broadcastReportCreated({
        reportId: report._id.toString(),
        projectId: report.project.toString(),
        submittedBy: req.user!.userId,
        titleOfWork: report.titleOfWork,
      });
      await dispatchReportNotifications(report, req.user!, 'SUBMITTED');
    }

    res.status(201).json({ success: true, message: 'Daily report created successfully', report });
  } catch (error: any) {
    if (error?.code === 11000 && req.body.clientRequestId) {
      const existing = await DailyReport.findOne({ submittedBy: req.user!.userId, clientRequestId: req.body.clientRequestId });
      if (existing) {
        res.status(200).json({ success: true, duplicate: true, message: 'This report was already saved.', report: existing });
        return;
      }
    }
    if (error?.name === 'ValidationError') {
      res.status(400).json({ success: false, message: 'Some report fields are invalid. Please review and try again.', error });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create daily report', error: error.message });
  }
}

export async function updateDailyReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      res.status(404).json({ success: false, message: 'Daily report not found' });
      return;
    }
    const report = await DailyReport.findById(id);

    if (!report) {
      res.status(404).json({ success: false, message: 'Daily report not found' });
      return;
    }

    const accessCheck = await verifyUserProjectAccess(report.project.toString(), req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden: You are not assigned to this project.' });
      return;
    }

    // In-Charges may only edit their own reports; MDs can correct any report in their projects.
    const isAuthor = report.submittedBy.toString() === req.user!.userId;
    if (!isAuthor && !isMD(req.user!.role)) {
      res.status(403).json({ success: false, message: 'Only the In-Charge who created this report can edit it.' });
      return;
    }

    const requestedStatus = req.body.status;
    if (requestedStatus !== undefined && requestedStatus !== 'DRAFT' && requestedStatus !== 'SUBMITTED') {
      res.status(400).json({ success: false, message: 'Invalid report status' });
      return;
    }
    if (report.status === 'SUBMITTED' && requestedStatus === 'DRAFT') {
      res.status(400).json({ success: false, message: 'A submitted report cannot be moved back to draft.' });
      return;
    }

    const { data, errors } = sanitizeReportInput(req.body, { partial: true });
    const expenseInput = req.body.expenses !== undefined ? sanitizeReportExpenses(req.body.expenses) : null;
    const allErrors = [...errors, ...(expenseInput?.errors || [])];
    if (allErrors.length) {
      res.status(400).json({ success: false, message: allErrors[0], errors: allErrors });
      return;
    }

    const wasDraft = report.status === 'DRAFT';
    Object.assign(report, data);
    if (requestedStatus) report.status = requestedStatus;
    const becameSubmitted = wasDraft && report.status === 'SUBMITTED';
    if (report.status === 'SUBMITTED' && !String(report.workSummary || '').trim()) {
      res.status(400).json({ success: false, message: 'Detailed work description is required before submitting.' });
      return;
    }
    if (becameSubmitted) report.submittedAt = new Date();

    report.version = (report.version || 1) + 1;
    report.lastEditedBy = new mongoose.Types.ObjectId(req.user!.userId);

    await report.save();

    if (expenseInput) {
      // Sync against the pre-submission state so draft rows are edited, then promoted
      const syncTarget = becameSubmitted ? Object.assign(report, { status: 'DRAFT' }) : report;
      await syncReportExpenses(syncTarget, expenseInput.expenses, report.submittedBy.toString());
      if (becameSubmitted) report.status = 'SUBMITTED';
    }
    if (becameSubmitted) await promoteDraftExpenses(report);

    await logAudit('DAILY_REPORT_UPDATED', req.user!.userId, 'DAILY_REPORT', report._id, {
      status: report.status,
      titleOfWork: report.titleOfWork,
      originalAuthor: report.submittedBy,
      editorRole: req.user!.role,
      version: report.version,
    });

    if (report.status === 'SUBMITTED') {
      broadcastReportCreated({
        reportId: report._id.toString(),
        projectId: report.project.toString(),
        submittedBy: report.submittedBy.toString(),
        titleOfWork: report.titleOfWork,
      });
      await dispatchReportNotifications(report, req.user!, becameSubmitted ? 'SUBMITTED' : 'UPDATED');
    }

    res.json({ success: true, message: 'Daily report updated successfully', report });
  } catch (error: any) {
    if (error?.name === 'ValidationError') {
      res.status(400).json({ success: false, message: 'Some report fields are invalid. Please review and try again.', error });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to update daily report', error: error.message });
  }
}

export async function getMissingReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    // Company isolation: only projects the caller can access
    const accessibleIds = await getAccessibleProjectIds(req.user!);
    const activeProjects = await Project.find({ _id: { $in: accessibleIds }, status: 'IN_PROGRESS' }).populate(
      'assignedInCharge',
      'name phone'
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowStart = new Date(today);
    windowStart.setDate(today.getDate() - 7);

    // One query for all submitted reports in the window, grouped by project + calendar day
    const submitted = await DailyReport.find({
      project: { $in: activeProjects.map((p) => p._id) },
      status: 'SUBMITTED',
      workDate: { $gte: windowStart, $lt: today },
    }).select('project workDate');
    const submittedKeys = new Set(
      submitted.map((r) => {
        const d = new Date(r.workDate);
        d.setHours(0, 0, 0, 0);
        return `${r.project.toString()}|${d.getTime()}`;
      })
    );

    const missingRecords: Array<{ project: any; date: string; daysAgo: number }> = [];

    for (const project of activeProjects) {
      for (let i = 1; i <= 7; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() - i);

        if (project.startDate && checkDate < project.startDate) continue;
        if (!submittedKeys.has(`${project._id.toString()}|${checkDate.getTime()}`)) {
          missingRecords.push({
            project: {
              _id: project._id,
              name: project.name,
              code: project.code,
              assignedInCharge: project.assignedInCharge,
            },
            date: `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`,
            daysAgo: i,
          });
        }
      }
    }

    res.json({ success: true, count: missingRecords.length, missingReports: missingRecords });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to calculate missing reports', error: error.message });
  }
}

export async function addDailyReportComment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { message, type = 'COMMENT' } = req.body;

    if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
      res.status(400).json({ success: false, message: 'Comment message is required' });
      return;
    }

    const report = await DailyReport.findById(id);
    if (!report) {
      res.status(404).json({ success: false, message: 'Daily report not found' });
      return;
    }

    const projectId = String((report.project as any)?._id || report.project);
    const accessCheck = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to this report.' });
      return;
    }

    const comment = {
      author: new mongoose.Types.ObjectId(req.user!.userId),
      authorName: req.user!.name || (isMD(req.user!.role) ? 'Managing Director' : 'Site In-Charge'),
      authorRole: req.user!.role,
      message: message.trim(),
      type: ['COMMENT', 'CHANGES_REQUESTED', 'CORRECTION_REQUIRED'].includes(type) ? type : 'COMMENT',
      createdAt: new Date(),
    };

    if (!report.comments) {
      report.comments = [];
    }
    report.comments.push(comment as any);
    await report.save();

    await logAudit('DAILY_REPORT_COMMENT_ADDED', req.user!.userId, 'DAILY_REPORT', report._id, {
      reportId: report._id,
      projectId,
      commentType: comment.type,
    });

    // Notify the report submitter if MD commented or requested changes
    const authorId = String((report.submittedBy as any)._id || report.submittedBy);
    if (isMD(req.user!.role) && authorId && authorId !== req.user!.userId) {
      try {
        const notifTitle =
          comment.type === 'CHANGES_REQUESTED'
            ? 'Changes Requested on Daily Report'
            : comment.type === 'CORRECTION_REQUIRED'
            ? 'Correction Required on Daily Report'
            : 'MD Comment on Daily Report';

        const notif = await Notification.create({
          recipient: authorId,
          sender: req.user!.userId,
          project: projectId,
          type: comment.type === 'CHANGES_REQUESTED' ? 'DAILY_REPORT_CHANGES_REQUESTED' : 'DAILY_REPORT_COMMENT',
          title: notifTitle,
          message: `${req.user!.name || 'Managing Director'}: "${comment.message}" on "${report.titleOfWork || 'Daily Work Log'}".`,
          relatedEntity: 'DAILY_REPORT',
          relatedId: report._id.toString(),
          isRead: false,
        });
        emitToUser(authorId, 'notification:new', notif);
      } catch (notifErr) {
        console.error('Failed to notify In-Charge of comment:', notifErr);
      }
    }

    // Broadcast report update to project room so live clients see the comment
    emitToProject(projectId, 'daily-report:updated', {
      reportId: report._id.toString(),
      projectId,
    });

    res.json({
      success: true,
      message: 'Comment added successfully',
      comments: report.comments,
      comment,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to add comment', error: error.message });
  }
}
