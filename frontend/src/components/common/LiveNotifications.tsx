import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, BellRing, CreditCard, ClipboardList, Receipt, X, Smartphone, SendHorizontal, Check, CornerUpLeft } from 'lucide-react';
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
  /** Chat messages: one popup per chat, updated as new messages arrive */
  chat?: {
    projectId: string;
    chatName: string;
    sender: string;
    count: number;
  };
}

const ICON: Record<string, React.ElementType> = {
  PAYMENT_REQUEST: CreditCard,
  DAILY_REPORT: ClipboardList,
  EXPENSE: Receipt,
};

const SHOW_MS = 8000;
const CHAT_SHOW_MS = 10000;

/** Fired by SocketContext for every new notification */
export const LIVE_NOTIFICATION_EVENT = 'bkr:notification';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Tell the phone's notification tray this chat was read (same device). */
export function clearChatNotifications(projectId: string) {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-chat', projectId });
  } catch {
    /* no service worker */
  }
}

/** One chat banner, WhatsApp style, with a quick reply box. */
const ChatBanner: React.FC<{
  item: LiveItem;
  onOpen: () => void;
  onDismiss: () => void;
  onHold: (hold: boolean) => void;
}> = ({ item, onOpen, onDismiss, onHold }) => {
  const chat = item.chat!;
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (replying) inputRef.current?.focus();
  }, [replying]);

  const send = async () => {
    const content = text.trim();
    if (!content || state === 'sending') return;
    setState('sending');
    try {
      await api.post(`/projects/${chat.projectId}/messages`, {
        content,
        clientMessageId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined,
      });
      api.put(`/projects/${chat.projectId}/messages/read`, {}).catch(() => undefined);
      clearChatNotifications(chat.projectId);
      setState('sent');
      setText('');
      window.setTimeout(onDismiss, 1200);
    } catch {
      setState('error');
    }
  };

  return (
    <div
      className="rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden animate-in slide-in-from-top-2"
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => !replying && onHold(false)}
    >
      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex items-start gap-3 flex-1 min-w-0 text-left"
          aria-label={`Open chat ${chat.chatName}`}
        >
          <span className="relative shrink-0">
            <span className="w-10 h-10 rounded-full bg-navy-900 text-white flex items-center justify-center text-sm font-bold">
              {initials(chat.sender)}
            </span>
            {chat.count > 1 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-white">
                {chat.count}
              </span>
            )}
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-baseline gap-1.5">
              <span className="text-sm font-bold text-navy-950 truncate">{chat.sender}</span>
              <span className="text-[11px] text-slate-500 shrink-0">now</span>
            </span>
            <span className="block text-[11px] font-semibold text-brand-700 truncate">{chat.chatName}</span>
            <span className="block text-[13px] text-slate-700 line-clamp-2 mt-0.5">{item.message}</span>
            {chat.count > 1 && (
              <span className="block text-[11px] text-slate-500 mt-0.5">{chat.count} new messages in this chat</span>
            )}
          </span>
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="w-8 h-8 -mr-1 -mt-1 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {replying ? (
        <form
          className="flex items-center gap-2 px-3 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (state === 'error') setState('idle');
            }}
            placeholder={`Reply to ${chat.chatName}`}
            aria-label={`Reply to ${chat.chatName}`}
            maxLength={2000}
            disabled={state === 'sending' || state === 'sent'}
            className="flex-1 min-w-0 h-10 rounded-full border border-slate-300 bg-slate-50 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-navy-500/20 focus:border-navy-500"
          />
          <button
            type="submit"
            aria-label="Send reply"
            disabled={!text.trim() || state === 'sending' || state === 'sent'}
            className="w-10 h-10 rounded-full bg-brand-600 hover:bg-brand-700 text-white flex items-center justify-center shrink-0 disabled:opacity-50"
          >
            {state === 'sent' ? <Check className="w-4 h-4" /> : <SendHorizontal className="w-4 h-4" />}
          </button>
        </form>
      ) : (
        <div className="flex border-t border-slate-100 text-sm font-semibold">
          <button
            type="button"
            onClick={() => {
              setReplying(true);
              onHold(true);
            }}
            className="flex-1 min-h-[42px] flex items-center justify-center gap-1.5 text-navy-900 hover:bg-slate-50"
          >
            <CornerUpLeft className="w-4 h-4" />
            Reply
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="flex-1 min-h-[42px] border-l border-slate-100 text-navy-900 hover:bg-slate-50"
          >
            Open chat
          </button>
        </div>
      )}
      {state === 'error' && <p className="px-4 pb-3 -mt-1 text-xs font-semibold text-rose-700">Not sent — check your connection and try again.</p>}
      {state === 'sent' && <p className="px-4 pb-3 -mt-1 text-xs font-semibold text-emerald-700">Sent</p>}
    </div>
  );
};

/**
 * While the website is open: a popup with a sound for every new message,
 * payment request, report or approval. Chat messages look like a messaging
 * app (sender, chat name, grouped per chat) and can be answered right there.
 */
export const LiveNotifications: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const myIdRef = useRef('');
  myIdRef.current = String(user?.id || (user as any)?._id || '');
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const [items, setItems] = useState<LiveItem[]>([]);
  const timers = useRef(new Map<string, number>());
  // Banners being read or replied to stay open
  const held = useRef(new Set<string>());

  const remove = useCallback((key: string) => {
    const t = timers.current.get(key);
    if (t) window.clearTimeout(t);
    timers.current.delete(key);
    held.current.delete(key);
    setItems((prev) => prev.filter((x) => x.key !== key));
  }, []);

  const schedule = useCallback(
    (key: string, ms: number) => {
      const t = timers.current.get(key);
      if (t) window.clearTimeout(t);
      timers.current.delete(key);
      if (held.current.has(key)) return;
      timers.current.set(key, window.setTimeout(() => remove(key), ms));
    },
    [remove]
  );

  const hold = useCallback(
    (key: string, on: boolean) => {
      if (on) held.current.add(key);
      else held.current.delete(key);
      schedule(key, CHAT_SHOW_MS);
    },
    [schedule]
  );

  useEffect(() => {
    const onNotif = (e: Event) => {
      const n: any = (e as CustomEvent).detail;
      if (!n) return;
      // Never pop up your own message
      const senderId = n.sender ? String(n.sender._id || n.sender) : '';
      if (senderId && senderId === myIdRef.current) return;
      const link = notificationLink(n);
      // Already looking at that chat: the message appears on screen, no popup
      if (n.relatedEntity === 'PROJECT_MESSAGE' && pathRef.current === link) return;

      const senderName: string = typeof n.sender === 'object' ? n.sender?.name || '' : '';
      const projectId: string = n.project ? String(n.project._id || n.project) : '';
      const isChatMessage = n.type === 'PROJECT_MESSAGE' && projectId && senderName && !/ reacted /.test(n.title || '');

      if (isChatMessage) {
        const prefix = `${senderName}: `;
        const text = (n.message || '').startsWith(prefix) ? n.message.slice(prefix.length) : n.message || '';
        const key = `chat-${projectId}`;
        setItems((prev) => {
          const existing = prev.find((x) => x.key === key);
          const next: LiveItem = {
            key,
            id: n._id || n.id,
            title: senderName,
            message: text,
            link,
            entity: 'PROJECT_MESSAGE',
            chat: {
              projectId,
              chatName: n.project?.name || 'Project chat',
              sender: senderName,
              count: (existing?.chat?.count || 0) + 1,
            },
          };
          return [next, ...prev.filter((x) => x.key !== key)].slice(0, 3);
        });
        schedule(key, CHAT_SHOW_MS);
      } else {
        const key = `${n._id || n.id || Date.now()}-${Math.random()}`;
        const item: LiveItem = {
          key,
          id: n._id || n.id,
          title: n.title || 'BKR INFRA',
          message: n.message || '',
          link,
          entity: n.relatedEntity,
        };
        setItems((prev) => [item, ...prev].slice(0, 3));
        schedule(key, SHOW_MS);
      }
      playNotificationSound();
      if (navigator.vibrate) navigator.vibrate(80);
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
  }, [navigate, schedule]);

  // A popup for a chat you just opened is no longer news
  useEffect(() => {
    setItems((prev) => prev.filter((x) => !(x.chat && location.pathname === x.link)));
  }, [location.pathname]);

  const open = (item: LiveItem) => {
    remove(item.key);
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
        if (item.chat) {
          return (
            <ChatBanner
              key={item.key}
              item={item}
              onOpen={() => open(item)}
              onDismiss={() => remove(item.key)}
              onHold={(on) => hold(item.key, on)}
            />
          );
        }
        const Icon = ICON[item.entity || ''] || Bell;
        return (
          <div
            key={item.key}
            className="flex items-start gap-3 p-3 rounded-2xl bg-white border border-slate-200 shadow-2xl animate-in slide-in-from-top-2"
          >
            <button type="button" onClick={() => open(item)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
              <span className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-sm font-bold text-navy-950 truncate">{item.title}</span>
                  <span className="text-[11px] text-slate-500 shrink-0">now</span>
                </span>
                <span className="block text-[13px] text-slate-700 line-clamp-2">{item.message}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => remove(item.key)}
              className="w-8 h-8 -mr-1 -mt-1 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"
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
