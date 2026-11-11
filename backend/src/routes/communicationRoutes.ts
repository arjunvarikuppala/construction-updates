import { Router } from 'express';
import {
  listProjectMessages,
  sendProjectMessage,
  markProjectMessagesRead,
  getUnreadMessagesCount,
  getProjectPresence,
  uploadProjectMessageMedia,
  serveProjectMessageMedia,
  listShareableProjectFiles,
  editProjectMessage,
  deleteProjectMessage,
  reactToProjectMessage,
  pinProjectMessage,
  listPinnedMessages,
  searchProjectMessages,
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
router.get('/shareable', listShareableProjectFiles);

// Media upload & streaming endpoints
router.post(
  '/upload',
  upload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'file', maxCount: 1 },
    { name: 'thumb', maxCount: 1 }, // optional phone-made preview (photo thumbnail / video poster)
  ]),
  uploadProjectMessageMedia
);
router.get('/media/:filename', serveProjectMessageMedia);

// Advanced chat: pins, search, edit, delete-for-everyone, reactions
router.get('/pinned', listPinnedMessages);
router.get('/search', searchProjectMessages);
router.patch('/:messageId', editProjectMessage);
router.delete('/:messageId', deleteProjectMessage);
router.post('/:messageId/reactions', reactToProjectMessage);
router.put('/:messageId/pin', pinProjectMessage);

export default router;
