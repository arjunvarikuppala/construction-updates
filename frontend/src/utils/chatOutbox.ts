/**
 * Outbox for chat messages typed without a network connection.
 *
 * Text messages that can't be delivered are kept on the device (per user, wiped on
 * sign-out) and sent automatically when the connection returns. Each one keeps its
 * clientMessageId, so a retry can never create a duplicate on the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { ProjectMessage } from '../types/index.js';

export interface OutboxItem {
  clientMessageId: string;
  projectId: string;
  content: string;
  replyToMessageId?: string;
  replyPreview?: string;
  contextType?: string;
  contextId?: string;
  contextSummary?: string;
  createdAt: string;
  status: 'waiting' | 'sending' | 'failed';
  error?: string;
}

const storageKey = (userId: string) => `bkr-offline:${userId}:outbox`;
const CHANGE_EVENT = 'bkr-outbox-change';

function readAll(userId: string): OutboxItem[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId)) || '[]');
  } catch {
    return [];
  }
}

function writeAll(userId: string, items: OutboxItem[]): void {
  try {
    if (items.length) localStorage.setItem(storageKey(userId), JSON.stringify(items));
    else localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** A network failure (no answer from the server), as opposed to the server refusing. */
export function isNetworkError(err: any): boolean {
  return !err?.status && (err instanceof TypeError || /network|fetch|failed to fetch|load failed/i.test(String(err?.message || '')) || navigator.onLine === false);
}

export function useChatOutbox(
  userId: string | undefined,
  isConnected: boolean,
  onDelivered: (projectId: string, message: ProjectMessage) => void
) {
  const [items, setItems] = useState<OutboxItem[]>(() => (userId ? readAll(userId) : []));
  const flushing = useRef(false);
  const deliveredRef = useRef(onDelivered);
  deliveredRef.current = onDelivered;

  useEffect(() => {
    if (!userId) return;
    const sync = () => setItems(readAll(userId));
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId]);

  const update = useCallback(
    (fn: (list: OutboxItem[]) => OutboxItem[]) => {
      if (userId) writeAll(userId, fn(readAll(userId)));
    },
    [userId]
  );

  const enqueue = useCallback(
    (item: Omit<OutboxItem, 'createdAt' | 'status'>) =>
      update((list) =>
        list.some((i) => i.clientMessageId === item.clientMessageId)
          ? list
          : [...list, { ...item, createdAt: new Date().toISOString(), status: 'waiting' }]
      ),
    [update]
  );

  const remove = useCallback(
    (clientMessageId: string) => update((list) => list.filter((i) => i.clientMessageId !== clientMessageId)),
    [update]
  );

  /** Send everything waiting, oldest first. Stops at the first network failure. */
  const flush = useCallback(async () => {
    if (!userId || flushing.current || navigator.onLine === false) return;
    flushing.current = true;
    try {
      for (const item of readAll(userId)) {
        if (item.status === 'failed') continue;
        update((list) => list.map((i) => (i.clientMessageId === item.clientMessageId ? { ...i, status: 'sending' } : i)));
        try {
          const res: any = await api.post(`/projects/${item.projectId}/messages`, {
            content: item.content,
            replyToMessageId: item.replyToMessageId,
            clientMessageId: item.clientMessageId,
            contextType: item.contextType,
            contextId: item.contextId,
            contextSummary: item.contextSummary,
          });
          remove(item.clientMessageId);
          if (res?.data?._id) deliveredRef.current(item.projectId, res.data);
        } catch (err: any) {
          if (isNetworkError(err)) {
            update((list) => list.map((i) => (i.clientMessageId === item.clientMessageId ? { ...i, status: 'waiting' } : i)));
            break;
          }
          update((list) =>
            list.map((i) =>
              i.clientMessageId === item.clientMessageId
                ? { ...i, status: 'failed', error: err?.message || 'The server refused this message' }
                : i
            )
          );
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [userId, update, remove]);

  const retry = useCallback(
    (clientMessageId: string) => {
      update((list) => list.map((i) => (i.clientMessageId === clientMessageId ? { ...i, status: 'waiting', error: undefined } : i)));
      void flush();
    },
    [update, flush]
  );

  // Send when the network or the live connection comes back, on open, and every 30 s while waiting
  useEffect(() => {
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flush]);
  useEffect(() => {
    if (isConnected) void flush();
  }, [isConnected, flush]);
  const waiting = items.some((i) => i.status === 'waiting');
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => void flush(), 30000);
    return () => window.clearInterval(t);
  }, [waiting, flush]);

  return { items, enqueue, remove, retry, flush };
}
