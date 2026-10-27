import { Router } from 'express';
import {
  listProjectMessages,
  sendProjectMessage,
  markProjectMessagesRead,
  getUnreadMessagesCount,
  getProjectPresence,
  uploadProjectMessageMedia,
  serveProjectMessageMedia,
} from '../controllers/communicationController.js';
import { authenticate } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', listProjectMessages);
router.post('/', sendProjectMessage);
router.put('/read', markProjectMessagesRead);
router.get('/unread-count', getUnreadMessagesCount);
router.get('/presence', getProjectPresence);

// Media upload & streaming endpoints
router.post(
  '/upload',
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'file', maxCount: 1 },
  ]),
  uploadProjectMessageMedia
);
router.get('/media/:filename', serveProjectMessageMedia);

export default router;
