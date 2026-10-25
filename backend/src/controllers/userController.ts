import { Response } from 'express';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Invitation } from '../models/Invitation.js';
import { AuthenticatedRequest } from '../types/index.js';
import { logAudit } from '../services/auditService.js';

export async function listInChargeUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const query: any = { role: { $in: ['SITE_INCHARGE', 'IN_CHARGE'] } };

    if (req.query.q) {
      const searchStr = String(req.query.q).trim();
      query.$or = [
        { name: { $regex: searchStr, $options: 'i' } },
        { email: { $regex: searchStr, $options: 'i' } },
        { phone: { $regex: searchStr, $options: 'i' } },
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .populate('assignedProjects', 'name code location status')
      .sort({ name: 1 });

    res.json({ success: true, count: users.length, users });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to list in-charge users', error: error.message });
  }
}

export async function createInChargeUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { name, email, password, phone } = req.body;

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

    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: 'SITE_INCHARGE',
      phone: phone?.trim(),
      assignedProjects: [],
      isActive: true,
    });

    await logAudit('USER_CREATED', req.user!.userId, 'USER', newUser._id, {
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
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
        assignedProjects: newUser.assignedProjects,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
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
