/**
 * Signed tokens for notification buttons ("Mark as read"). The phone's service
 * worker has no sign-in token, so each chat push carries one of these: it lets
 * that one user mark that one chat as read, and nothing else, for 7 days.
 */
import crypto from 'crypto';
import { getJwtSecret } from '../middleware/auth.js';

const TTL_SECONDS = 7 * 24 * 60 * 60;

function key(): Buffer {
  return crypto.createHash('sha256').update(`push-action:${getJwtSecret()}`).digest();
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', key()).update(payload).digest('base64url');
}

export function createChatReadToken(userId: string, projectId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const payload = `read.${userId}.${projectId}.${exp}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export function verifyChatReadToken(token: unknown, now = Date.now()): { userId: string; projectId: string } | null {
  if (typeof token !== 'string' || token.length > 400) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [kind, userId, projectId, exp] = payload.split('.');
  if (kind !== 'read' || !/^[a-f0-9]{24}$/.test(userId) || !/^[a-f0-9]{24}$/.test(projectId)) return null;
  if (!Number.isInteger(Number(exp)) || Number(exp) < Math.floor(now / 1000)) return null;
  return { userId, projectId };
}
