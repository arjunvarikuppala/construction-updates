/**
 *   PUT /auth/me/phone  { phone }  set your own mobile number (every account needs one, unique)
 */
import { Response } from 'express';
import { User } from '../models/User.js';
import { AuthenticatedRequest } from '../types/index.js';
import { logAudit } from '../services/auditService.js';
import { checkAccountPhone } from '../services/accountPhoneService.js';

export async function updateMyPhone(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const check = await checkAccountPhone(req.body?.phone, req.user!.userId);
    if (!check.ok) {
      res.status(check.status).json({ success: false, message: check.message });
      return;
    }
    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'Account not found' });
      return;
    }
    user.phone = check.phone;
    await user.save();
    await logAudit('USER_PHONE_UPDATED', user._id, 'USER', user._id, { phoneLast4: check.phone.slice(-4) }, req.ip);
    res.json({ success: true, phone: user.phone, message: 'Mobile number saved' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Could not save the mobile number.' });
  }
}
