import { Router } from 'express';
import rateLimit from 'express-rate-limit';
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

// Dedicated brute-force protection for credential endpoints.
// Keyed on IP + submitted email so one attacker cannot lock out every user,
// and one user cannot be brute-forced from a single IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    return `${req.ip}|${email}`;
  },
  message: { success: false, message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.REGISTER_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many registration attempts. Please try again later.' },
});

router.get('/first-md-status', getFirstMDStatus);
router.post('/register', registrationLimiter, registerMD);
router.post('/register-md', registrationLimiter, registerMD);
router.post('/register-first-md', registrationLimiter, registerFirstMD);
router.get('/invitation/:token', registrationLimiter, getInvitationByToken);
router.post('/accept-invitation', registrationLimiter, acceptInvitation);
router.post('/login', loginLimiter, login);
router.get('/me', authenticate, getMe);

export default router;
