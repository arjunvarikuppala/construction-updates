/**
 * Offline reading for project chats.
 *
 * The latest messages of recently opened chats (and the project list) are kept in this
 * device's storage, per signed-in user, so a chat opens instantly and can be read with
 * no signal. Photos/videos themselves are not stored; text, names and dates are.
 * Everything is wiped on sign-out.
 */
import { useEffect, useState } from 'react';
import type { MessagePage } from './chatHistory.js';

const PREFIX = 'bkr-offline:';
const MAX_CHATS = 8;
const MAX_MESSAGES = 60;

interface Saved<T> {
  savedAt: number;
  data: T;
}

const key = (userId: string, name: string) => `${PREFIX}${userId}:${name}`;

function read<T>(userId: string | undefined, name: string): Saved<T> | undefined {
  if (!userId) return undefined;
  try {
    const raw = localStorage.getItem(key(userId, name));
    return raw ? (JSON.parse(raw) as Saved<T>) : undefined;
  } catch {
    return undefined;
  }
}

function write<T>(userId: string | undefined, name: string, data: T): void {
  if (!userId) return;
  const value = JSON.stringify({ savedAt: Date.now(), data } satisfies Saved<T>);
  try {
    localStorage.setItem(key(userId, name), value);
  } catch {
    // Storage full: drop this user's oldest saved chat and try once more
    evictOldestChat(userId);
    try {
      localStorage.setItem(key(userId, name), value);
    } catch {
      /* give up quietly: offline copy is a convenience */
    }
  }
}

function chatKeys(userId: string): Array<{ k: string; savedAt: number }> {
  const out: Array<{ k: string; savedAt: number }> = [];
  const prefix = key(userId, 'chat:');
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    try {
      out.push({ k, savedAt: JSON.parse(localStorage.getItem(k) || '{}').savedAt || 0 });
    } catch {
      out.push({ k, savedAt: 0 });
    }
  }
  return out.sort((a, b) => a.savedAt - b.savedAt);
}

function evictOldestChat(userId: string): void {
  const oldest = chatKeys(userId)[0];
  if (oldest) localStorage.removeItem(oldest.k);
}

/** Saved copy of a project's latest messages, if any. */
export function loadSavedChat(userId: string | undefined, projectId: string): Saved<MessagePage> | undefined {
  return projectId ? read<MessagePage>(userId, `chat:${projectId}`) : undefined;
}

/** Keep the newest messages of this chat on the device (older pages load online). */
export function saveChat(userId: string | undefined, projectId: string, page: MessagePage | undefined): void {
  if (!userId || !projectId || !page?.messages?.length) return;
  const messages = page.messages.slice(-MAX_MESSAGES);
  write<MessagePage>(userId, `chat:${projectId}`, {
    messages,
    count: messages.length,
    hasMore: Boolean(page.hasMore) || page.messages.length > MAX_MESSAGES,
  });
  try {
    const keys = chatKeys(userId);
    for (let i = 0; i < keys.length - MAX_CHATS; i++) localStorage.removeItem(keys[i].k);
  } catch {
    /* ignore */
  }
}

export function loadSavedProjects<T>(userId: string | undefined): Saved<T> | undefined {
  return read<T>(userId, 'projects');
}

export function saveProjects<T>(userId: string | undefined, data: T): void {
  write(userId, 'projects', data);
}

/** Remove every offline copy on this device (called on sign-out). */
export function clearOfflineData(): void {
  try {
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) remove.push(k);
    }
    remove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** true while the device has no network connection. */
export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return offline;
}
