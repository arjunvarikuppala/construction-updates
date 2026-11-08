import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../types/index.js';
import { PushSubscription } from '../models/PushSubscription.js';
import { getVapidPublicKey, sendPushToUser } from '../services/pushService.js';

const router = Router();
router.use(authenticate);

/** Public key the browser needs to subscribe */
router.get('/public-key', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true, publicKey: await getVapidPublicKey() });
  } catch {
    res.status(500).json({ success: false, message: 'Notifications are not available right now.' });
  }
});

/** Chrome/Edge/Android (FCM), Firefox, Edge/Windows (WNS) and Safari/iOS push hosts */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

function isPushServiceUrl(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (process.env.NODE_ENV === 'test' && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true;
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

function cleanSubscription(raw: any) {
  const endpoint = typeof raw?.endpoint === 'string' ? raw.endpoint.trim() : '';
  const p256dh = typeof raw?.keys?.p256dh === 'string' ? raw.keys.p256dh : '';
  const auth = typeof raw?.keys?.auth === 'string' ? raw.keys.auth : '';
  // Only the browsers' real push services — never let a client make the server call arbitrary URLs
  if (endpoint.length > 2048 || !isPushServiceUrl(endpoint)) return null;
  if (!/^[A-Za-z0-9_-]{40,200}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,64}={0,2}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** Save this device for the signed-in user (re-assigns it if someone else used the device before) */
router.post('/subscribe', async (req: AuthenticatedRequest, res: Response) => {
  const sub = cleanSubscription(req.body?.subscription);
  if (!sub) {
    res.status(400).json({ success: false, message: 'Invalid push subscription.' });
    return;
  }
  await PushSubscription.findOneAndUpdate(
    { endpoint: sub.endpoint },
    {
      $set: {
        user: req.user!.userId,
        keys: sub.keys,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        failures: 0,
      },
    },
    { upsert: true, new: true }
  );
  res.json({ success: true, message: 'Notifications are on for this device.' });
});

/** Turn off for this device (also called on sign-out so the next user of a shared phone gets nothing) */
router.post('/unsubscribe', async (req: AuthenticatedRequest, res: Response) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
  if (endpoint) await PushSubscription.deleteOne({ endpoint, user: req.user!.userId });
  res.json({ success: true });
});

/** Send a test notification to all of my devices */
router.post('/test', async (req: AuthenticatedRequest, res: Response) => {
  const sent = await sendPushToUser(req.user!.userId, {
    title: 'BKR INFRA notifications are on',
    body: 'You will get a notification like this for new messages, payment requests, reports and approvals.',
    url: '/notifications',
    tag: 'test',
  });
  res.json({
    success: sent > 0,
    sent,
    message: sent > 0 ? `Test sent to ${sent} device(s).` : 'No device is set up for notifications yet.',
  });
});

export default router;
