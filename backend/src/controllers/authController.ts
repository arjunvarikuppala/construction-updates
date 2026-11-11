import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { Invitation } from '../models/Invitation.js';
import { AuthenticatedRequest, AuthUserPayload, isMD } from '../types/index.js';
import { logAudit } from '../services/auditService.js';
import { validatePasswordStrength } from '../utils/password.js';

import { getJwtSecret } from '../middleware/auth.js';
import { AuditLog } from '../models/AuditLog.js';
import { createNotification } from '../services/notificationService.js';
import { getCompanyIdsForUser } from '../services/tenantService.js';
const JWT_EXPIRES_IN = '7d';

export async function getFirstMDStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const mdCount = await User.countDocuments({ role: { $in: ['MD', 'OWNER'] } });
    res.json({ success: true, hasMD: mdCount > 0, registrationOpen: mdCount === 0 || publicRegistrationAllowed() });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to check MD status', error: error.message });
  }
}

/**
 * Single-company deployment (BKR INFRA): only the very first MD can self-register.
 * After that, sign-up is closed and In-Charges join through the MD's invitations.
 * ALLOW_PUBLIC_REGISTRATION=true re-opens it (used by the multi-company test suite).
 */
function publicRegistrationAllowed(): boolean {
  return process.env.ALLOW_PUBLIC_REGISTRATION === 'true';
}

export async function registerMD(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { name, email, password, phone } = req.body;

    if (!publicRegistrationAllowed()) {
      const mdExists = await User.exists({ role: { $in: ['MD', 'OWNER'] } });
      if (mdExists) {
        res.status(403).json({
          success: false,
          message: 'Registration is closed. Please ask the BKR INFRA Managing Director for an invitation.',
        });
        return;
      }
    }

    if (typeof name !== 'string' || typeof email !== 'string' || !name.trim() || !email.trim() || !password) {
      res.status(400).json({ success: false, message: 'Name, email, and password are required' });
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      res.status(400).json({ success: false, message: 'Please provide a valid email address' });
      return;
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      res.status(400).json({ success: false, message: passwordError });
      return;
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(409).json({ success: false, message: 'A user with this email already exists' });
      return;
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: 'MD',
      phone: phone?.trim(),
      isActive: true,
      assignedProjects: [],
    });

    const payload: AuthUserPayload = {
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
      name: user.name,
      assignedProjects: [],
    };

    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });

    await logAudit(
      'MD_REGISTERED',
      user._id,
      'USER',
      user._id,
      { email: user.email, role: user.role, name: user.name },
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Managing Director account created successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        assignedProjects: user.assignedProjects,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to register Managing Director account', error: error.message });
  }
}

export const registerFirstMD = registerMD;

export async function login(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase(), isActive: true }).select('+password');
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const payload: AuthUserPayload = {
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
      name: user.name,
      assignedProjects: user.assignedProjects.map((id) => id.toString()),
    };

    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });

    await logAudit(
      'USER_LOGIN',
      user._id,
      'USER',
      user._id,
      { email: user.email, role: user.role },
      req.ip
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        assignedProjects: user.assignedProjects,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Internal server error during authentication', error: error.message });
  }
}

/**
 * A Site In-Charge asks for their account to be deleted (Google Play policy).
 * The request goes to the MD(s) of their company, who delete it from
 * In-Charge Accounts. MDs own the company account, so they contact support instead.
 */
export async function requestAccountDeletion(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (isMD(req.user!.role)) {
      res.status(400).json({
        success: false,
        message: 'You are the company owner. To close the company account and delete its data, contact app support.',
      });
      return;
    }
    const user = await User.findById(req.user!.userId).select('name email createdByMD');
    if (!user) {
      res.status(404).json({ success: false, message: 'Account not found.' });
      return;
    }

    // One request per day is enough; repeat taps just confirm it was sent
    const recent = await AuditLog.findOne({
      action: 'ACCOUNT_DELETION_REQUESTED',
      performedBy: user._id,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (recent) {
      res.json({ success: true, alreadyRequested: true, message: 'Your request was already sent to the Managing Director.' });
      return;
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    const mdIds = new Set(await getCompanyIdsForUser(req.user!));
    if (user.createdByMD) mdIds.add(user.createdByMD.toString());
    for (const mdId of mdIds) {
      await createNotification({
        recipient: mdId,
        sender: user._id,
        type: 'SYSTEM',
        title: 'Account deletion requested',
        message: `${user.name} (${user.email}) asked for their account and personal data to be deleted. Open In-Charge Accounts to delete it.${reason ? ` Reason: ${reason}` : ''}`,
      });
    }
    await logAudit('ACCOUNT_DELETION_REQUESTED', user._id, 'USER', user._id, { reason: reason || undefined, notifiedMDs: mdIds.size }, req.ip);

    res.json({
      success: true,
      message:
        mdIds.size > 0
          ? 'Your request has been sent to the Managing Director. Your account and personal details will be deleted within 30 days.'
          : 'Your request has been recorded. Please also contact your Managing Director.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Could not send the deletion request.' });
  }
}

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const user = await User.findById(req.user.userId).populate('assignedProjects', 'name code location status budget');
    if (!user || !user.isActive) {
      res.status(404).json({ success: false, message: 'User account not found or deactivated' });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        assignedProjects: user.assignedProjects,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch current user', error: error.message });
  }
}

export async function getInvitationByToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { token } = req.params;
    if (!token || typeof token !== 'string') {
      res.status(400).json({ success: false, message: 'Invitation token is required' });
      return;
    }

    const invitation = await Invitation.findOne({ token })
      .populate('project', 'name code location')
      .populate('invitedBy', 'name email');

    if (!invitation) {
      res.status(404).json({ success: false, message: 'Invitation not found or invalid' });
      return;
    }

    if (invitation.status === 'ACCEPTED') {
      res.status(400).json({ success: false, message: 'This invitation has already been accepted and activated.' });
      return;
    }

    if (invitation.status === 'EXPIRED' || invitation.expiresAt < new Date()) {
      res.status(400).json({ success: false, message: 'This invitation has expired. Please contact your Managing Director.' });
      return;
    }

    res.json({
      success: true,
      invitation: {
        id: invitation._id,
        email: invitation.email,
        name: invitation.name,
        role: invitation.role,
        project: invitation.project,
        invitedBy: invitation.invitedBy,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to retrieve invitation', error: error.message });
  }
}

export async function acceptInvitation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { token, password, phone } = req.body;

    if (typeof token !== 'string' || !token || !password) {
      res.status(400).json({ success: false, message: 'Token and password are required' });
      return;
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      res.status(400).json({ success: false, message: passwordError });
      return;
    }

    const invitation = await Invitation.findOne({
      token,
      status: 'PENDING',
      expiresAt: { $gt: new Date() },
    });

    if (!invitation) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired invitation token. Please request a new invitation from your MD.',
      });
      return;
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: invitation.email.toLowerCase() });
    if (existingUser) {
      res.status(409).json({ success: false, message: 'An account with this email address already exists.' });
      return;
    }

    // Create Site In-Charge user
    const newUser = await User.create({
      name: invitation.name.trim(),
      email: invitation.email.toLowerCase().trim(),
      password,
      role: 'SITE_INCHARGE',
      phone: phone?.trim(),
      isActive: true,
      createdByMD: invitation.invitedBy,
      assignedProjects: invitation.project ? [invitation.project] : [],
    });

    // If an initial project was tied to this invitation, link ProjectAssignment
    if (invitation.project) {
      await ProjectAssignment.create({
        project: invitation.project,
        siteInCharge: newUser._id,
        assignmentStatus: 'ACTIVE',
        assignedBy: invitation.invitedBy,
      });

      await Project.findByIdAndUpdate(invitation.project, {
        assignedInCharge: newUser._id,
      });
    }

    // Mark invitation accepted
    invitation.status = 'ACCEPTED';
    await invitation.save();

    await logAudit('INVITATION_ACCEPTED', newUser._id, 'USER', newUser._id, {
      email: newUser.email,
      role: newUser.role,
      invitedBy: invitation.invitedBy,
    });

    const payload: AuthUserPayload = {
      userId: newUser._id.toString(),
      role: newUser.role,
      email: newUser.email,
      name: newUser.name,
      assignedProjects: newUser.assignedProjects.map((id) => id.toString()),
    };

    const jwtToken = jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });

    res.status(201).json({
      success: true,
      message: 'Account established successfully! Welcome to SiteTrack.',
      token: jwtToken,
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
    res.status(500).json({ success: false, message: 'Failed to accept invitation', error: error.message });
  }
}
