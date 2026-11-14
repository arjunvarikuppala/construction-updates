/** Mobile numbers on accounts: valid Indian mobile, and one account per number. */
import { User } from '../models/User.js';
import { normalizeIndianMobile, MOBILE_REQUIRED_MESSAGE } from '../utils/phone.js';

export type PhoneCheck = { ok: true; phone: string } | { ok: false; status: number; message: string };

/** Accounts that can be found by a mobile number (deleted accounts are left out). */
export function activePhoneQuery(phone: string) {
  return { phone, isActive: true, email: { $not: /@deleted\.invalid$/ } };
}

export async function checkAccountPhone(raw: unknown, exceptUserId?: string): Promise<PhoneCheck> {
  const phone = normalizeIndianMobile(raw);
  if (!phone) return { ok: false, status: 400, message: MOBILE_REQUIRED_MESSAGE };
  const taken = await User.findOne({ ...activePhoneQuery(phone), ...(exceptUserId ? { _id: { $ne: exceptUserId } } : {}) }).select('_id');
  if (taken) return { ok: false, status: 409, message: 'This mobile number is already on another account.' };
  return { ok: true, phone };
}

/**
 * Older accounts were saved as typed ("98765 43210", "+91-98765-43210").
 * Rewrite them once as +91XXXXXXXXXX so duplicates are caught. Safe to run on every start.
 */
export async function normalizeStoredPhones(): Promise<number> {
  const users = await User.find({ phone: { $exists: true, $nin: [null, ''], $not: /^\+91[6-9]\d{9}$/ } }).select('phone');
  let changed = 0;
  for (const u of users) {
    const phone = normalizeIndianMobile(u.phone);
    if (phone && phone !== u.phone) {
      await User.updateOne({ _id: u._id }, { $set: { phone } });
      changed += 1;
    }
  }
  return changed;
}
