/**
 * Private media URLs.
 *
 * Uploaded receipts, invoices and site photos are not publicly served. Before
 * rendering, the app exchanges stored URLs for short-lived signed URLs via
 * POST /files/sign (the server checks project-level access). Requests made in
 * the same tick are batched; results are cached until shortly before expiry.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, API_ORIGIN } from '../api/client.js';

const CACHE_SAFETY_MS = 5 * 60 * 1000;

interface CacheEntry {
  url: string | null;
  /** Short-lived link straight to cloud storage (photos/videos in Cloudinary), if any. */
  direct?: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
let pending = new Map<string, Array<(entry: CacheEntry | null) => void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function isExternalUrl(url: string): boolean {
  return /^(https?:|blob:|data:)/i.test(url);
}

function absolutize(path: string): string {
  return isExternalUrl(path) ? path : `${API_ORIGIN}${path}`;
}

async function flush() {
  flushTimer = null;
  const batch = pending;
  pending = new Map();
  const urls = Array.from(batch.keys());

  for (let i = 0; i < urls.length; i += 100) {
    const chunk = urls.slice(i, i + 100);
    try {
      const res = await api.post<{
        signed: Record<string, string | null>;
        direct?: Record<string, string>;
        expiresIn: number;
      }>('/files/sign', { urls: chunk, direct: true });
      const expiresAt = Date.now() + (res.expiresIn || 3600) * 1000 - CACHE_SAFETY_MS;
      chunk.forEach((u) => {
        const signed = res.signed?.[u];
        const entry: CacheEntry = {
          url: signed ? absolutize(signed) : null,
          direct: signed ? res.direct?.[u] || null : null,
          expiresAt,
        };
        cache.set(u, entry);
        batch.get(u)?.forEach((cb) => cb(entry));
      });
    } catch {
      chunk.forEach((u) => batch.get(u)?.forEach((cb) => cb(null)));
    }
  }
}

function resolveEntry(url: string): Promise<CacheEntry | null> {
  const hit = cache.get(url);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const list = pending.get(url) || [];
    list.push(resolve);
    pending.set(url, list);
    if (!flushTimer) flushTimer = setTimeout(flush, 0);
  });
}

/**
 * Resolve a stored media URL to something the browser can load. Always the app's own
 * signed link (works with fetch/download/new tab), never the direct cloud link.
 */
export function resolveMediaUrl(url: string | undefined | null): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  if (isExternalUrl(url)) return Promise.resolve(url);
  return resolveEntry(url).then((e) => e?.url ?? null);
}

export type MediaState = {
  /** Best URL to display: the direct cloud link when available, else the app's signed link. */
  url: string | null;
  /** The app's own signed link, used if the direct link fails to load. */
  fallbackUrl: string | null;
  loading: boolean;
  denied: boolean;
};

function stateFor(entry: CacheEntry | null): MediaState {
  const fallbackUrl = entry?.url ?? null;
  return { url: entry?.direct || fallbackUrl, fallbackUrl, loading: false, denied: !fallbackUrl };
}

/** React hook returning a loadable URL for a stored (possibly private) media URL. */
export function useMediaUrl(url: string | undefined | null): MediaState {
  const [state, setState] = useState<MediaState>(() => {
    if (!url) return { url: null, fallbackUrl: null, loading: false, denied: false };
    if (isExternalUrl(url)) return { url, fallbackUrl: url, loading: false, denied: false };
    const hit = cache.get(url);
    if (hit && hit.expiresAt > Date.now()) return stateFor(hit);
    return { url: null, fallbackUrl: null, loading: true, denied: false };
  });

  useEffect(() => {
    let alive = true;
    if (!url) {
      setState({ url: null, fallbackUrl: null, loading: false, denied: false });
      return;
    }
    if (isExternalUrl(url)) {
      setState({ url, fallbackUrl: url, loading: false, denied: false });
      return;
    }
    resolveEntry(url).then((entry) => {
      if (alive) setState(stateFor(entry));
    });
    return () => {
      alive = false;
    };
  }, [url]);

  return state;
}

/** Open a private file in a new tab (used for receipts/invoices). */
export async function openMedia(url: string | undefined | null): Promise<boolean> {
  // Open synchronously to avoid popup blockers, then navigate once signed.
  // ('noopener' in the features string would make window.open return null.)
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  const resolved = await resolveMediaUrl(url);
  if (!resolved) {
    win?.close();
    return false;
  }
  if (win) win.location.href = resolved;
  return Boolean(win);
}

export function isVideoUrl(url: string | undefined | null): boolean {
  return !!url && /\.(mp4|webm|mov|mkv|avi|3gp)($|\?)/i.test(url);
}

export function isPdfUrl(url: string | undefined | null): boolean {
  return !!url && /\.pdf($|\?)/i.test(url);
}

/**
 * useMediaUrl plus automatic fallback: if the direct cloud link fails to load,
 * `retryWithFallback()` switches to the app's own signed link (returns true when it did).
 */
export function useDisplayMedia(src: string | undefined | null) {
  const state = useMediaUrl(src);
  const [onFallback, setOnFallback] = useState(false);
  useEffect(() => setOnFallback(false), [state.url]);
  const url = onFallback ? state.fallbackUrl : state.url;
  const retryWithFallback = useCallback((): boolean => {
    if (!onFallback && state.fallbackUrl && state.fallbackUrl !== state.url) {
      setOnFallback(true);
      return true;
    }
    return false;
  }, [onFallback, state.fallbackUrl, state.url]);
  return { ...state, url, retryWithFallback };
}
