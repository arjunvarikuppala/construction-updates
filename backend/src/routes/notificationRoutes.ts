import { Router } from 'express';
import {
  listNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
} from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', listNotifications);
router.get('/unread-count', getUnreadNotificationCount);

// Read single notification (support PUT, PATCH, POST)
router.put('/:id/read', markNotificationAsRead);
router.patch('/:id/read', markNotificationAsRead);
router.post('/:id/read', markNotificationAsRead);

// Read all notifications (support PUT, PATCH, POST)
router.put('/read-all', markAllNotificationsAsRead);
router.patch('/read-all', markAllNotificationsAsRead);
router.post('/read-all', markAllNotificationsAsRead);
router.post('/mark-all-read', markAllNotificationsAsRead);

export default router;
