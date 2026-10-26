import { Response } from 'express';
import mongoose from 'mongoose';
import { Project } from '../models/Project.js';
import { User } from '../models/User.js';
import { Expense } from '../models/Expense.js';
import { DailyReport } from '../models/DailyReport.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { AuthenticatedRequest, isMD, isSiteInCharge } from '../types/index.js';
import { logAudit } from '../services/auditService.js';
import { rupeesToPaise } from '../utils/currency.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';

export async function listProjects(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = req.user!;
    let query: any = {};

    if (isSiteInCharge(user.role)) {
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

      // Legacy fallback
      const legacyProjects = await Project.find({
        assignedInCharge: new mongoose.Types.ObjectId(user.userId),
        _id: { $nin: revokedAssignments.map((a) => a.project) },
      }).select('_id');

      legacyProjects.forEach((p) => activeProjectIds.add(p._id.toString()));

      query._id = {
        $in: Array.from(activeProjectIds).map((id) => new mongoose.Types.ObjectId(id)),
      };
    } else if (isMD(user.role)) {
      // MD projects
      query.$or = [
        { createdBy: new mongoose.Types.ObjectId(user.userId) },
        { owner: new mongoose.Types.ObjectId(user.userId) },
        { createdBy: { $exists: false } },
      ];
    }

    if (req.query.status) {
      query.status = req.query.status;
    }

    if (req.query.search) {
      const searchStr = String(req.query.search).trim();
      const searchFilter = [
        { name: { $regex: searchStr, $options: 'i' } },
        { code: { $regex: searchStr, $options: 'i' } },
        { location: { $regex: searchStr, $options: 'i' } },
      ];
      if (query.$or) {
        query = {
          $and: [
            { $or: query.$or },
            { $or: searchFilter },
          ],
        };
      } else {
        query.$or = searchFilter;
      }
    }

    const projects = await Project.find(query)
      .populate('assignedInCharge', 'name email phone role')
      .sort({ updatedAt: -1, createdAt: -1 });

    // Aggregate summaries
    const projectSummaries = await Promise.all(
      projects.map(async (project) => {
        const stats = await Expense.aggregate([
          { $match: { project: project._id } },
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
        let pendingCount = 0;

        stats.forEach((s) => {
          if (s._id === 'APPROVED') approvedPaise = s.totalAmount;
          if (s._id === 'PENDING') {
            pendingPaise = s.totalAmount;
            pendingCount = s.count;
          }
          if (s._id === 'REJECTED') rejectedPaise = s.totalAmount;
        });

        const isCallerMD = isMD(user.role);
        const budget = isCallerMD ? (project.budget || 0) : undefined;
        const remainingPaise = isCallerMD ? Math.max(0, (project.budget || 0) - approvedPaise) : undefined;
        const burnPercentage = isCallerMD && (project.budget || 0) > 0 ? Math.round((approvedPaise / (project.budget || 1)) * 100) : undefined;
        const latestReport = await DailyReport.findOne({ project: project._id, status: 'SUBMITTED' })
          .sort({ workDate: -1 })
          .select('workDate');

        // Check if there is an active assignment
        const activeAssignment = await ProjectAssignment.findOne({
          project: project._id,
          assignmentStatus: 'ACTIVE',
        }).populate('siteInCharge', isCallerMD ? 'name email phone role salary salaryFrequency' : 'name email phone role');

        const assignedUser = project.assignedInCharge || activeAssignment?.siteInCharge;

        const projectObj = project.toObject();
        // Hide project budget from non-MD users
        if (!isCallerMD) {
          delete (projectObj as any).budget;
        }

        return {
          ...projectObj,
          assignedInCharge: assignedUser || null,
          hasInCharge: !!assignedUser,
          financials: isCallerMD ? {
            budget,
            approvedPaise,
            pendingPaise,
            rejectedPaise,
            pendingCount,
            remainingPaise,
            burnPercentage,
          } : undefined,
          latestReportDate: latestReport ? latestReport.workDate : null,
        };
      })
    );

    res.json({ success: true, count: projectSummaries.length, projects: projectSummaries });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to list projects', error: error.message });
  }
}

export async function getProjectById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const user = req.user!;

    const accessCheck = await verifyUserProjectAccess(id, user.userId, user.role);
    if (!accessCheck.allowed) {
      if (accessCheck.reason === 'NOT_FOUND' || accessCheck.reason === 'INVALID_ID') {
        res.status(404).json({ success: false, message: 'Project not found' });
        return;
      }
      res.status(403).json({ success: false, message: 'Access denied: You do not have permission for this project.' });
      return;
    }

    const isCallerMD = isMD(req.user!.role);
    const populateFields = isCallerMD
      ? 'name email phone role salary salaryFrequency'
      : 'name email phone role';

    const project = await Project.findById(id).populate('assignedInCharge', populateFields);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const stats = await Expense.aggregate([
      { $match: { project: project._id } },
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
    let pendingCount = 0;

    stats.forEach((s) => {
      if (s._id === 'APPROVED') approvedPaise = s.totalAmount;
      if (s._id === 'PENDING') {
        pendingPaise = s.totalAmount;
        pendingCount = s.count;
      }
      if (s._id === 'REJECTED') rejectedPaise = s.totalAmount;
    });

    const reportCount = await DailyReport.countDocuments({ project: project._id, status: 'SUBMITTED' });
    const budget = project.budget || 0;

    // Check assignments
    const activeAssignments = await ProjectAssignment.find({
      project: project._id,
      assignmentStatus: 'ACTIVE',
    }).populate('siteInCharge', populateFields);

    const projectObj = project.toObject();
    if (!isCallerMD) {
      delete (projectObj as any).budget;
    }

    res.json({
      success: true,
      project: {
        ...projectObj,
        activeAssignments,
        financials: isCallerMD ? {
          budget,
          approvedPaise,
          pendingPaise,
          rejectedPaise,
          pendingCount,
          remainingPaise: Math.max(0, budget - approvedPaise),
          burnPercentage: budget > 0 ? Math.round((approvedPaise / budget) * 100) : 0,
        } : undefined,
        reportCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch project', error: error.message });
  }
}

export async function createProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      name,
      code,
      location,
      description,
      budget,
      assignedInCharge,
      startDate,
      expectedCompletionDate,
      status,
    } = req.body;

    if (!name || !code || !location) {
      res.status(400).json({
        success: false,
        message: 'Project name, unique project code, and site address/location are required',
      });
      return;
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = await Project.findOne({ code: cleanCode });
    if (existing) {
      res.status(409).json({ success: false, message: `Project code '${cleanCode}' is already in use` });
      return;
    }

    let budgetPaise = 0;
    if (budget !== undefined && budget !== null && budget !== '') {
      budgetPaise = req.body.isPaise ? Number(budget) : rupeesToPaise(budget);
    }

    let inChargeUserId: mongoose.Types.ObjectId | undefined = undefined;
    if (assignedInCharge) {
      const inChargeUser = await User.findById(assignedInCharge);
      if (!inChargeUser || !isSiteInCharge(inChargeUser.role)) {
        res.status(400).json({ success: false, message: 'Selected in-charge user is invalid or does not have in-charge role' });
        return;
      }
      inChargeUserId = inChargeUser._id;
    }

    const project = await Project.create({
      name: name.trim(),
      code: cleanCode,
      location: location.trim(),
      description: description?.trim(),
      budget: budgetPaise,
      assignedInCharge: inChargeUserId,
      startDate: startDate ? new Date(startDate) : undefined,
      expectedCompletionDate: expectedCompletionDate ? new Date(expectedCompletionDate) : undefined,
      status: status || 'IN_PROGRESS',
      owner: req.user!.userId,
      createdBy: req.user!.userId,
    });

    if (inChargeUserId) {
      // Create active ProjectAssignment
      await ProjectAssignment.create({
        project: project._id,
        siteInCharge: inChargeUserId,
        assignmentStatus: 'ACTIVE',
        assignedBy: req.user!.userId,
      });

      // Link project in User's assignedProjects
      await User.findByIdAndUpdate(inChargeUserId, {
        $addToSet: { assignedProjects: project._id },
      });
    }

    await logAudit('PROJECT_CREATED', req.user!.userId, 'PROJECT', project._id, {
      name: project.name,
      code: project.code,
      budget: project.budget,
      assignedInCharge: inChargeUserId ? inChargeUserId.toString() : 'None',
    });

    res.status(201).json({ success: true, message: 'Project created successfully', project });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to create project', error: error.message });
  }
}

export async function updateProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const {
      name,
      location,
      description,
      budget,
      assignedInCharge,
      startDate,
      expectedCompletionDate,
      status,
    } = req.body;

    const project = await Project.findById(id);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // Verify ownership
    if (project.createdBy.toString() !== req.user!.userId && project.owner?.toString() !== req.user!.userId) {
      res.status(403).json({ success: false, message: 'Only the authorized MD can update this project' });
      return;
    }

    const oldInChargeId = project.assignedInCharge?.toString();

    if (name) project.name = name.trim();
    if (location) project.location = location.trim();
    if (description !== undefined) project.description = description.trim();
    if (budget !== undefined) {
      project.budget = req.body.isPaise ? Number(budget) : rupeesToPaise(budget);
    }
    if (startDate !== undefined) project.startDate = startDate ? new Date(startDate) : undefined;
    if (expectedCompletionDate !== undefined) {
      project.expectedCompletionDate = expectedCompletionDate ? new Date(expectedCompletionDate) : undefined;
    }
    if (status) project.status = status;

    if (assignedInCharge !== undefined && assignedInCharge !== oldInChargeId) {
      if (assignedInCharge) {
        const newInCharge = await User.findById(assignedInCharge);
        if (!newInCharge || !isSiteInCharge(newInCharge.role)) {
          res.status(400).json({ success: false, message: 'Assigned user is not a valid in-charge' });
          return;
        }
        project.assignedInCharge = newInCharge._id;

        // Create or activate ProjectAssignment
        await ProjectAssignment.findOneAndUpdate(
          { project: project._id, siteInCharge: newInCharge._id },
          { assignmentStatus: 'ACTIVE', assignedBy: req.user!.userId },
          { upsert: true, new: true }
        );

        await User.findByIdAndUpdate(newInCharge._id, { $addToSet: { assignedProjects: project._id } });
      } else {
        project.assignedInCharge = undefined;
      }

      if (oldInChargeId) {
        await ProjectAssignment.findOneAndUpdate(
          { project: project._id, siteInCharge: oldInChargeId },
          { assignmentStatus: 'REVOKED' }
        );
        await User.findByIdAndUpdate(oldInChargeId, { $pull: { assignedProjects: project._id } });
      }
    }

    await project.save();

    await logAudit('PROJECT_UPDATED', req.user!.userId, 'PROJECT', project._id, {
      name: project.name,
      status: project.status,
      budget: project.budget,
    });

    res.json({ success: true, message: 'Project updated successfully', project });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to update project', error: error.message });
  }
}

/**
 * Get all assignments for a project
 */
export async function getProjectAssignments(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const project = await Project.findById(id).populate('assignedInCharge', 'name email phone role');
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const assignments = await ProjectAssignment.find({ project: project._id })
      .populate('siteInCharge', 'name email phone role isActive')
      .populate('assignedBy', 'name email role')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      primaryInCharge: project.assignedInCharge || null,
      count: assignments.length,
      assignments,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch assignments', error: error.message });
  }
}

/**
 * Assign a Site In-Charge to a project (existing user or newly provisioned)
 */
export async function assignProjectInCharge(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { siteInChargeId, newUser } = req.body;

    const project = await Project.findById(id);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // Verify MD ownership
    if (project.createdBy.toString() !== req.user!.userId && project.owner?.toString() !== req.user!.userId) {
      res.status(403).json({ success: false, message: 'Only the authorized MD can manage assignments for this project.' });
      return;
    }

    let targetUserId: string;

    if (newUser) {
      // Secure workflow to provision new in-charge
      const { name, email, password, phone } = newUser;
      if (!name || !email || !password) {
        res.status(400).json({ success: false, message: 'Name, email, and explicit password are required for new account' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        return;
      }

      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        if (!isSiteInCharge(existingUser.role)) {
          res.status(409).json({ success: false, message: 'A user with this email already exists and is not a Site In-Charge' });
          return;
        }
        targetUserId = existingUser._id.toString();
      } else {
        const createdUser = await User.create({
          name: name.trim(),
          email: email.toLowerCase().trim(),
          password,
          role: 'SITE_INCHARGE',
          phone: phone?.trim(),
          isActive: true,
          assignedProjects: [project._id],
        });
        targetUserId = createdUser._id.toString();

        await logAudit('USER_CREATED', req.user!.userId, 'USER', createdUser._id, {
          name: createdUser.name,
          email: createdUser.email,
          role: createdUser.role,
        });
      }
    } else if (siteInChargeId) {
      const inChargeUser = await User.findById(siteInChargeId);
      if (!inChargeUser || !isSiteInCharge(inChargeUser.role)) {
        res.status(400).json({ success: false, message: 'Selected user is not a valid Site In-Charge' });
        return;
      }
      targetUserId = inChargeUser._id.toString();
    } else {
      res.status(400).json({ success: false, message: 'Either siteInChargeId or newUser details must be provided' });
      return;
    }

    // Activate or create ProjectAssignment
    const assignment = await ProjectAssignment.findOneAndUpdate(
      { project: project._id, siteInCharge: new mongoose.Types.ObjectId(targetUserId) },
      {
        assignmentStatus: 'ACTIVE',
        assignedBy: new mongoose.Types.ObjectId(req.user!.userId),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate('siteInCharge', 'name email phone role');

    // Update project primary in-charge
    project.assignedInCharge = new mongoose.Types.ObjectId(targetUserId);
    await project.save();

    // Update user assignedProjects
    await User.findByIdAndUpdate(targetUserId, {
      $addToSet: { assignedProjects: project._id },
    });

    await logAudit('PROJECT_ASSIGNMENT_CREATED', req.user!.userId, 'PROJECT', project._id, {
      siteInChargeId: targetUserId,
      projectCode: project.code,
    });

    res.status(200).json({
      success: true,
      message: 'Site In-Charge assigned successfully to project',
      assignment,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to assign site in-charge', error: error.message });
  }
}

/**
 * Remove or Revoke a Site In-Charge assignment
 */
export async function removeProjectAssignment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id, siteInChargeId } = req.params;

    const project = await Project.findById(id);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // Verify MD ownership
    if (project.createdBy.toString() !== req.user!.userId && project.owner?.toString() !== req.user!.userId) {
      res.status(403).json({ success: false, message: 'Only the authorized MD can revoke assignments for this project.' });
      return;
    }

    // Mark assignment REVOKED
    await ProjectAssignment.findOneAndUpdate(
      { project: project._id, siteInCharge: new mongoose.Types.ObjectId(siteInChargeId) },
      { assignmentStatus: 'REVOKED', assignedBy: new mongoose.Types.ObjectId(req.user!.userId) },
      { upsert: true, new: true }
    );

    // If primary in-charge was revoked, fallback to another active in-charge if any
    if (project.assignedInCharge && project.assignedInCharge.toString() === siteInChargeId) {
      const remaining = await ProjectAssignment.findOne({
        project: project._id,
        assignmentStatus: 'ACTIVE',
      });
      project.assignedInCharge = remaining ? (remaining.siteInCharge as any) : undefined;
      await project.save();
    }

    // Remove project from user's assignedProjects
    await User.findByIdAndUpdate(siteInChargeId, {
      $pull: { assignedProjects: project._id },
    });

    await logAudit('PROJECT_ASSIGNMENT_REVOKED', req.user!.userId, 'PROJECT', project._id, {
      siteInChargeId,
      projectCode: project.code,
    });

    res.json({
      success: true,
      message: 'Site In-Charge assignment revoked. Project access immediately terminated.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to revoke assignment', error: error.message });
  }
}
