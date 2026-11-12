import { Router } from 'express';
import {
  salarySummary,
  salaryHistory,
  paySalary,
  voidSalaryPayment,
  confirmSalaryReceived,
} from '../controllers/salaryController.js';
import { authenticate, requireMD } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// In-charge: own salary history + confirm money received
router.get('/me', salaryHistory);
router.post('/payments/:pid/confirm', confirmSalaryReceived);

// MD only
router.get('/summary', requireMD, salarySummary);
router.get('/employees/:id', requireMD, salaryHistory);
router.post('/employees/:id/payments', requireMD, paySalary);
router.post('/payments/:pid/void', requireMD, voidSalaryPayment);

export default router;
