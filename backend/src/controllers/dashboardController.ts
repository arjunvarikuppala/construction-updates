import { Response } from 'express';
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { Expense } from '../models/Expense.js';
import { DailyReport } from '../models/DailyReport.js';
import { AuditLog } from '../models/AuditLog.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { AuthenticatedRequest, isMD, isSiteInCharge } from '../types/index.js';

export async function getOwnerDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = req.user!;
    const { projectId, startDate, endDate } = req.query;

    let projectFilter: any = {};
    if (projectId) {
      projectFilter._id = new mongoose.Types.ObjectId(String(projectId));
    } else {
      projectFilter.$or = [
        { createdBy: new mongoose.Types.ObjectId(user.userId) },
        { owner: new mongoose.Types.ObjectId(user.userId) },
        { createdBy: { $exists: false } },
      ];
    }

    const projects = await Project.find(projectFilter)
      .populate('assignedInCharge', 'name email phone role')
      .sort({ updatedAt: -1 });

    // Filter project IDs
    const projectIds = projects.map((p) => p._id);

    // Count unassigned projects (either no assignedInCharge or no active ProjectAssignment)
    const activeAssignments = await ProjectAssignment.find({
      project: { $in: projectIds },
      assignmentStatus: 'ACTIVE',
    });
    const assignedProjectIdsSet = new Set(activeAssignments.map((a) => a.project.toString()));

    let unassignedProjectsCount = 0;
    projects.forEach((p) => {
      const hasDirectInCharge = !!p.assignedInCharge;
      const hasActiveAssign = assignedProjectIdsSet.has(p._id.toString());
      if (!hasDirectInCharge && !hasActiveAssign) {
        unassignedProjectsCount++;
      }
    });

    // Expense date filter
    let expenseMatch: any = { project: { $in: projectIds } };
    if (startDate || endDate) {
      expenseMatch.date = {};
      if (startDate) expenseMatch.date.$gte = new Date(String(startDate));
      if (endDate) {
        const end = new Date(String(endDate));
        end.setHours(23, 59, 59, 999);
        expenseMatch.date.$lte = end;
      }
    }

    // Expense aggregates by status
    const expenseStats = await Expense.aggregate([
      { $match: expenseMatch },
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    let approvedPaise = 0;
    let pendingPaise = 0;
    let rejectedPaise = 0;
    let approvedCount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;

    expenseStats.forEach((s) => {
      if (s._id === 'APPROVED') {
        approvedPaise = s.totalAmount;
        approvedCount = s.count;
      } else if (s._id === 'PENDING') {
        pendingPaise = s.totalAmount;
        pendingCount = s.count;
      } else if (s._id === 'REJECTED') {
        rejectedPaise = s.totalAmount;
        rejectedCount = s.count;
      }
    });

    const totalBudgetPaise = projects.reduce((sum, p) => sum + (p.budget || 0), 0);
    const remainingBudgetPaise = Math.max(0, totalBudgetPaise - approvedPaise);
    const activeProjectsCount = projects.filter((p) => p.status === 'IN_PROGRESS').length;

    // Category breakdown
    const categoryBreakdown = await Expense.aggregate([
      { $match: { ...expenseMatch, status: 'APPROVED' } },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    // Budget vs Expenditure per project
    const projectExpenditures = await Promise.all(
      projects.map(async (p) => {
        const pStats = await Expense.aggregate([
          { $match: { project: p._id } },
          {
            $group: {
              _id: '$status',
              totalAmount: { $sum: '$amount' },
              count: { $sum: 1 },
            },
          },
        ]);

        let pApproved = 0;
        let pPending = 0;
        let pRejected = 0;

        pStats.forEach((s) => {
          if (s._id === 'APPROVED') pApproved = s.totalAmount;
          if (s._id === 'PENDING') pPending = s.totalAmount;
          if (s._id === 'REJECTED') pRejected = s.totalAmount;
        });

        const budget = p.budget || 0;
        const burnRate = budget > 0 ? Math.round((pApproved / budget) * 100) : 0;
        const requiresAttention = burnRate >= 80 || pPending > 0;

        return {
          id: p._id,
          name: p.name,
          code: p.code,
          location: p.location,
          status: p.status,
          inCharge: (p.assignedInCharge as any)?.name || 'Unassigned',
          budget,
          approved: pApproved,
          pending: pPending,
          rejected: pRejected,
          remaining: Math.max(0, budget - pApproved),
          burnRate,
          requiresAttention,
        };
      })
    );

    // Expenditure trend
    const trendStats = await Expense.aggregate([
      { $match: { ...expenseMatch, status: { $in: ['APPROVED', 'PENDING'] } } },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' },
            status: '$status',
          },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trendMap = new Map<string, { label: string; approved: number; pending: number }>();

    trendStats.forEach((t) => {
      const key = `${t._id.year}-${t._id.month}`;
      const label = `${monthNames[t._id.month - 1]} ${t._id.year}`;
      if (!trendMap.has(key)) {
        trendMap.set(key, { label, approved: 0, pending: 0 });
      }
      const item = trendMap.get(key)!;
      if (t._id.status === 'APPROVED') item.approved += t.total;
      if (t._id.status === 'PENDING') item.pending += t.total;
    });

    const expenditureTrend = Array.from(trendMap.values());

    // Calculate reports submitted vs expected in the last 7 days
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    const submittedReportsCount = await DailyReport.countDocuments({
      project: { $in: projectIds },
      status: 'SUBMITTED',
      workDate: { $gte: sevenDaysAgo, $lte: new Date() },
    });

    const expectedReportsLast7Days = activeProjectsCount * 7;
    const missingReportsCount = Math.max(0, expectedReportsLast7Days - submittedReportsCount);

    // Recent 5 Daily Reports across authorized projects
    const recentReports = await DailyReport.find({ project: { $in: projectIds } })
      .populate('project', 'name code')
      .populate('submittedBy', 'name email')
      .sort({ workDate: -1, createdAt: -1 })
      .limit(5);

    // Recent 5 Expenses across authorized projects (immediately visible upon submission!)
    const recentExpenses = await Expense.find({ project: { $in: projectIds } })
      .populate('project', 'name code')
      .populate('submittedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(5);

    // Recently updated projects
    const recentlyUpdatedProjects = projects.slice(0, 5).map((p) => ({
      id: p._id,
      name: p.name,
      code: p.code,
      location: p.location,
      status: p.status,
      updatedAt: p.updatedAt,
      inCharge: (p.assignedInCharge as any)?.name || 'Unassigned',
      budget: p.budget,
    }));

    // Recent Audit Logs
    const recentActivity = await AuditLog.find()
      .populate('performedBy', 'name role')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      kpis: {
        activeProjectsCount,
        totalProjectsCount: projects.length,
        unassignedProjectsCount,
        totalBudgetPaise,
        approvedPaise,
        approvedCount,
        pendingPaise,
        pendingCount,
        rejectedPaise,
        rejectedCount,
        remainingBudgetPaise,
        budgetBurnPercentage: totalBudgetPaise > 0 ? Math.round((approvedPaise / totalBudgetPaise) * 100) : 0,
        submittedReportsLast7Days: submittedReportsCount,
        expectedReportsLast7Days,
        missingReportsCount,
      },
      categoryBreakdown: categoryBreakdown.map((c) => ({
        category: c._id,
        amount: c.totalAmount,
        count: c.count,
      })),
      projectExpenditures,
      expenditureTrend,
      recentlyUpdatedProjects,
      recentReports,
      recentExpenses,
      recentActivity,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch owner dashboard', error: error.message });
  }
}

export async function getInChargeDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = req.user!;

    // Find active assignments
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

    // Fallback: direct assignedInCharge if not explicitly revoked
    const legacyProjects = await Project.find({
      assignedInCharge: new mongoose.Types.ObjectId(user.userId),
      _id: { $nin: revokedAssignments.map((a) => a.project) },
    }).select('_id');

    legacyProjects.forEach((p) => activeProjectIds.add(p._id.toString()));

    const projects = await Project.find({
      _id: { $in: Array.from(activeProjectIds).map((id) => new mongoose.Types.ObjectId(id)) },
    }).sort({ updatedAt: -1 });

    if (projects.length === 0) {
      res.json({
        success: true,
        assignedProjects: [],
        unassigned: true,
        todayReportStatus: 'NO_PROJECT_ASSIGNED',
        message: 'No construction projects are currently assigned to your account. Your Managing Director must assign you to a project to begin logging reports and expenses.',
        recentReports: [],
        pendingExpenses: [],
        rejectedExpenses: [],
        approvedExpenses: [],
      });
      return;
    }

    const projectIds = projects.map((p) => p._id);

    // Check today's report
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const todayReport = await DailyReport.findOne({
      project: { $in: projectIds },
      workDate: { $gte: today, $lt: tomorrow },
    });

    // Recent reports
    const recentReports = await DailyReport.find({ project: { $in: projectIds } })
      .populate('project', 'name code')
      .sort({ workDate: -1 })
      .limit(5);

    // Expenses grouped by status (shared directly from MongoDB)
    const pendingExpenses = await Expense.find({ project: { $in: projectIds }, status: 'PENDING' })
      .populate('project', 'name code')
      .sort({ createdAt: -1 });

    const rejectedExpenses = await Expense.find({ project: { $in: projectIds }, status: 'REJECTED' })
      .populate('project', 'name code')
      .sort({ updatedAt: -1 });

    const approvedExpenses = await Expense.find({ project: { $in: projectIds }, status: 'APPROVED' })
      .populate('project', 'name code')
      .sort({ reviewedAt: -1 })
      .limit(10);

    // Project totals
    const projectFinancials = await Promise.all(
      projects.map(async (p) => {
        const stats = await Expense.aggregate([
          { $match: { project: p._id } },
          {
            $group: {
              _id: '$status',
              totalAmount: { $sum: '$amount' },
            },
          },
        ]);

        let approved = 0;
        let pending = 0;
        let rejected = 0;

        stats.forEach((s) => {
          if (s._id === 'APPROVED') approved = s.totalAmount;
          if (s._id === 'PENDING') pending = s.totalAmount;
          if (s._id === 'REJECTED') rejected = s.totalAmount;
        });

        const budget = p.budget || 0;

        return {
          id: p._id,
          name: p.name,
          code: p.code,
          location: p.location,
          budget,
          approved,
          pending,
          rejected,
          remaining: Math.max(0, budget - approved),
        };
      })
    );

    res.json({
      success: true,
      assignedProjects: projectFinancials,
      todayReportStatus: todayReport ? todayReport.status : 'NOT_SUBMITTED',
      todayReportId: todayReport ? todayReport._id : null,
      recentReports,
      pendingExpenses,
      rejectedExpenses,
      approvedExpenses,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch in-charge dashboard', error: error.message });
  }
}
