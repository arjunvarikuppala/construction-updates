import { Response } from 'express';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Invitation } from '../models/Invitation.js';
import { PushSubscription } from '../models/PushSubscription.js';
import { AuthenticatedRequest, isMD } from '../types/index.js';
import { logAudit } from '../services/auditService.js';
import { getCompanyInChargeIds, isInChargeInCompany } from '../services/tenantService.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { escapeRegex } from '../utils/validation.js';
import { rupeesToPaise } from '../utils/currency.js';
import { checkAccountPhone } from '../services/accountPhoneService.js';

export async function listInChargeUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const isCallerMD = isMD(req.user?.role);
    // Company isolation: only In-Charges this MD created, invited or assigned
    const companyInCharges = await getCompanyInChargeIds(req.user!.userId);
    // Deleted accounts (personal details erased) are no longer listed
    const query: any = {
      role: { $in: ['SITE_INCHARGE', 'IN_CHARGE'] },
      _id: { $in: companyInCharges },
      email: { $not: /@deleted\.invalid$/ },
    };

    if (req.query.q) {
      const searchStr = escapeRegex(String(req.query.q).trim());
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

/**
 * MD deletes a Site In-Charge's account (Google Play account-deletion policy).
 * Personal details are erased and sign-in is disabled for good. Reports,
 * expenses, payments and chat stay as the company's business records (needed
 * for accounts and GST); they now show "Deleted user" as the author.
 */
export async function deleteInChargeAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!isMD(req.user?.role)) {
      res.status(403).json({ success: false, message: 'Only the Managing Director can delete accounts.' });
      return;
    }
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user || !['SITE_INCHARGE', 'IN_CHARGE'].includes(user.role) || !(await isInChargeInCompany(req.user!.userId, id))) {
      res.status(404).json({ success: false, message: 'In-charge user not found' });
      return;
    }
    if (user.email.endsWith('@deleted.invalid')) {
      res.json({ success: true, message: 'This account was already deleted.' });
      return;
    }

    user.name = 'Deleted user';
    user.email = `deleted-${user._id}@deleted.invalid`;
    user.phone = undefined;
    user.salary = undefined;
    user.salaryFrequency = undefined;
    user.isActive = false;
    user.assignedProjects = [];
    user.password = crypto.randomBytes(32).toString('hex'); // hashed on save; nobody knows it
    await user.save();

    // Stop phone notifications to that device
    await PushSubscription.deleteMany({ user: user._id });

    await logAudit('ACCOUNT_DELETED', req.user!.userId, 'USER', user._id, { deletedUserId: user._id }, req.ip);
    res.json({ success: true, message: 'Account deleted. Their personal details are erased and they can no longer sign in.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Could not delete the account.' });
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
    if (!user || !['SITE_INCHARGE', 'IN_CHARGE'].includes(user.role) || !(await isInChargeInCompany(req.user!.userId, id))) {
      res.status(404).json({ success: false, message: 'In-charge user not found' });
      return;
    }

    if (name) user.name = name.trim();
    // A mobile number can be changed but not removed (it's how the password is reset)
    if (typeof phone === 'string' && phone.trim()) {
      const phoneCheck = await checkAccountPhone(phone, String(user._id));
      if (!phoneCheck.ok) {
        res.status(phoneCheck.status).json({ success: false, message: phoneCheck.message });
        return;
      }
      user.phone = phoneCheck.phone;
    }
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
      const access = await verifyUserProjectAccess(String(projectId), req.user!.userId, req.user!.role);
      if (!access.allowed || !access.project) {
        res.status(404).json({ success: false, message: 'Project not found' });
        return;
      }
      validProjectId = access.project._id.toString();
    }

    const existingInvite = await Invitation.findOne({
      email: cleanEmail,
      status: 'PENDING',
      expiresAt: { $gt: new Date() },
    });

    let token: string;
    let invitationDoc;

    if (existingInvite && String(existingInvite.invitedBy) !== req.user!.userId) {
      res.status(409).json({ success: false, message: 'This person already has a pending invitation from another organisation.' });
      return;
    }

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
