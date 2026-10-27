import { Types } from 'mongoose';
import { AuditLog, AuditEntityType } from '../models/AuditLog.js';

export async function logAudit(
  action: string,
  performedBy: string | Types.ObjectId,
  entityType: AuditEntityType,
  entityId: string | Types.ObjectId,
  details?: Record<string, any>,
  ip?: string
): Promise<void> {
  try {
    await AuditLog.create({
      action,
      performedBy,
      entityType,
      entityId,
      details,
      ip,
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}
