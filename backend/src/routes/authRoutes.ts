import { Router } from 'express';
import {
  login,
  getMe,
  registerMD,
  registerFirstMD,
  getFirstMDStatus,
  getInvitationByToken,
  acceptInvitation,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/first-md-status', getFirstMDStatus);
router.post('/register', registerMD);
router.post('/register-md', registerMD);
router.post('/register-first-md', registerFirstMD);
router.get('/invitation/:token', getInvitationByToken);
router.post('/accept-invitation', acceptInvitation);
router.post('/login', login);
router.get('/me', authenticate, getMe);

export default router;
