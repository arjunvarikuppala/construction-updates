import { Router, Response } from 'express';
import { AuditLog } from '../models/AuditLog.js';
import { authenticate, requireOwner } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../types/index.js';

const router = Router();

router.use(authenticate, requireOwner);

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const logs = await AuditLog.find()
      .populate('performedBy', 'name email role')
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({ success: true, count: logs.length, logs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs', error: error.message });
  }
});

export default router;
