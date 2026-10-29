import { Response } from 'express';
import mongoose from 'mongoose';
import { DailyReport } from '../models/DailyReport.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { ReportView } from '../models/ReportView.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { AuthenticatedRequest, isMD, isSiteInCharge } from '../types/index.js';
import { logAudit } from '../services/auditService.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { emitToProject, emitToUser, broadcastReportViewed, broadcastReportCreated } from '../services/socketService.js';

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

    let accessibleProjectIds: mongoose.Types.ObjectId[] = [];

    if (isMD(user.role)) {
      const mdProjects = await Project.find({
        $or: [
          { createdBy: new mongoose.Types.ObjectId(user.userId) },
          { owner: new mongoose.Types.ObjectId(user.userId) },
          { createdBy: { $exists: false } },
        ],
      }).select('_id');
      accessibleProjectIds = mdProjects.map((p) => p._id as mongoose.Types.ObjectId);
    } else if (isSiteInCharge(user.role)) {
      const activeAssignments = await ProjectAssignment.find({
        siteInCharge: new mongoose.Types.ObjectId(user.userId),
        assignmentStatus: 'ACTIVE',
      }).select('project');

      const revokedAssignments = await ProjectAssignment.find({
        siteInCharge: new mongoose.Types.ObjectId(user.userId),
        assignmentStatus: 'REVOKED',
      }).select('project');

      const revokedSet = new Set(revokedAssignments.map((a) => a.project.toString()));
      const activeIds = activeAssignments
        .map((a) => a.project.toString())
        .filter((id) => !revokedSet.has(id));

      const legacyProjects = await Project.find({
        assignedInCharge: new mongoose.Types.ObjectId(user.userId),
        _id: { $nin: revokedAssignments.map((a) => a.project) },
      }).select('_id');

      legacyProjects.forEach((p) => activeIds.push(p._id.toString()));
      const uniqueIds = Array.from(new Set(activeIds));
      accessibleProjectIds = uniqueIds.map((id) => new mongoose.Types.ObjectId(id));
    }

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
      const searchStr = String(search).trim();
      query.$or = [
        { titleOfWork: { $regex: searchStr, $options: 'i' } },
        { workSummary: { $regex: searchStr, $options: 'i' } },
      ];
    }

    if (projectId) {
      const accessCheck = await verifyUserProjectAccess(String(projectId), user.userId, user.role);
      if (!accessCheck.allowed) {
        res.status(403).json({ success: false, message: 'Forbidden: You do not have access to this project.' });
        return;
      }
      query.project = new mongoose.Types.ObjectId(String(projectId));
    } else if (isSiteInCharge(user.role)) {
      const activeAssignments = await ProjectAssignment.find({
        siteInCharge: new mongoose.Types.ObjectId(user.userId),
        assignmentStatus: 'ACTIVE',
      }).select('project');

      const revokedAssignments = await ProjectAssignment.find({
        siteInCharge: new mongoose.Types.ObjectId(user.userId),
        assignmentStatus: 'REVOKED',
      }).select('project');

      const revokedSet = new Set(revokedAssignments.map((a) => a.project.toString()));
      const activeProjectIds = new Set<string>();

      activeAssignments.forEach((a) => {
        if (!revokedSet.has(a.project.toString())) {
          activeProjectIds.add(a.project.toString());
        }
      });

      const legacyProjects = await Project.find({
        assignedInCharge: new mongoose.Types.ObjectId(user.userId),
        _id: { $nin: revokedAssignments.map((a) => a.project) },
      }).select('_id');

      legacyProjects.forEach((p) => activeProjectIds.add(p._id.toString()));

      query.project = {
        $in: Array.from(activeProjectIds).map((id) => new mongoose.Types.ObjectId(id)),
      };
    } else if (isMD(user.role)) {
      const authorizedProjects = await Project.find({
        $or: [
          { createdBy: new mongoose.Types.ObjectId(user.userId) },
          { owner: new mongoose.Types.ObjectId(user.userId) },
          { createdBy: { $exists: false } },
        ],
      }).select('_id');
      query.project = { $in: authorizedProjects.map((p) => p._id) };
    }

    if (status) {
      query.status = status;
    } else if (isMD(user.role)) {
      if (!req.query.includeDrafts) {
        query.status = 'SUBMITTED';
      }
    }

    if (startDate || endDate) {
      query.workDate = {};
      if (startDate) query.workDate.$gte = new Date(String(startDate));
      if (endDate) {
        const end = new Date(String(endDate));
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
    res.json({ success: true, report: enrichedReport });
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

      // Instant real-time broadcast to all connected clients
      broadcastReportViewed({
        reportId: report._id.toString(),
        projectId,
        viewerId: req.user!.userId,
        viewerName: req.user!.name || 'Managing Director',
        viewedAt: now.toISOString(),
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

export async function createDailyReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      project,
      titleOfWork,
      workDate,
      workSummary,
      workItems = [],
      labourBreakdown = [],
      equipmentDetails,
      issuesAndDelays,
      nextDayPlan,
      photos = [],
      status = 'SUBMITTED',
    } = req.body;

    const targetProjectId = project || req.body.projectId;

    const accessCheck = await verifyUserProjectAccess(targetProjectId, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden: You are not assigned to this project.' });
      return;
    }

    const sanitizedWorkItems = Array.isArray(workItems)
      ? workItems.map((item: any) => ({
          description: String(item.description || item.taskDescription || '').trim(),
          quantity: Math.max(0, Number(item.quantity) || 0),
          unit: String(item.unit || '').trim(),
          budget: Math.max(0, Number(item.budget || item.budgetINR) || 0),
        }))
      : [];

    const totalWorkBudget = sanitizedWorkItems.reduce(
      (sum: number, item: any) => sum + (Number(item.budget) || 0),
      0
    );

    const totalLabourCount = labourBreakdown.reduce(
      (sum: number, item: { count: number }) => sum + (Number(item.count) || 0),
      0
    );

    const report = await DailyReport.create({
      project: targetProjectId,
      submittedBy: req.user!.userId,
      titleOfWork: titleOfWork.trim(),
      workDate: new Date(workDate),
      workSummary: workSummary.trim(),
      workItems: sanitizedWorkItems,
      totalWorkBudget,
      labourBreakdown,
      totalLabourCount,
      equipmentDetails: equipmentDetails?.trim(),
      issuesAndDelays: issuesAndDelays?.trim(),
      nextDayPlan: nextDayPlan?.trim(),
      photos,
      status,
      version: 1,
    });

    await logAudit('DAILY_REPORT_CREATED', req.user!.userId, 'DAILY_REPORT', report._id, {
      titleOfWork: report.titleOfWork,
      project: report.project,
      status: report.status,
    });

    if (report.status === 'SUBMITTED') {
      broadcastReportCreated({
        reportId: report._id.toString(),
        projectId: report.project.toString(),
        submittedBy: req.user!.userId,
        titleOfWork: report.titleOfWork,
      });

      // Find project details to include in notification title and message
      try {
        const targetProjId = report.project.toString();
        const projectDoc = await Project.findById(targetProjId).select('name code createdBy owner');
        const projectName = projectDoc?.name || 'Construction Project';
        const projectCode = projectDoc?.code || '';

        // 1. Notify authorized MDs/Owners
        const mdRecipients = await User.find({
          role: { $in: ['MD', 'OWNER'] },
          isActive: true,
          $or: [
            { _id: projectDoc?.createdBy },
            { _id: projectDoc?.owner },
            ...(projectDoc?.createdBy ? [] : [{}]),
          ],
        });
        const targets = mdRecipients.length > 0 ? mdRecipients : await User.find({ role: { $in: ['MD', 'OWNER'] }, isActive: true });

        for (const md of targets) {
          if (md._id.toString() !== req.user!.userId) {
            const notif = await Notification.create({
              recipient: md._id,
              sender: req.user!.userId,
              project: targetProjId,
              type: 'DAILY_REPORT_SUBMITTED',
              title: `New Daily Report: ${report.titleOfWork || 'Site Progress Log'}`,
              message: `${req.user!.name || 'Site In-Charge'} submitted a new daily report for ${projectName} (${projectCode}): "${report.titleOfWork}".`,
              relatedEntity: 'DAILY_REPORT',
              relatedId: report._id.toString(),
              isRead: false,
            });
            emitToUser(md._id.toString(), 'notification:new', notif);
          }
        }

        // 2. Site In-Charge confirmation notification
        const inChargeNotif = await Notification.create({
          recipient: req.user!.userId,
          sender: req.user!.userId,
          project: targetProjId,
          type: 'DAILY_REPORT_SUBMITTED',
          title: 'Report Submitted Successfully',
          message: `Your daily report "${report.titleOfWork || 'Daily Work Log'}" for ${projectName} was successfully submitted.`,
          relatedEntity: 'DAILY_REPORT',
          relatedId: report._id.toString(),
          isRead: false,
        });
        emitToUser(req.user!.userId, 'notification:new', inChargeNotif);
      } catch (notifDispatchErr) {
        console.error('Failed to dispatch report creation notifications:', notifDispatchErr);
      }
    }

    res.status(201).json({ success: true, message: 'Daily report created successfully', report });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to create daily report', error: error.message });
  }
}

export async function updateDailyReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
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

    const {
      titleOfWork,
      workDate,
      workSummary,
      workItems,
      labourBreakdown,
      equipmentDetails,
      issuesAndDelays,
      nextDayPlan,
      photos,
      status,
    } = req.body;

    if (titleOfWork) report.titleOfWork = titleOfWork.trim();
    if (workDate) report.workDate = new Date(workDate);
    if (workSummary) report.workSummary = workSummary.trim();
    if (workItems !== undefined) {
      const sanitizedWorkItems = Array.isArray(workItems)
        ? workItems.map((item: any) => ({
            description: String(item.description || '').trim(),
            quantity: Math.max(0, Number(item.quantity) || 0),
            unit: String(item.unit || '').trim(),
            budget: Math.max(0, Number(item.budget) || 0),
          }))
        : [];
      report.workItems = sanitizedWorkItems;
      report.totalWorkBudget = sanitizedWorkItems.reduce(
        (sum: number, item: any) => sum + (Number(item.budget) || 0),
        0
      );
    }
    if (labourBreakdown) {
      report.labourBreakdown = labourBreakdown;
      report.totalLabourCount = labourBreakdown.reduce(
        (sum: number, item: { count: number }) => sum + (Number(item.count) || 0),
        0
      );
    }
    if (equipmentDetails !== undefined) report.equipmentDetails = equipmentDetails?.trim();
    if (issuesAndDelays !== undefined) report.issuesAndDelays = issuesAndDelays?.trim();
    if (nextDayPlan !== undefined) report.nextDayPlan = nextDayPlan?.trim();
    if (photos) report.photos = photos;
    if (status) report.status = status;

    report.version = (report.version || 1) + 1;
    report.lastEditedBy = new mongoose.Types.ObjectId(req.user!.userId);

    await report.save();

    await logAudit('DAILY_REPORT_UPDATED', req.user!.userId, 'DAILY_REPORT', report._id, {
      status: report.status,
      titleOfWork: report.titleOfWork,
      originalAuthor: report.submittedBy,
      editorRole: req.user!.role,
    });

    if (report.status === 'SUBMITTED') {
      broadcastReportCreated({
        reportId: report._id.toString(),
        projectId: report.project.toString(),
        submittedBy: req.user!.userId,
        titleOfWork: report.titleOfWork,
      });

      // Find project details to include in notification title and message
      try {
        const targetProjId = report.project.toString();
        const projectDoc = await Project.findById(targetProjId).select('name code createdBy owner');
        const projectName = projectDoc?.name || 'Construction Project';
        const projectCode = projectDoc?.code || '';

        // 1. Notify authorized MDs/Owners
        const mdRecipients = await User.find({
          role: { $in: ['MD', 'OWNER'] },
          isActive: true,
          $or: [
            { _id: projectDoc?.createdBy },
            { _id: projectDoc?.owner },
            ...(projectDoc?.createdBy ? [] : [{}]),
          ],
        });
        const targets = mdRecipients.length > 0 ? mdRecipients : await User.find({ role: { $in: ['MD', 'OWNER'] }, isActive: true });

        for (const md of targets) {
          if (md._id.toString() !== req.user!.userId) {
            const notif = await Notification.create({
              recipient: md._id,
              sender: req.user!.userId,
              project: targetProjId,
              type: 'DAILY_REPORT_SUBMITTED',
              title: `Daily Report Updated: ${report.titleOfWork || 'Site Progress Log'}`,
              message: `${req.user!.name || 'Site In-Charge'} updated the daily report for ${projectName} (${projectCode}): "${report.titleOfWork}".`,
              relatedEntity: 'DAILY_REPORT',
              relatedId: report._id.toString(),
              isRead: false,
            });
            emitToUser(md._id.toString(), 'notification:new', notif);
          }
        }

        // 2. Site In-Charge confirmation notification
        const inChargeNotif = await Notification.create({
          recipient: req.user!.userId,
          sender: req.user!.userId,
          project: targetProjId,
          type: 'DAILY_REPORT_SUBMITTED',
          title: 'Report Updated Successfully',
          message: `Your changes to daily report "${report.titleOfWork || 'Daily Work Log'}" for ${projectName} were saved.`,
          relatedEntity: 'DAILY_REPORT',
          relatedId: report._id.toString(),
          isRead: false,
        });
        emitToUser(req.user!.userId, 'notification:new', inChargeNotif);
      } catch (notifDispatchErr) {
        console.error('Failed to dispatch report update notifications:', notifDispatchErr);
      }
    }

    res.json({ success: true, message: 'Daily report updated successfully', report });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to update daily report', error: error.message });
  }
}

export async function getMissingReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const activeProjects = await Project.find({ status: 'IN_PROGRESS' }).populate('assignedInCharge', 'name phone');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const missingRecords: Array<{
      project: any;
      date: string;
      daysAgo: number;
    }> = [];

    for (const project of activeProjects) {
      for (let i = 1; i <= 7; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() - i);
        checkDate.setHours(0, 0, 0, 0);

        if (project.startDate && checkDate < project.startDate) continue;

        const exists = await DailyReport.exists({
          project: project._id,
          workDate: checkDate,
          status: 'SUBMITTED',
        });

        if (!exists) {
          missingRecords.push({
            project: {
              _id: project._id,
              name: project.name,
              code: project.code,
              assignedInCharge: project.assignedInCharge,
            },
            date: checkDate.toISOString().split('T')[0],
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

    if (!message || !message.trim()) {
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
