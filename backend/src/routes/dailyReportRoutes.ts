import { Router } from 'express';
import {
  listDailyReports,
  getDailyReportById,
  recordDailyReportView,
  createDailyReport,
  updateDailyReport,
  getMissingReports,
} from '../controllers/dailyReportController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', listDailyReports);
router.get('/missing', getMissingReports);
router.get('/:id', getDailyReportById);
router.post('/:id/view', recordDailyReportView);
router.post('/', createDailyReport);
router.put('/:id', updateDailyReport);

export default router;
