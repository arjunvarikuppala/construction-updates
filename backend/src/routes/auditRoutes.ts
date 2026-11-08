import mongoose from 'mongoose';
import { getCompanyInChargeIds } from '../services/tenantService.js';
import { Router, Response } from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { authenticate, requireOwner } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../types/index.js';

const router = Router();

router.use(authenticate, requireOwner);

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    // Company isolation: an MD sees only actions by themselves and their In-Charges
    const members = [new mongoose.Types.ObjectId(req.user!.userId), ...(await getCompanyInChargeIds(req.user!.userId))];
    const logs = await AuditLog.find({ performedBy: { $in: members } })
      .populate('performedBy', 'name email role')
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({ success: true, count: logs.length, logs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs', error: error.message });
  }
});

export default router;
