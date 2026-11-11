/**
 * Advanced MD ↔ In-Charge chat features: reactions, message actions, pinned
 * messages, in-conversation search, typing indicator, voice notes and day dividers.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isToday, isYesterday, parseISO, isValid, differenceInCalendarDays } from 'date-fns';
import {
  CornerUpLeft,
  Copy,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  SmilePlus,
  X,
  Search,
  Loader2,
  Mic,
  Square,
  Play,
  Pause,
  Send,
  ChevronDown,
  Image as ImageIcon,
  FileText,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { useDisplayMedia } from '../../utils/media.js';
import { formatDate } from '../../utils/dates.js';
import { MessageAttachment, ProjectMessage } from '../../types/index.js';
import { messageSummary } from './ChatParts.js';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '✅', '👀', '🔥'];
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const idOf = (v: any): string => (v && typeof v === 'object' ? String(v._id || v.id || '') : String(v || ''));

export function canStillModify(m: ProjectMessage): boolean {
  return !m.deletedAt && Date.now() - new Date(m.createdAt).getTime() <= EDIT_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Day dividers
// ---------------------------------------------------------------------------

export function dayKey(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : '';
}

export function dayLabel(iso: string): string {
  const d = parseISO(iso);
  if (!isValid(d)) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  if (differenceInCalendarDays(new Date(), d) < 7) return formatDate(iso, 'EEEE');
  return formatDate(iso, 'dd MMM yyyy');
}

export const DayDivider: React.FC<{ iso: string }> = ({ iso }) => (
  <div className="flex items-center gap-3 py-1 select-none" role="separator" aria-label={dayLabel(iso)}>
    <span className="flex-1 h-px bg-slate-200" />
    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-white border border-slate-200 rounded-full px-2.5 py-0.5 shadow-2xs">
      {dayLabel(iso)}
    </span>
    <span className="flex-1 h-px bg-slate-200" />
  </div>
);

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export const ReactionChips: React.FC<{
  message: ProjectMessage;
  currentUserId: string;
  onToggle: (emoji: string) => void;
}> = ({ message, currentUserId, onToggle }) => {
  const groups = useMemo(() => {
    const map = new Map<string, { emoji: string; names: string[]; mine: boolean }>();
    (message.reactions || []).forEach((r) => {
      const g = map.get(r.emoji) || { emoji: r.emoji, names: [], mine: false };
      const uid = idOf(r.user);
      g.names.push(uid === currentUserId ? 'You' : (typeof r.user === 'object' && r.user?.name) || 'Someone');
      if (uid === currentUserId) g.mine = true;
      map.set(r.emoji, g);
    });
    return Array.from(map.values());
  }, [message.reactions, currentUserId]);

  if (groups.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 -mt-0.5">
      {groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          onClick={() => onToggle(g.emoji)}
          title={`${g.names.join(', ')} reacted ${g.emoji}${g.mine ? ' — click to remove yours' : ''}`}
          aria-label={`${g.emoji} ${g.names.length}. ${g.names.join(', ')}`}
          aria-pressed={g.mine}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border shadow-2xs cursor-pointer transition-colors ${
            g.mine ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <span className="leading-none">{g.emoji}</span>
          {g.names.length > 1 && <span className="text-[10px] font-bold">{g.names.length}</span>}
        </button>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Message actions (hover toolbar on desktop, tap "react/more" on mobile)
// ---------------------------------------------------------------------------

export interface MessageActionHandlers {
  onReply: () => void;
  onReact: (emoji: string) => void;
  onCopy?: () => void;
  onEdit?: () => void;
  onTogglePin: () => void;
  onDelete?: () => void;
}

export const MessageActions: React.FC<
  MessageActionHandlers & { isMine: boolean; isPinned: boolean; open: boolean; onOpenChange: (open: boolean) => void }
> = ({ isMine, isPinned, open, onOpenChange, onReply, onReact, onCopy, onEdit, onTogglePin, onDelete }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dropUp, setDropUp] = useState(false);

  // Open upward when the scrolling message list has no room below the button
  const toggle = () => {
    if (!open && ref.current) {
      const btn = ref.current.getBoundingClientRect();
      const scroller = ref.current.closest('.overflow-y-auto') as HTMLElement | null;
      const bounds = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const below = bounds.bottom - btn.bottom;
      const above = btn.top - bounds.top;
      setDropUp(below < 240 && above > below);
    }
    onOpenChange(!open);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const run = (fn?: () => void) => () => {
    onOpenChange(false);
    fn?.();
  };

  const item = 'w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer text-left min-h-[36px]';

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-full border bg-white text-slate-500 hover:text-amber-600 hover:border-amber-300 shadow-2xs cursor-pointer transition-opacity ${
          open ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100'
        }`}
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <SmilePlus className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-30 ${dropUp ? 'bottom-8' : 'top-8'} ${isMine ? 'right-0' : 'left-0'} w-56 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in`}
        >
          <div className="flex flex-wrap gap-0.5 p-2 border-b border-slate-100">
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={run(() => onReact(e))}
                className="w-8 h-8 rounded-full hover:bg-amber-50 text-lg leading-none flex items-center justify-center cursor-pointer"
                aria-label={`React ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
          <button type="button" role="menuitem" className={item} onClick={run(onReply)}>
            <CornerUpLeft className="w-3.5 h-3.5" /> Reply
          </button>
          {onCopy && (
            <button type="button" role="menuitem" className={item} onClick={run(onCopy)}>
              <Copy className="w-3.5 h-3.5" /> Copy text
            </button>
          )}
          <button type="button" role="menuitem" className={item} onClick={run(onTogglePin)}>
            {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            {isPinned ? 'Unpin' : 'Pin for both'}
          </button>
          {onEdit && (
            <button type="button" role="menuitem" className={item} onClick={run(onEdit)}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          {onDelete && (
            <button type="button" role="menuitem" className={`${item} text-rose-600 hover:bg-rose-50`} onClick={run(onDelete)}>
              <Trash2 className="w-3.5 h-3.5" /> Delete for everyone
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Pinned messages bar
// ---------------------------------------------------------------------------

export const PinnedBar: React.FC<{
  projectId: string;
  onJump: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
}> = ({ projectId, onJump, onUnpin }) => {
  const { data } = useQuery({
    queryKey: ['project-pinned', projectId],
    queryFn: ({ signal }) => api.get<{ messages: ProjectMessage[] }>(`/projects/${projectId}/messages/pinned`, { signal }),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
  const pinned = data?.messages || [];
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [projectId, pinned.length]);

  if (pinned.length === 0) return null;
  const current = pinned[Math.min(index, pinned.length - 1)];
  const { icon, text } = messageSummary(current);

  return (
    <div className="px-3 sm:px-6 py-2 border-b border-amber-200 bg-amber-50/80 flex items-center gap-2 min-w-0 shrink-0">
      <Pin className="w-4 h-4 text-amber-600 shrink-0" />
      <button
        type="button"
        onClick={() => {
          onJump(idOf(current));
          setIndex((i) => (i + 1) % pinned.length);
        }}
        className="flex-1 min-w-0 text-left cursor-pointer"
        title="Go to pinned message"
      >
        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
          Pinned {pinned.length > 1 ? `${index + 1} of ${pinned.length}` : 'message'}
          {current.sender?.name ? ` • ${current.sender.name}` : ''}
        </p>
        <p className="text-xs text-navy-950 truncate flex items-center gap-1">
          {icon === 'image' && <ImageIcon className="w-3 h-3 shrink-0 text-sky-600" />}
          {icon === 'doc' && <FileText className="w-3 h-3 shrink-0 text-amber-600" />}
          {icon === 'audio' && <Mic className="w-3 h-3 shrink-0 text-emerald-600" />}
          <span className="truncate">{text}</span>
        </p>
      </button>
      <button
        type="button"
        onClick={() => onUnpin(idOf(current))}
        className="p-1.5 rounded-full text-amber-700 hover:bg-amber-100 cursor-pointer shrink-0"
        aria-label="Unpin message"
        title="Unpin"
      >
        <PinOff className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// In-conversation search
// ---------------------------------------------------------------------------

type SearchType = 'all' | 'media' | 'docs' | 'voice';

export const ChatSearchPanel: React.FC<{
  projectId: string;
  onClose: () => void;
  onJump: (messageId: string) => void;
}> = ({ projectId, onClose, onJump }) => {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<SearchType>('all');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const enabled = Boolean(projectId) && (debounced.length >= 2 || type !== 'all');
  const { data, isFetching } = useQuery({
    queryKey: ['project-message-search', projectId, debounced, type],
    queryFn: ({ signal }) =>
      api.get<{ messages: ProjectMessage[] }>(
        `/projects/${projectId}/messages/search?q=${encodeURIComponent(debounced)}&type=${type}`,
        { signal }
      ),
    enabled,
  });
  const results = enabled ? data?.messages || [] : [];

  const highlight = (text: string) => {
    if (!debounced) return text;
    const i = text.toLowerCase().indexOf(debounced.toLowerCase());
    if (i < 0) return text;
    const start = Math.max(0, i - 40);
    return (
      <>
        {start > 0 && '…'}
        {text.slice(start, i)}
        <mark className="bg-amber-200 text-navy-950 rounded px-0.5">{text.slice(i, i + debounced.length)}</mark>
        {text.slice(i + debounced.length, i + debounced.length + 80)}
      </>
    );
  };

  const filters: Array<{ id: SearchType; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'media', label: 'Photos & videos' },
    { id: 'docs', label: 'Documents' },
    { id: 'voice', label: 'Voice notes' },
  ];

  return (
    <div className="border-b border-slate-200 bg-white shrink-0 flex flex-col max-h-[50vh]">
      <div className="px-3 sm:px-6 py-2 flex items-center gap-2">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder="Search this conversation…"
          aria-label="Search messages"
          className="flex-1 min-w-0 text-sm py-1.5 outline-none bg-transparent"
        />
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
        <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500 cursor-pointer" aria-label="Close search">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-3 sm:px-6 pb-2 flex gap-1.5 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setType(f.id)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap cursor-pointer ${
              type === f.id ? 'bg-navy-950 text-white border-navy-950' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {enabled && (
        <ul className="overflow-y-auto border-t border-slate-100 divide-y divide-slate-100">
          {results.length === 0 && !isFetching ? (
            <li className="px-6 py-4 text-xs text-slate-400">No matching messages.</li>
          ) : (
            results.map((m) => {
              const { text } = messageSummary(m);
              return (
                <li key={idOf(m)}>
                  <button
                    type="button"
                    onClick={() => onJump(idOf(m))}
                    className="w-full text-left px-3 sm:px-6 py-2 hover:bg-amber-50/60 cursor-pointer"
                  >
                    <p className="text-[10px] text-slate-500">
                      <strong className="text-slate-700">{m.sender?.name}</strong> • {formatDate(m.createdAt, 'dd MMM yyyy, hh:mm a')}
                    </p>
                    <p className="text-xs text-navy-950 truncate">{highlight(text)}</p>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------

export const TypingIndicator: React.FC<{ names: string[] }> = ({ names }) => {
  if (names.length === 0) return null;
  const label = names.length === 1 ? `${names[0]} is typing` : `${names.slice(0, 2).join(' and ')} are typing`;
  return (
    <div className="px-3 sm:px-6 py-1 text-[11px] text-slate-500 flex items-center gap-2 bg-white" aria-live="polite">
      <span className="inline-flex gap-0.5" aria-hidden="true">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce" />
      </span>
      <span className="font-medium">{label}…</span>
    </div>
  );
};

/**
 * Emits typing:start at most every 2.5 s while the user types and typing:stop
 * after 3 s of inactivity (or immediately via stop()).
 */
export function useTypingEmitter(socket: any, projectId: string) {
  const lastSent = useRef(0);
  const idleTimer = useRef<number | null>(null);
  const active = useRef(false);

  const stop = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (active.current && socket && projectId) socket.emit('typing:stop', { projectId });
    active.current = false;
    lastSent.current = 0;
  }, [socket, projectId]);

  const ping = useCallback(() => {
    if (!socket || !projectId) return;
    const now = Date.now();
    if (now - lastSent.current > 2500) {
      socket.emit('typing:start', { projectId });
      lastSent.current = now;
      active.current = true;
    }
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(stop, 3000);
  }, [socket, projectId, stop]);

  useEffect(() => stop, [stop]);
  return { ping, stop };
}

/** Tracks who else is typing in the project (auto-expires after 6 s without a refresh). */
export function useTypingUsers(socket: any, projectId: string, currentUserId: string): string[] {
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});

  useEffect(() => {
    setTyping({});
    if (!socket || !projectId) return;
    const onUpdate = (d: { projectId: string; userId: string; name: string; isTyping: boolean }) => {
      if (String(d.projectId) !== String(projectId) || d.userId === currentUserId) return;
      setTyping((prev) => {
        const next = { ...prev };
        if (d.isTyping) next[d.userId] = { name: d.name, until: Date.now() + 6000 };
        else delete next[d.userId];
        return next;
      });
    };
    // A message from someone also means they stopped typing
    const onMessage = (m: any) => {
      const sid = idOf(m?.sender);
      setTyping((prev) => {
        if (!prev[sid]) return prev;
        const next = { ...prev };
        delete next[sid];
        return next;
      });
    };
    socket.on('typing:update', onUpdate);
    socket.on('message:new', onMessage);
    const sweep = window.setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const entries = Object.entries(prev).filter(([, v]) => v.until > now);
        return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
      });
    }, 1500);
    return () => {
      socket.off('typing:update', onUpdate);
      socket.off('message:new', onMessage);
      window.clearInterval(sweep);
    };
  }, [socket, projectId, currentUserId]);

  return Object.values(typing).map((t) => t.name);
}

// ---------------------------------------------------------------------------
// Voice notes
// ---------------------------------------------------------------------------

const MAX_VOICE_SECONDS = 5 * 60;

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function pickRecorderMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const MR: any = (window as any).MediaRecorder;
  if (!MR?.isTypeSupported) return '';
  return candidates.find((c) => MR.isTypeSupported(c)) || '';
}

export function isVoiceRecordingSupported(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).MediaRecorder) && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Replaces the composer while recording. Sends the clip on "send", discards on "cancel". */
export const VoiceRecorder: React.FC<{
  onSend: (file: File, durationSeconds: number) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}> = ({ onSend, onCancel, onError }) => {
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const sendOnStop = useRef(false);

  const cleanup = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const mime = pickRecorderMime();
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        recorderRef.current = rec;
        rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
        rec.onstop = () => {
          cleanup();
          if (!sendOnStop.current) return;
          const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const blob = new Blob(chunksRef.current, { type });
          const duration = (Date.now() - startedAt.current) / 1000;
          if (blob.size === 0 || duration < 1) {
            onError('Voice note too short — hold on a little longer.');
            onCancel();
            return;
          }
          const stamp = formatDate(new Date(), 'yyyyMMdd-HHmmss');
          onSend(new File([blob], `voice-note-${stamp}.${ext}`, { type }), duration);
        };
        rec.start(250);
        startedAt.current = Date.now();
        setReady(true);
      } catch {
        onError('Microphone access was blocked. Allow the microphone in your browser to send voice notes.');
        onCancel();
      }
    })();
    return () => {
      cancelled = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        sendOnStop.current = false;
        recorderRef.current.stop();
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = window.setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSeconds(s);
      if (s >= MAX_VOICE_SECONDS) finish(true);
    }, 250);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const finish = (send: boolean) => {
    sendOnStop.current = send;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    if (!send) onCancel();
  };

  return (
    <div className="flex items-center gap-2 w-full" role="group" aria-label="Recording voice note">
      <button
        type="button"
        onClick={() => finish(false)}
        className="p-2.5 min-w-[42px] min-h-[42px] flex items-center justify-center rounded-xl text-rose-600 hover:bg-rose-50 cursor-pointer"
        aria-label="Discard voice note"
        title="Discard"
      >
        <Trash2 className="w-5 h-5" />
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50 min-h-[42px]">
        <span className={`w-2.5 h-2.5 rounded-full bg-rose-500 ${ready ? 'animate-pulse' : 'opacity-40'}`} />
        <span className="text-sm font-mono font-bold text-rose-700">{formatClock(seconds)}</span>
        <span className="text-xs text-rose-600 truncate">{ready ? 'Recording… tap send when done' : 'Starting microphone…'}</span>
        <span className="ml-auto text-[10px] text-rose-400 font-mono hidden sm:inline">max {formatClock(MAX_VOICE_SECONDS)}</span>
      </div>
      <button
        type="button"
        onClick={() => finish(true)}
        disabled={!ready}
        className="min-w-[44px] min-h-[42px] flex items-center justify-center rounded-xl bg-navy-950 hover:bg-navy-900 disabled:opacity-50 cursor-pointer"
        aria-label="Send voice note"
        title="Send voice note"
      >
        <Send className="w-4 h-4 text-amber-400" />
      </button>
    </div>
  );
};

/** Compact voice-note player that streams the private file through a signed URL. */
export const VoiceNotePlayer: React.FC<{ attachment: MessageAttachment; dark: boolean }> = ({ attachment, dark }) => {
  const { url, loading, retryWithFallback } = useDisplayMedia(attachment.url);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number>(attachment.duration || 0);
  const [rate, setRate] = useState(1);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div className={`flex items-center gap-2.5 p-2 rounded-xl min-w-[220px] ${dark ? 'bg-white/10' : 'bg-slate-50 border border-slate-200'}`}>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onError={() => retryWithFallback()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrent(0);
          }}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
          }}
        />
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        className="w-9 h-9 rounded-full bg-amber-500 hover:bg-amber-400 text-navy-950 flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50"
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          onChange={(e) => {
            const v = Number(e.target.value);
            setCurrent(v);
            if (audioRef.current) audioRef.current.currentTime = v;
          }}
          className="w-full accent-amber-500 h-1 cursor-pointer"
          aria-label="Seek voice note"
          style={{ background: `linear-gradient(to right, #f59e0b ${pct}%, transparent ${pct}%)` }}
        />
        <div className={`flex items-center justify-between text-[10px] font-mono mt-0.5 ${dark ? 'text-slate-300' : 'text-slate-500'}`}>
          <span className="flex items-center gap-1">
            <Mic className="w-3 h-3" />
            {formatClock(playing || current > 0 ? current : duration)}
          </span>
          <button type="button" onClick={cycleRate} className="font-bold hover:text-amber-500 cursor-pointer" aria-label="Playback speed">
            {rate}×
          </button>
        </div>
      </div>
    </div>
  );
};

/** Bar above the composer while editing a message. */
export const EditComposerBar: React.FC<{ target: ProjectMessage; onCancel: () => void }> = ({ target, onCancel }) => (
  <div className="px-3 sm:px-6 py-2 bg-sky-50 border-t border-sky-200 flex items-center gap-2 min-w-0">
    <Pencil className="w-4 h-4 text-sky-600 shrink-0" />
    <div className="flex-1 min-w-0 border-l-4 border-sky-400 pl-2">
      <p className="text-[11px] font-bold text-navy-950">Editing message</p>
      <p className="text-[11px] text-slate-500 truncate">{target.content}</p>
    </div>
    <button
      type="button"
      onClick={onCancel}
      className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full text-slate-400 hover:text-rose-600 hover:bg-slate-200 cursor-pointer"
      aria-label="Cancel edit"
    >
      <X className="w-4 h-4" />
    </button>
  </div>
);

/** Floating "jump to latest" button with unread count. */
export const JumpToLatest: React.FC<{ count: number; onClick: () => void }> = ({ count, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 pl-2.5 pr-3 py-2 rounded-full bg-navy-950 text-white text-xs font-bold shadow-lg hover:bg-navy-900 cursor-pointer animate-in fade-in"
    aria-label={count > 0 ? `${count} new messages, jump to latest` : 'Jump to latest'}
  >
    <ChevronDown className="w-4 h-4 text-amber-400" />
    {count > 0 ? `${count} new` : 'Latest'}
  </button>
);

