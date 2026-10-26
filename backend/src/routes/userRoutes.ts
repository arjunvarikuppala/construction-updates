import { Router } from 'express';
import {
  listInChargeUsers,
  createInChargeUser,
  updateInChargeUser,
  createInvitation,
  listInvitations,
} from '../controllers/userController.js';
import { authenticate, requireOwner } from '../middleware/auth.js';

const router = Router();

// Only owners / MD can list and manage in-charge accounts & invitations
router.use(authenticate, requireOwner);

router.get('/in-charge', listInChargeUsers);
router.post('/in-charge', createInChargeUser);
router.put('/in-charge/:id', updateInChargeUser);
router.get('/invitations', listInvitations);
router.post('/invitations', createInvitation);

export default router;
