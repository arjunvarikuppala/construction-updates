import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuthenticatedRequest, AuthUserPayload, isMD, isSiteInCharge, normalizeRole } from '../types/index.js';
import { Project, IProject } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';

const JWT_SECRET = process.env.JWT_SECRET || 'sitetrack_super_secure_jwt_secret_dev_2026';

export interface ProjectAuthorizedRequest extends AuthenticatedRequest {
  projectDoc?: IProject;
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = String(req.query.token);
  }

  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUserPayload;
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid or expired authentication session' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const userRole = req.user.role;
    const matches = roles.some((role) => {
      if (role === 'MD' || role === 'OWNER') return isMD(userRole);
      if (role === 'SITE_INCHARGE' || role === 'IN_CHARGE') return isSiteInCharge(userRole);
      return userRole === role;
    });

    if (!matches) {
      res.status(403).json({
        success: false,
        message: `Forbidden. Requires one of roles: [${roles.join(', ')}]`,
      });
      return;
    }

    next();
  };
}

export const requireMD = requireRole('MD');
export const requireOwner = requireMD; // Backward compatibility alias
export const requireSiteInCharge = requireRole('SITE_INCHARGE');

/**
 * Checks if a user has active authorized access to a project.
 * - MD/Owner: Must be project creator or owner.
 * - Site In-Charge: Must have an ACTIVE project assignment.
 */
export async function verifyUserProjectAccess(
  projectId: string | mongoose.Types.ObjectId,
  userId: string,
  userRole: string
): Promise<{ allowed: boolean; project?: IProject; reason?: string }> {
  const pStr = String(projectId || '').trim();
  if (!pStr) {
    return { allowed: false, reason: 'INVALID_ID' };
  }

  let project: IProject | null = null;
  if (mongoose.Types.ObjectId.isValid(pStr)) {
    project = await Project.findById(pStr);
  }
  if (!project) {
    // Fallback: Support project code lookup (e.g. TG-156, HYDRA167) for seamless route resolution
    project = await Project.findOne({ code: pStr.toUpperCase() });
  }

  if (!project) {
    return { allowed: false, reason: 'NOT_FOUND' };
  }

  // MD / Owner Check: Must be the owner or creator of this project
  if (isMD(userRole)) {
    const isOwner =
      project.createdBy.toString() === userId ||
      (project.owner && project.owner.toString() === userId);

    if (isOwner) {
      return { allowed: true, project };
    }
    return { allowed: false, project, reason: 'NOT_OWNER' };
  }

  // Site In-Charge Check: Must have an active assignment
  if (isSiteInCharge(userRole)) {
    // 1. Check ProjectAssignment table
    const assignment = await ProjectAssignment.findOne({
      project: project._id,
      siteInCharge: new mongoose.Types.ObjectId(userId),
      assignmentStatus: 'ACTIVE',
    });

    if (assignment) {
      return { allowed: true, project };
    }

    // 2. Fallback check for direct assignedInCharge field (legacy compatibility)
    // Only if no explicit REVOKED record exists
    const revokedRecord = await ProjectAssignment.findOne({
      project: project._id,
      siteInCharge: new mongoose.Types.ObjectId(userId),
      assignmentStatus: 'REVOKED',
    });

    if (!revokedRecord && project.assignedInCharge && project.assignedInCharge.toString() === userId) {
      return { allowed: true, project };
    }

    return { allowed: false, project, reason: 'NOT_ASSIGNED' };
  }

  return { allowed: false, project, reason: 'UNAUTHORIZED_ROLE' };
}

/**
 * Express middleware to enforce project-level access control.
 */
export async function requireProjectAccess(
  req: ProjectAuthorizedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const projectId =
    req.params.projectId ||
    req.params.id ||
    req.body.project ||
    req.body.projectId ||
    req.query.projectId;

  if (!projectId) {
    return next();
  }

  try {
    const check = await verifyUserProjectAccess(projectId, req.user.userId, req.user.role);

    if (check.reason === 'INVALID_ID' || check.reason === 'NOT_FOUND') {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    if (!check.allowed) {
      if (check.reason === 'NOT_OWNER') {
        res.status(403).json({
          success: false,
          message: 'Access denied: You are not the authorized MD for this project.',
        });
        return;
      }
      res.status(403).json({
        success: false,
        message: 'Access denied: You are not assigned to this project.',
      });
      return;
    }

    req.projectDoc = check.project;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to verify project permissions', error });
  }
}
