import { useCallback, useEffect, useRef } from 'react';

/**
 * Device-local autosave for the daily report form.
 *
 * Safety model (no sync conflicts, no silent data loss):
 * - The form is saved to localStorage on this device only, keyed by user and
 *   report, so nothing is ever auto-sent to the server.
 * - On reopen, the user is offered the local copy explicitly and chooses to
 *   restore or discard it; server data is never overwritten automatically.
 * - The local copy is cleared only after the server confirms a save.
 */
export interface StoredDraft<T> {
  savedAt: number;
  /** server updatedAt the local edits were based on (for edit mode) */
  baseUpdatedAt?: string;
  data: T;
}

const PREFIX = 'sitetrack_report_draft:';

export function localDraftKey(userId: string | undefined, reportId: string | null): string {
  return `${PREFIX}${userId || 'anon'}:${reportId || 'new'}`;
}

export function readLocalDraft<T>(key: string): StoredDraft<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.data ? parsed : null;
  } catch {
    return null;
  }
}

export function clearLocalDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** Debounced writer. `enabled` lets the form pause autosave until it has loaded. */
export function useLocalDraftWriter<T>(key: string, data: T, enabled: boolean, baseUpdatedAt?: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    try {
      const payload: StoredDraft<T> = { savedAt: Date.now(), baseUpdatedAt, data };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      /* quota exceeded or storage blocked — autosave is best-effort */
    }
  }, [key, data, baseUpdatedAt]);

  useEffect(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush, enabled]);

  // Persist immediately when the tab is hidden / app backgrounded
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush, enabled]);
}
