import { Router } from 'express';
import {
  listProjectMessages,
  sendProjectMessage,
  markProjectMessagesRead,
  getUnreadMessagesCount,
} from '../controllers/communicationController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', listProjectMessages);
router.post('/', sendProjectMessage);
router.put('/read', markProjectMessagesRead);
router.get('/unread-count', getUnreadMessagesCount);

export default router;
