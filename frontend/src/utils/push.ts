/**
 * Phone / computer notifications (Web Push).
 * - Android & desktop Chrome/Edge/Firefox: works in the browser.
 * - iPhone/iPad: only after "Add to Home Screen" (iOS 16.4+), opened from the icon.
 */
import { api, API_ORIGIN } from '../api/client.js';

export type PushState = 'unsupported' | 'ios-needs-install' | 'denied' | 'off' | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'on' : 'off';
}

async function saveSubscription(sub: PushSubscription) {
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
}

/** Ask permission (must be called from a tap) and register this device. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const { publicKey } = await api.get<{ publicKey: string }>('/push/public-key');
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an old key cannot be reused
  const current = sub?.options?.applicationServerKey;
  if (sub && current) {
    const a = new Uint8Array(current as ArrayBuffer);
    const b = urlBase64ToUint8Array(publicKey);
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  await saveSubscription(sub);
  return 'on';
}

/** On every sign-in / app open: re-link this device to whoever is signed in now. */
export async function refreshPushSubscription(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    await enablePush();
  } catch {
    /* offline or blocked — try again next time */
  }
}

/**
 * Turn off on this device (also used on sign-out, so the next person using
 * a shared phone does not get the previous user's notifications).
 */
export async function disablePush(token = localStorage.getItem('sitetrack_token')): Promise<void> {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    if (token) {
      await fetch(`${API_ORIGIN}/api/v1/push/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => undefined);
    }
    await sub.unsubscribe();
  } catch {
    /* ignore */
  }
}

export async function sendTestPush(): Promise<string> {
  const r = await api.post<{ message: string }>('/push/test', {});
  return r.message;
}

/** Same mapping as the server: where a notification should take you. */
export function notificationLink(n: { relatedEntity?: string; relatedId?: string; project?: any; type?: string }): string {
  const projectId = n.project ? String(n.project._id || n.project.id || n.project) : '';
  if (n.type === 'DAILY_REPORT_REMINDER') return '/reports/new';
  switch (n.relatedEntity) {
    case 'PAYMENT_REQUEST':
      return n.relatedId ? `/payments?id=${n.relatedId}` : '/payments';
    case 'PROJECT_MESSAGE':
      return projectId ? `/messages/${projectId}` : '/messages';
    case 'SALARY':
      return n.relatedId ? `/salary?id=${n.relatedId}` : '/salary';
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

/** Short "ding" made in the browser (no sound file needed). */
export function playNotificationSound() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.3);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 800);
  } catch {
    /* audio blocked until the user has tapped the page */
  }
}
