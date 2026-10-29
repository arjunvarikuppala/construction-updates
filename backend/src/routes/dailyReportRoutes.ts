import { Router } from 'express';
import {
  listDailyReports,
  getDailyReportById,
  recordDailyReportView,
  createDailyReport,
  updateDailyReport,
  getMissingReports,
  getUnreadReportsSummary,
  addDailyReportComment,
} from '../controllers/dailyReportController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', listDailyReports);
router.get('/unread-summary', getUnreadReportsSummary);
router.get('/missing', getMissingReports);
router.get('/:id', getDailyReportById);
router.post('/:id/view', recordDailyReportView);
router.post('/:id/read', recordDailyReportView);
router.post('/:id/mark-read', recordDailyReportView);
router.post('/:id/comments', addDailyReportComment);
router.post('/', createDailyReport);
router.put('/:id', updateDailyReport);

export default router;
