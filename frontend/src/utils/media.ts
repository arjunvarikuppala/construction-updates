/**
 * Private media URLs.
 *
 * Uploaded receipts, invoices and site photos are not publicly served. Before
 * rendering, the app exchanges stored URLs for short-lived signed URLs via
 * POST /files/sign (the server checks project-level access). Requests made in
 * the same tick are batched; results are cached until shortly before expiry.
 */
import { useEffect, useState } from 'react';
import { api, API_ORIGIN } from '../api/client.js';

const CACHE_SAFETY_MS = 5 * 60 * 1000;

interface CacheEntry {
  url: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
let pending = new Map<string, Array<(url: string | null) => void>>();
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
      const res = await api.post<{ signed: Record<string, string | null>; expiresIn: number }>('/files/sign', {
        urls: chunk,
      });
      const expiresAt = Date.now() + (res.expiresIn || 3600) * 1000 - CACHE_SAFETY_MS;
      chunk.forEach((u) => {
        const signed = res.signed?.[u];
        const value = signed ? absolutize(signed) : null;
        cache.set(u, { url: value, expiresAt });
        batch.get(u)?.forEach((cb) => cb(value));
      });
    } catch {
      chunk.forEach((u) => batch.get(u)?.forEach((cb) => cb(null)));
    }
  }
}

/** Resolve a stored media URL to something the browser can load. */
export function resolveMediaUrl(url: string | undefined | null): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  if (isExternalUrl(url)) return Promise.resolve(url);

  const hit = cache.get(url);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);

  return new Promise((resolve) => {
    const list = pending.get(url) || [];
    list.push(resolve);
    pending.set(url, list);
    if (!flushTimer) flushTimer = setTimeout(flush, 0);
  });
}

export type MediaState = { url: string | null; loading: boolean; denied: boolean };

/** React hook returning a loadable URL for a stored (possibly private) media URL. */
export function useMediaUrl(url: string | undefined | null): MediaState {
  const [state, setState] = useState<MediaState>(() => {
    if (!url) return { url: null, loading: false, denied: false };
    if (isExternalUrl(url)) return { url, loading: false, denied: false };
    const hit = cache.get(url);
    if (hit && hit.expiresAt > Date.now()) return { url: hit.url, loading: false, denied: !hit.url };
    return { url: null, loading: true, denied: false };
  });

  useEffect(() => {
    let alive = true;
    if (!url) {
      setState({ url: null, loading: false, denied: false });
      return;
    }
    resolveMediaUrl(url).then((resolved) => {
      if (alive) setState({ url: resolved, loading: false, denied: !resolved });
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
