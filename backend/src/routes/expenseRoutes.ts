import { Router, Response } from 'express';
import {
  listExpenses,
  getExpenseById,
  createExpense,
  approveExpense,
  rejectExpense,
  resubmitExpense,
} from '../controllers/expenseController.js';
import { authenticate, requireOwner } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { storageService } from '../services/storageService.js';
import { AuthenticatedRequest } from '../types/index.js';

const router = Router();

router.use(authenticate);

// Receipt and invoice attachment upload for expenses and payments
router.post('/upload-receipt', upload.single('receipt'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, message: 'No receipt file uploaded' });
      return;
    }

    const result = await storageService.uploadFile(file.path, file.filename, file.mimetype);
    res.json({
      success: true,
      receiptUrl: result.url,
      url: result.url,
      filename: file.filename,
      originalName: file.originalname,
      size: result.size,
      mimetype: result.mimetype,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to upload receipt', error: error.message });
  }
});

router.get('/', listExpenses);
router.get('/:id', getExpenseById);
router.post('/', createExpense);

// Approval actions strictly restricted to Owner
router.post('/:id/approve', requireOwner, approveExpense);
router.post('/:id/reject', requireOwner, rejectExpense);

// Resubmission by In-Charge
router.post('/:id/resubmit', resubmitExpense);

export default router;
