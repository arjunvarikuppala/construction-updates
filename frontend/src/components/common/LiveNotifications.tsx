import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, BellRing, MessageSquare, CreditCard, ClipboardList, Receipt, X, Smartphone } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.js';
import { enablePush, getPushState, notificationLink, playNotificationSound, PushState, refreshPushSubscription } from '../../utils/push.js';

interface LiveItem {
  key: string;
  id?: string;
  title: string;
  message: string;
  link: string;
  entity?: string;
  sender?: string;
}

const ICON: Record<string, React.ElementType> = {
  PROJECT_MESSAGE: MessageSquare,
  PAYMENT_REQUEST: CreditCard,
  DAILY_REPORT: ClipboardList,
  EXPENSE: Receipt,
};

/** Fired by SocketContext for every new notification */
export const LIVE_NOTIFICATION_EVENT = 'bkr:notification';

/**
 * While the website is open: a popup with a sound for every new message,
 * payment request, report or approval. Tapping it opens the item.
 */
export const LiveNotifications: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const [items, setItems] = useState<LiveItem[]>([]);

  useEffect(() => {
    const onNotif = (e: Event) => {
      const n: any = (e as CustomEvent).detail;
      if (!n) return;
      const link = notificationLink(n);
      // Already looking at that chat: the message appears on screen, no popup
      if (n.relatedEntity === 'PROJECT_MESSAGE' && pathRef.current === link) return;
      const item: LiveItem = {
        key: `${n._id || n.id || Date.now()}-${Math.random()}`,
        id: n._id || n.id,
        title: n.title || 'BKR INFRA',
        message: n.message || '',
        link,
        entity: n.relatedEntity,
        sender: typeof n.sender === 'object' ? n.sender?.name : undefined,
      };
      setItems((prev) => [item, ...prev].slice(0, 3));
      playNotificationSound();
      if (navigator.vibrate) navigator.vibrate(80);
      window.setTimeout(() => setItems((prev) => prev.filter((x) => x.key !== item.key)), 8000);
    };
    // A tapped phone notification while the app is already open
    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open-url' && typeof e.data.url === 'string') {
        const u = new URL(e.data.url);
        if (u.origin === window.location.origin) navigate(u.pathname + u.search);
      }
    };
    window.addEventListener(LIVE_NOTIFICATION_EVENT, onNotif);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);
    return () => {
      window.removeEventListener(LIVE_NOTIFICATION_EVENT, onNotif);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [navigate]);

  const open = (item: LiveItem) => {
    setItems((prev) => prev.filter((x) => x.key !== item.key));
    if (item.id) api.put(`/notifications/${item.id}/read`, {}).catch(() => undefined);
    navigate(item.link);
  };

  if (!items.length) return null;
  return (
    <div
      className="fixed z-[60] top-[calc(4.5rem+env(safe-area-inset-top,0px))] md:top-4 left-3 right-3 md:left-auto md:right-4 md:w-96 space-y-2"
      aria-live="polite"
    >
      {items.map((item) => {
        const Icon = ICON[item.entity || ''] || Bell;
        return (
          <div
            key={item.key}
            role="button"
            tabIndex={0}
            onClick={() => open(item)}
            onKeyDown={(e) => e.key === 'Enter' && open(item)}
            className="flex items-start gap-3 p-3 rounded-2xl bg-white border border-slate-200 shadow-2xl cursor-pointer hover:border-amber-400 animate-in slide-in-from-top-2"
          >
            <div className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-navy-950 truncate">{item.title}</p>
              <p className="text-xs text-slate-600 line-clamp-2">{item.message}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                setItems((prev) => prev.filter((x) => x.key !== item.key));
              }}
              className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

const DISMISS_KEY = 'bkr-push-prompt-dismissed-at';

/**
 * Asks once (after sign-in) to turn on phone / computer notifications, so new
 * messages and requests arrive even when the website is closed.
 */
export const EnableNotificationsPrompt: React.FC = () => {
  const { user } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return Date.now() - at < 3 * 24 * 3600 * 1000;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!user) return;
    // Keep this device linked to whoever is signed in
    refreshPushSubscription().finally(() => getPushState().then(setState));
  }, [user]);

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  if (!user || hidden || !state || !['off', 'ios-needs-install'].includes(state)) return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await enablePush();
      setState(next);
      if (next === 'on') {
        new Notification('Notifications are on', { body: 'You will be told about new messages and requests.', icon: '/icons/icon-192.png' });
      }
    } catch {
      setState('off');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed z-40 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 left-3 right-3 md:left-auto md:right-6 md:max-w-sm bg-navy-900 text-white p-4 rounded-2xl shadow-2xl border border-navy-700/80">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0">
          {state === 'ios-needs-install' ? <Smartphone className="w-5 h-5" /> : <BellRing className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold">Get notified instantly</h4>
          <p className="text-xs text-navy-200 mt-0.5">
            {state === 'ios-needs-install'
              ? 'On iPhone: tap Share → “Add to Home Screen”, open BKR INFRA from the icon, then turn on notifications.'
              : `Get a notification on this ${/Mobi|Android/i.test(navigator.userAgent) ? 'phone' : 'computer'} for new messages, payment requests, reports and approvals — even when the website is closed.`}
          </p>
        </div>
        <button onClick={dismiss} aria-label="Close" className="text-navy-300 hover:text-white p-1 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      {state === 'off' && (
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={dismiss} className="min-h-[36px] px-3 rounded-lg text-xs font-semibold text-navy-200 hover:text-white">
            Later
          </button>
          <button
            onClick={turnOn}
            disabled={busy}
            className="min-h-[36px] px-4 rounded-lg text-xs font-bold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Turning on…' : 'Turn on notifications'}
          </button>
        </div>
      )}
    </div>
  );
};
