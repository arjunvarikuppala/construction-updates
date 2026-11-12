import { Router } from 'express';
import {
  exportExpensesExcel,
  exportGstRegister,
  projectRegister,
  projectExcel,
  inChargePayments,
  inChargePaymentsExcel,
  inChargeSalaryExcel,
} from '../controllers/exportController.js';
import { authenticate, requireOwner } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, requireOwner);

router.get('/expenses/excel', exportExpensesExcel);
router.get('/gst-register', exportGstRegister);
// Per project: on-screen register + one day-by-day Excel file per topic (?from=&to=)
router.get('/projects/:id/register', projectRegister);
router.get('/projects/:id/payments.xlsx', projectExcel('payments'));
router.get('/projects/:id/work.xlsx', projectExcel('work'));
router.get('/projects/:id/expenses.xlsx', projectExcel('expenses'));
// Per in-charge: every payment made to them, and their salary file
router.get('/in-charges/:id/payments', inChargePayments);
router.get('/in-charges/:id/payments.xlsx', inChargePaymentsExcel);
router.get('/in-charges/:id/salary.xlsx', inChargeSalaryExcel);

export default router;
