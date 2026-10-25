import { Router } from 'express';
import { getOwnerDashboard, getInChargeDashboard } from '../controllers/dashboardController.js';
import { authenticate, requireOwner } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/owner', requireOwner, getOwnerDashboard);
router.get('/in-charge', getInChargeDashboard);

export default router;
