import { Router } from 'express';
import {
  listExpenses,
  getExpenseById,
  createExpense,
  approveExpense,
  rejectExpense,
  resubmitExpense,
} from '../controllers/expenseController.js';
import { authenticate, requireOwner } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', listExpenses);
router.get('/:id', getExpenseById);
router.post('/', createExpense);

// Approval actions strictly restricted to Owner
router.post('/:id/approve', requireOwner, approveExpense);
router.post('/:id/reject', requireOwner, rejectExpense);

// Resubmission by In-Charge
router.post('/:id/resubmit', resubmitExpense);

export default router;
