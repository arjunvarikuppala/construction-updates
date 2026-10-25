import { Request } from 'express';
import { Types } from 'mongoose';

export type UserRole = 'MD' | 'SITE_INCHARGE' | 'OWNER' | 'IN_CHARGE';

export function isMD(role?: string): boolean {
  return role === 'MD' || role === 'OWNER';
}

export function isSiteInCharge(role?: string): boolean {
  return role === 'SITE_INCHARGE' || role === 'IN_CHARGE';
}

export function normalizeRole(role: string): 'MD' | 'SITE_INCHARGE' {
  return isMD(role) ? 'MD' : 'SITE_INCHARGE';
}

export type AssignmentStatus = 'ACTIVE' | 'REVOKED';

export type ExpenseCategory =
  | 'LABOUR'
  | 'CONSTRUCTION_MATERIALS'
  | 'DIESEL_AND_FUEL'
  | 'MACHINERY_AND_EQUIPMENT'
  | 'TRANSPORTATION'
  | 'FOOD_AND_ACCOMMODATION'
  | 'REPAIRS_AND_MAINTENANCE'
  | 'OTHER';

export type ExpenseStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type ProjectStatus = 'PLANNING' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED';

export type ReportStatus = 'DRAFT' | 'SUBMITTED';

export interface AuthUserPayload {
  userId: string;
  role: UserRole;
  email: string;
  name: string;
  assignedProjects?: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUserPayload;
}

export interface WorkItem {
  description: string;
  quantity: number;
  unit: string;
}

export interface LabourCountItem {
  role: string;
  count: number;
}

export interface SitePhoto {
  url: string;
  caption?: string;
  uploadedAt: Date;
}
