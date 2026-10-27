import { Response } from 'express';
import mongoose from 'mongoose';
import { DailyReport } from '../models/DailyReport.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { ReportView } from '../models/ReportView.js';
import { Notification } from '../models/Notification.js';
import { AuthenticatedRequest, isMD, isSiteInCharge } from '../types/index.js';
import { logAudit } from '../services/auditService.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { emitToProject, emitToUser, broadcastReportViewed } from '../services/socketService.js';

async function attachReadReceipts(reports: any[]) {
  if (!reports || reports.length === 0) return [];

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

    const reportUpdatedTime = new Date(reportObj.updatedAt).getTime();
    const lastViewedTime = new Date(latestView.lastViewedAt).getTime();

    // If report was edited after the last recorded MD view (with 3-second grace)
    const isNewRevision = reportUpdatedTime - lastViewedTime > 3000;

    reportObj.readReceipt = {
      status: isNewRevision ? 'REVISION_NOT_VIEWED' : 'SEEN_BY_MD',
      lastViewedAt: latestView.lastViewedAt,
      lastViewedByName: latestView.viewer?.name || 'Managing Director',
      lastViewedById: latestView.viewer?._id,
      isCurrentRevisionSeen: !isNewRevision,
      viewedBy: rViews.map((v) => ({
        viewerId: v.viewer?._id,
        viewerName: v.viewer?.name,
        firstViewedAt: v.firstViewedAt,
        lastViewedAt: v.lastViewedAt,
      })),
    };

    return reportObj;
  });
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

    const enrichedReports = await attachReadReceipts(reports);

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

    const accessCheck = await verifyUserProjectAccess((report.project as any)._id, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to this report.' });
      return;
    }

    // Record view if authenticated user is MD
    if (isMD(req.user!.role)) {
      const now = new Date();
      await ReportView.findOneAndUpdate(
        { report: report._id, viewer: req.user!.userId },
        {
          project: (report.project as any)._id,
          viewerRole: 'MD',
          lastViewedAt: now,
          reportUpdatedAtSnapshot: report.updatedAt,
          $setOnInsert: { firstViewedAt: now },
        },
        { upsert: true, new: true }
      );

      // Instant real-time broadcast so In-Charge receives updated Seen status immediately
      broadcastReportViewed({
        reportId: report._id.toString(),
        projectId: (report.project as any)._id.toString(),
        viewerId: req.user!.userId,
        viewerName: req.user!.name || 'Managing Director',
        viewedAt: now.toISOString(),
      });

      // Send In-App notification to the In-Charge who submitted this report
      if (report.submittedBy) {
        const authorId = String((report.submittedBy as any)._id || report.submittedBy);
        if (authorId !== req.user!.userId) {
          try {
            const notif = await Notification.create({
              recipient: authorId,
              sender: req.user!.userId,
              project: (report.project as any)._id,
              type: 'DAILY_REPORT_VIEWED',
              title: 'Daily Report Viewed by MD',
              message: `${req.user!.name || 'Managing Director'} viewed your daily report "${report.titleOfWork || 'Daily Work Log'}".`,
              relatedEntity: 'DAILY_REPORT',
              relatedId: report._id.toString(),
            });
            emitToUser(authorId, 'notification:new', notif);
          } catch (notifErr) {
            console.error('Failed to create report view notification:', notifErr);
          }
        }
      }
    }

    const [enrichedReport] = await attachReadReceipts([report]);
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

    const accessCheck = await verifyUserProjectAccess((report.project as any)._id, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden.' });
      return;
    }

    if (isMD(req.user!.role)) {
      const now = new Date();
      await ReportView.findOneAndUpdate(
        { report: report._id, viewer: req.user!.userId },
        {
          project: (report.project as any)._id,
          viewerRole: 'MD',
          lastViewedAt: now,
          reportUpdatedAtSnapshot: report.updatedAt,
          $setOnInsert: { firstViewedAt: now },
        },
        { upsert: true, new: true }
      );

      await logAudit('DAILY_REPORT_VIEWED', req.user!.userId, 'REPORT_VIEW', report._id, {
        reportId: report._id,
        projectId: (report.project as any)._id,
      });

      // Instant real-time broadcast to all connected clients
      broadcastReportViewed({
        reportId: report._id.toString(),
        projectId: (report.project as any)._id.toString(),
        viewerId: req.user!.userId,
        viewerName: req.user!.name || 'Managing Director',
        viewedAt: now.toISOString(),
      });

      // Send In-App notification to the In-Charge who submitted this report
      if (report.submittedBy) {
        const authorId = String((report.submittedBy as any)._id || report.submittedBy);
        if (authorId !== req.user!.userId) {
          try {
            const notif = await Notification.create({
              recipient: authorId,
              sender: req.user!.userId,
              project: (report.project as any)._id,
              type: 'DAILY_REPORT_VIEWED',
              title: 'Daily Report Viewed by MD',
              message: `${req.user!.name || 'Managing Director'} viewed your daily report "${report.titleOfWork || 'Daily Work Log'}".`,
              relatedEntity: 'DAILY_REPORT',
              relatedId: report._id.toString(),
            });
            emitToUser(authorId, 'notification:new', notif);
          } catch (notifErr) {
            console.error('Failed to create report view notification:', notifErr);
          }
        }
      }
    }

    const [enrichedReport] = await attachReadReceipts([report]);
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

    const accessCheck = await verifyUserProjectAccess(project, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden: You are not assigned to this project.' });
      return;
    }

    const totalLabourCount = labourBreakdown.reduce(
      (sum: number, item: { count: number }) => sum + (Number(item.count) || 0),
      0
    );

    const report = await DailyReport.create({
      project,
      submittedBy: req.user!.userId,
      titleOfWork: titleOfWork.trim(),
      workDate: new Date(workDate),
      workSummary: workSummary.trim(),
      workItems,
      labourBreakdown,
      totalLabourCount,
      equipmentDetails: equipmentDetails?.trim(),
      issuesAndDelays: issuesAndDelays?.trim(),
      nextDayPlan: nextDayPlan?.trim(),
      photos,
      status,
    });

    await logAudit('DAILY_REPORT_CREATED', req.user!.userId, 'DAILY_REPORT', report._id, {
      titleOfWork: report.titleOfWork,
      project: report.project,
      status: report.status,
    });

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
    if (workItems) report.workItems = workItems;
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

    report.lastEditedBy = new mongoose.Types.ObjectId(req.user!.userId);

    await report.save();

    await logAudit('DAILY_REPORT_UPDATED', req.user!.userId, 'DAILY_REPORT', report._id, {
      status: report.status,
      titleOfWork: report.titleOfWork,
      originalAuthor: report.submittedBy,
      editorRole: req.user!.role,
    });

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
