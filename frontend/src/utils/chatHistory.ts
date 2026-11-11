/**
 * Project chat history window.
 *
 * The cache for ['project-messages', projectId] holds a contiguous slice of the
 * conversation: the latest page plus any older pages the user scrolled back to.
 * These helpers keep that slice consistent when the latest page is refetched,
 * older pages are added, or read receipts arrive over the live connection.
 */
import type { ProjectMessage } from '../types/index.js';

export const CHAT_PAGE_SIZE = 50;

export interface MessagePage {
  success?: boolean;
  count?: number;
  /** More (older) messages exist before the first one in `messages`. */
  hasMore?: boolean;
  messages: ProjectMessage[];
}

const idOf = (m: any): string => String(m?._id || m?.id || '');

/** Chronological order with the id as a tie-breaker (matches the server's cursor). */
export function compareMessages(a: ProjectMessage, b: ProjectMessage): number {
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  const ia = idOf(a);
  const ib = idOf(b);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * Merge a freshly fetched latest page into the cached window, keeping older pages the
 * user already loaded. If the fresh page doesn't reach back to anything cached (many
 * messages arrived while offline), the window restarts from the fresh page so it never
 * has a silent gap in the middle.
 */
export function mergeLatestPage(old: MessagePage | undefined, fresh: MessagePage): MessagePage {
  const freshMessages = fresh.messages || [];
  if (!old?.messages?.length || freshMessages.length === 0) return fresh;

  const freshIds = new Set(freshMessages.map(idOf));
  const overlaps = old.messages.some((m) => freshIds.has(idOf(m)));
  if (!overlaps && fresh.hasMore) return fresh;

  const freshOldest = freshMessages[0];
  const olderPart = old.messages.filter((m) => !freshIds.has(idOf(m)) && compareMessages(m, freshOldest) < 0);
  if (olderPart.length === 0) return fresh;
  return {
    ...fresh,
    messages: [...olderPart, ...freshMessages],
    count: olderPart.length + freshMessages.length,
    hasMore: old.hasMore,
  };
}

/** Add an older page in front of the cached window (duplicates are dropped). */
export function prependOlderPage(old: MessagePage | undefined, older: ProjectMessage[], hasMore: boolean): MessagePage {
  const current = old?.messages || [];
  const have = new Set(current.map(idOf));
  const extra = older.filter((m) => !have.has(idOf(m)));
  const messages = [...extra, ...current].sort(compareMessages);
  return { ...(old || {}), messages, count: messages.length, hasMore };
}

/** Add one message (live or just sent) to the end of the window, once. */
export function appendMessage(old: MessagePage | undefined, message: ProjectMessage): MessagePage | undefined {
  if (!old || !Array.isArray(old.messages)) return old;
  const id = idOf(message);
  if (old.messages.some((m) => idOf(m) === id)) return old;
  const messages = [...old.messages, message].sort(compareMessages);
  return { ...old, messages, count: messages.length };
}

/** Replace one message in place (edit / delete / reaction / pin). */
export function replaceMessage(old: MessagePage | undefined, message: ProjectMessage): MessagePage | undefined {
  if (!old || !Array.isArray(old.messages)) return old;
  const id = idOf(message);
  return { ...old, messages: old.messages.map((m) => (idOf(m) === id ? message : m)) };
}

/**
 * Someone opened the chat: mark every message they didn't send as read by them,
 * without reloading the conversation.
 */
export function applySeen(
  old: MessagePage | undefined,
  reader: { readerId: string; readerName?: string; readerRole?: string; readAt?: string }
): MessagePage | undefined {
  if (!old || !Array.isArray(old.messages) || !reader.readerId) return old;
  const readAt = reader.readAt || new Date().toISOString();
  let changed = false;
  const messages = old.messages.map((m) => {
    if (idOf(m.sender) === reader.readerId) return m;
    if ((m.readBy || []).some((r: any) => idOf(r.user) === reader.readerId)) return m;
    changed = true;
    return {
      ...m,
      readBy: [
        ...(m.readBy || []),
        { user: { _id: reader.readerId, name: reader.readerName, role: reader.readerRole } as any, readAt },
      ],
    };
  });
  return changed ? { ...old, messages } : old;
}
