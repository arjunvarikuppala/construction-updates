import { Response } from 'express';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Invitation } from '../models/Invitation.js';
import { AuthenticatedRequest, isMD } from '../types/index.js';
import { logAudit } from '../services/auditService.js';
import { rupeesToPaise } from '../utils/currency.js';

export async function listInChargeUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const isCallerMD = isMD(req.user?.role);
    const query: any = { role: { $in: ['SITE_INCHARGE', 'IN_CHARGE'] } };

    if (req.query.q) {
      const searchStr = String(req.query.q).trim();
      query.$or = [
        { name: { $regex: searchStr, $options: 'i' } },
        { email: { $regex: searchStr, $options: 'i' } },
        { phone: { $regex: searchStr, $options: 'i' } },
      ];
    }

    // Only MD can see salaries; other users never see salary data
    const users = await User.find(query)
      .select(isCallerMD ? '-password' : '-password -salary -salaryFrequency')
      .populate('assignedProjects', 'name code location status')
      .sort({ name: 1 });

    res.json({ success: true, count: users.length, users });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to list in-charge users', error: error.message });
  }
}

export async function createInChargeUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { name, email, password, phone, salary, salaryFrequency } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ success: false, message: 'Name, email, and password are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
      return;
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409).json({ success: false, message: 'User with this email already exists' });
      return;
    }

    // Parse salary: if user passed rupees e.g. 50000, convert to integer paise (5000000)
    let salaryPaise = 0;
    if (salary !== undefined && salary !== null && salary !== '') {
      salaryPaise = rupeesToPaise(Number(salary) || 0);
    }

    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: 'SITE_INCHARGE',
      phone: phone?.trim(),
      salary: salaryPaise,
      salaryFrequency: salaryFrequency || 'MONTHLY',
      assignedProjects: [],
      isActive: true,
    });

    await logAudit('USER_CREATED', req.user!.userId, 'USER', newUser._id, {
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      salaryPaise,
    });

    res.status(201).json({
      success: true,
      message: 'Site In-Charge account created successfully',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        phone: newUser.phone,
        salary: newUser.salary,
        salaryFrequency: newUser.salaryFrequency,
        assignedProjects: newUser.assignedProjects,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
  }
}

export async function updateInChargeUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!isMD(req.user?.role)) {
      res.status(403).json({ success: false, message: 'Forbidden: Only the Managing Director can view or update in-charge salaries.' });
      return;
    }

    const { id } = req.params;
    const { name, phone, salary, salaryFrequency, isActive } = req.body;

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ success: false, message: 'In-charge user not found' });
      return;
    }

    if (name) user.name = name.trim();
    if (phone !== undefined) user.phone = phone ? phone.trim() : undefined;
    if (isActive !== undefined) user.isActive = Boolean(isActive);

    if (salary !== undefined && salary !== null && salary !== '') {
      user.salary = rupeesToPaise(Number(salary) || 0);
    }
    if (salaryFrequency) {
      user.salaryFrequency = salaryFrequency;
    }

    await user.save();

    await logAudit('USER_SALARY_UPDATED', req.user!.userId, 'USER', user._id, {
      updatedUserId: user._id,
      name: user.name,
      salaryPaise: user.salary,
      salaryFrequency: user.salaryFrequency,
    });

    res.json({
      success: true,
      message: 'In-charge salary and details updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        salary: user.salary,
        salaryFrequency: user.salaryFrequency,
        isActive: user.isActive,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to update in-charge user', error: error.message });
  }
}

export async function createInvitation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { name, email, projectId } = req.body;

    if (!name || !email) {
      res.status(400).json({ success: false, message: 'Name and email are required for invitation' });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      res.status(409).json({ success: false, message: 'A registered account already exists for this email address.' });
      return;
    }

    let validProjectId: string | undefined = undefined;
    if (projectId) {
      const proj = await Project.findById(projectId);
      if (proj) validProjectId = proj._id.toString();
    }

    const existingInvite = await Invitation.findOne({
      email: cleanEmail,
      status: 'PENDING',
      expiresAt: { $gt: new Date() },
    });

    let token: string;
    let invitationDoc;

    if (existingInvite) {
      token = existingInvite.token;
      existingInvite.name = name.trim();
      if (validProjectId) existingInvite.project = validProjectId as any;
      existingInvite.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await existingInvite.save();
      invitationDoc = existingInvite;
    } else {
      token = crypto.randomBytes(24).toString('hex');
      invitationDoc = await Invitation.create({
        name: name.trim(),
        email: cleanEmail,
        token,
        role: 'SITE_INCHARGE',
        project: validProjectId,
        invitedBy: req.user!.userId,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    }

    await logAudit('INVITATION_CREATED', req.user!.userId, 'USER', invitationDoc._id, {
      name: invitationDoc.name,
      email: invitationDoc.email,
      project: validProjectId,
    });

    const inviteLink = `/register?token=${token}`;

    res.status(201).json({
      success: true,
      message: 'Invitation generated successfully',
      inviteToken: token,
      inviteLink,
      invitation: invitationDoc,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to create invitation', error: error.message });
  }
}

export async function listInvitations(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const invitations = await Invitation.find({ invitedBy: req.user!.userId })
      .populate('project', 'name code location')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: invitations.length, invitations });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to list invitations', error: error.message });
  }
}
