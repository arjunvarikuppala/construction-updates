/**
 * Web Push: phone / computer notifications that arrive even when the website
 * (or installed app) is closed.
 *
 * VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set; otherwise
 * a key pair is generated once and stored in the database, so it survives
 * restarts and redeploys without any setup.
 */
import webpush from 'web-push';
import mongoose from 'mongoose';
import { PushSubscription } from '../models/PushSubscription.js';
import { AppConfig } from '../models/AppConfig.js';

type VapidKeys = { publicKey: string; privateKey: string };
let vapid: VapidKeys | null = null;
let loading: Promise<VapidKeys> | null = null;

async function loadVapid(): Promise<VapidKeys> {
  if (vapid) return vapid;
  if (!loading) {
    loading = (async () => {
      const subject = process.env.VAPID_SUBJECT || 'mailto:admin@bkrinfra.in';
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
      } else {
        let doc = await AppConfig.findOne({ key: 'vapid' });
        if (!doc) {
          const keys = webpush.generateVAPIDKeys();
          try {
            doc = await AppConfig.create({ key: 'vapid', value: keys });
          } catch {
            // Another instance created it at the same moment
            doc = await AppConfig.findOne({ key: 'vapid' });
          }
        }
        vapid = { publicKey: doc!.value.publicKey, privateKey: doc!.value.privateKey };
      }
      webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
      return vapid as VapidKeys;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

export async function getVapidPublicKey(): Promise<string> {
  return (await loadVapid()).publicKey;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Page to open when tapped */
  url: string;
  /** Same tag replaces the previous notification (e.g. one per chat) */
  tag?: string;
  /** Notification id, so the app can mark it read */
  id?: string;
  /** 'chat' = a chat message: the phone stacks them per chat like a messaging app */
  kind?: 'chat';
  /** Chat name (project) and sender, for chat messages */
  chat?: string;
  sender?: string;
  /** Absolute link to a photo shown inside the notification */
  image?: string;
  /** When it happened (ms) */
  timestamp?: number;
  /** Unread count for the app-icon badge */
  badge?: number;
  /** "Mark as read" button: where to post and the signed token that allows it */
  actionUrl?: string;
  readToken?: string;
}

/** Public address of this API (for links the phone opens itself). Render sets RENDER_EXTERNAL_URL. */
export function publicApiOrigin(): string {
  return (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
}

const ATTACHMENT_LABEL: Record<string, [string, string]> = {
  image: ['📷 Photo', 'photos'],
  video: ['🎥 Video', 'videos'],
  audio: ['🎤 Voice message', 'voice messages'],
  document: ['📄 Document', 'documents'],
};

function attachmentKind(a: { type?: string; mimeType?: string }): string {
  if (a.type === 'image' || a.type === 'video') return a.type;
  if (a.mimeType?.startsWith('audio/') || a.type === 'audio') return 'audio';
  return 'document';
}

/** "📷 Photo", "📷 3 photos", "🎤 Voice message"… */
export function attachmentPreview(attachments: Array<{ type?: string; mimeType?: string }>): string {
  if (!attachments.length) return '';
  const kinds = attachments.map(attachmentKind);
  const first = kinds[0];
  const [one, many] = ATTACHMENT_LABEL[first];
  if (kinds.every((k) => k === first)) return kinds.length === 1 ? one : `${one.split(' ')[0]} ${kinds.length} ${many}`;
  return `📎 ${attachments.length} attachments`;
}

/**
 * Turns a saved notification into the push the phone shows. Chat messages get
 * the sender as the title, the chat name, a photo preview, the unread badge
 * and a "Mark as read" button; everything else keeps title + message.
 */
export async function buildPushPayload(doc: any): Promise<PushPayload> {
  const { unreadNotificationCount } = await import('./chatReadService.js');
  const projectId = doc.project ? String(doc.project._id || doc.project) : '';
  const payload: PushPayload = {
    title: doc.title,
    body: doc.message,
    url: notificationUrl(doc),
    tag:
      doc.relatedEntity === 'PROJECT_MESSAGE' ? `chat-${projectId}` : `${doc.relatedEntity || 'n'}-${doc.relatedId || doc._id}`,
    id: String(doc._id),
    timestamp: doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now(),
    badge: await unreadNotificationCount(doc.recipient).catch(() => undefined),
  };

  if (doc.type !== 'PROJECT_MESSAGE' || doc.relatedEntity !== 'PROJECT_MESSAGE' || !doc.relatedId || !projectId) return payload;
  const { ProjectMessage } = await import('../models/ProjectMessage.js');
  const { Project } = await import('../models/Project.js');
  const [message, project] = await Promise.all([
    ProjectMessage.findById(doc.relatedId).select('sender content attachments createdAt').populate('sender', 'name').lean(),
    Project.findById(projectId).select('name').lean(),
  ]);
  if (!message) return payload;
  const senderId = String((message.sender as any)?._id || message.sender);
  // A reaction is about the message, not a new message: keep it as a plain alert of its own
  if (!doc.sender || String(doc.sender) !== senderId) {
    payload.tag = `reaction-${doc.relatedId}`;
    return payload;
  }

  const senderName = (message.sender as any)?.name || 'New message';
  const text = (message.content || '').trim();
  const attachments = (message.attachments || []) as any[];
  payload.kind = 'chat';
  payload.title = senderName;
  payload.sender = senderName;
  payload.chat = project?.name || 'Project chat';
  payload.body = text ? (attachments.length ? `${attachmentPreview(attachments).split(' ')[0]} ${text}` : text) : attachmentPreview(attachments);
  payload.timestamp = new Date(message.createdAt).getTime();

  const origin = publicApiOrigin();
  const photo = attachments.find((a) => attachmentKind(a) === 'image');
  if (photo) {
    const { extractLocalFilename, signFilename } = await import('./fileAccessService.js');
    const src = photo.thumbnailUrl || photo.url;
    const filename = extractLocalFilename(src);
    if (filename && origin) payload.image = `${origin}${signFilename(filename, 24 * 60 * 60)}`;
    else if (/^https:\/\//i.test(String(src))) payload.image = src;
  }

  const { createChatReadToken } = await import('./pushActionToken.js');
  payload.readToken = createChatReadToken(String(doc.recipient), projectId);
  payload.actionUrl = `${origin}/api/v1/push/action`;
  return payload;
}

/** Sends to every device of the user. Dead subscriptions are removed. Never throws. */
export async function sendPushToUser(userId: string | mongoose.Types.ObjectId, payload: PushPayload): Promise<number> {
  try {
    const subs = await PushSubscription.find({ user: userId });
    if (!subs.length) return 0;
    await loadVapid();
    const body = JSON.stringify({
      title: payload.title.slice(0, 120),
      body: payload.body.slice(0, 300),
      url: payload.url,
      tag: payload.tag,
      id: payload.id,
      kind: payload.kind,
      chat: payload.chat?.slice(0, 80),
      sender: payload.sender?.slice(0, 80),
      image: payload.image,
      timestamp: payload.timestamp,
      badge: payload.badge,
      actionUrl: payload.actionUrl,
      readToken: payload.readToken,
    });
    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          // web-push encrypts and signs (VAPID); we send it ourselves with a timeout
          const details = webpush.generateRequestDetails(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
            body,
            { TTL: 24 * 3600, urgency: 'high' }
          );
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          let status = 0;
          try {
            const res = await fetch(details.endpoint, {
              method: details.method,
              headers: details.headers as Record<string, string>,
              body: details.body ? new Uint8Array(details.body) : undefined,
              signal: controller.signal,
            });
            status = res.status;
          } finally {
            clearTimeout(timer);
          }
          if (status < 200 || status >= 300) throw Object.assign(new Error(`Push service answered ${status}`), { statusCode: status });
          sent++;
          await PushSubscription.updateOne({ _id: sub._id }, { $set: { lastSuccessAt: new Date(), failures: 0 } });
        } catch (err: any) {
          const code = err?.statusCode;
          if (code === 404 || code === 410) {
            await PushSubscription.deleteOne({ _id: sub._id }); // unsubscribed / expired
          } else {
            const updated = await PushSubscription.findByIdAndUpdate(sub._id, { $inc: { failures: 1 } }, { new: true });
            if (updated && updated.failures >= 10) await PushSubscription.deleteOne({ _id: sub._id });
          }
        }
      })
    );
    return sent;
  } catch (err) {
    console.error('Push send failed:', (err as Error).message);
    return 0;
  }
}

/** Where tapping a notification should take the user. */
export function notificationUrl(n: { relatedEntity?: string; relatedId?: string; project?: any; type?: string }): string {
  const projectId = n.project ? String(n.project._id || n.project) : '';
  // Reminder to write today's report: straight to the report form
  if (n.type === 'DAILY_REPORT_REMINDER') return '/reports/new';
  switch (n.relatedEntity) {
    case 'PAYMENT_REQUEST':
      return n.relatedId ? `/payments?id=${n.relatedId}` : '/payments';
    case 'PROJECT_MESSAGE':
      return projectId ? `/messages/${projectId}` : '/messages';
    case 'DAILY_REPORT':
      return n.relatedId ? `/reports/${n.relatedId}` : '/reports';
    case 'EXPENSE':
      return n.type === 'EXPENSE_SUBMITTED' ? '/approvals' : '/expenses';
    case 'PROJECT':
      return projectId ? `/projects/${projectId}` : '/projects';
    default:
      return '/notifications';
  }
}
