import { Router } from 'express';
import { exportExpensesExcel, exportGstRegister } from '../controllers/exportController.js';
import { authenticate, requireOwner } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, requireOwner);

router.get('/expenses/excel', exportExpensesExcel);
router.get('/gst-register', exportGstRegister);

export default router;
