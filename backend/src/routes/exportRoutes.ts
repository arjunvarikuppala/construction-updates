import { Router } from 'express';
import { exportExpensesExcel } from '../controllers/exportController.js';
import { authenticate, requireOwner } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, requireOwner);

router.get('/expenses/excel', exportExpensesExcel);

export default router;
