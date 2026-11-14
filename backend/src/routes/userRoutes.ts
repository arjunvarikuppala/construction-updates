import { Router } from 'express';
import {
  listInChargeUsers,
  updateInChargeUser,
  deleteInChargeAccount,
  createInvitation,
  listInvitations,
} from '../controllers/userController.js';
import { authenticate, requireOwner } from '../middleware/auth.js';

const router = Router();

// Only owners / MD can list and manage in-charge accounts & invitations
router.use(authenticate, requireOwner);

router.get('/in-charge', listInChargeUsers);
router.put('/in-charge/:id', updateInChargeUser);
router.delete('/in-charge/:id', deleteInChargeAccount);
router.get('/invitations', listInvitations);
router.post('/invitations', createInvitation);

export default router;
