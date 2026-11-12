/**
 * Project gallery: every site photo / video the in-charge attached to the project's
 * daily reports, grouped by report date (newest first).
 *
 * - Tap a photo to view it full size (prev / next, caption, who posted it, open report).
 * - Long-press a photo (or tap "Select") to pick photos, then Share them to WhatsApp or
 *   any other app through the phone's share sheet. The real files are shared, not links,
 *   because the photos are private to signed-in users.
 * - Where the device can't share files (most laptops), Share downloads them instead.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  X,
  Images,
  Film,
  Play,
  Share2,
  Download,
  CheckCircle2,
  Circle,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  LoaderCircle,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { formatDate } from '../../utils/dates.js';
import { isVideoUrl, resolveMediaUrl } from '../../utils/media.js';
import { SecureImage, SecureVideo } from '../common/SecureMedia.js';
import { downloadSecureFile } from '../chat/ChatParts.js';
import { useToast } from '../../context/ToastContext.js';

/** WhatsApp accepts at most 30 media in one share */
export const MAX_SHARE = 30;
const LONG_PRESS_MS = 450;

interface PhotoGroup {
  reportId: string;
  workDate: string;
  titleOfWork: string;
  postedBy: string;
  photos: Array<{ url: string; caption?: string; uploadedAt?: string }>;
}

interface PhotosPage {
  groups: PhotoGroup[];
  hasMore: boolean;
  nextCursor: { before: string; beforeId: string } | null;
  totals?: { photos: number; reports: number };
}

interface Item {
  key: string;
  url: string;
  caption?: string;
  workDate: string;
  postedBy: string;
  reportId: string;
  isVideo: boolean;
}

type Range = 'all' | 'week' | 'month';
const RANGES: Array<{ id: Range; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

/** YYYY-MM-DD in India time */
const istDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
function rangeFrom(range: Range): string {
  if (range === 'all') return '';
  const today = istDay(new Date());
  if (range === 'month') return `${today.slice(0, 8)}01`;
  return istDay(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
}

const safeName = (s: string) => s.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site';

function extFor(url: string, type: string): string {
  const m = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(url.split('#')[0]);
  if (m) return m[1].toLowerCase();
  if (type.startsWith('video/')) return 'mp4';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

function mimeFor(ext: string, fallback: string): string {
  if (fallback && fallback !== 'application/octet-stream') return fallback;
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp',
  };
  return map[ext] || 'image/jpeg';
}

/** Can this browser hand files to the share sheet? (Android/iOS: yes; most desktops: no) */
function canShareFiles(): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
    return navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export const ProjectPhotoGallery: React.FC<Props> = ({ projectId, projectName, onClose }) => {
  const navigate = useNavigate();
  const toast = useToast();
  const [range, setRange] = useState<Range>('all');
  const [viewing, setViewing] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]); // item keys, in tap order
  const [busy, setBusy] = useState<'share' | 'download' | null>(null);
  const [readyFiles, setReadyFiles] = useState<File[] | null>(null);
  const shareSupported = useMemo(canShareFiles, []);
  const fileCache = useRef(new Map<string, Promise<File | null>>());

  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['project-photos', projectId, range],
    initialPageParam: null as PhotosPage['nextCursor'],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '20' });
      const from = rangeFrom(range);
      if (from) params.set('from', from);
      if (pageParam) {
        params.set('before', pageParam.before);
        params.set('beforeId', pageParam.beforeId);
      }
      return api.get<PhotosPage>(`/projects/${projectId}/photos?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : null),
  });

  const groups = useMemo(() => data?.pages.flatMap((p) => p.groups) || [], [data]);
  const totals = data?.pages[0]?.totals;
  const items = useMemo<Item[]>(
    () =>
      groups.flatMap((g) =>
        g.photos.map((p, i) => ({
          key: `${g.reportId}:${i}`,
          url: p.url,
          caption: p.caption,
          workDate: g.workDate,
          postedBy: g.postedBy,
          reportId: g.reportId,
          isVideo: isVideoUrl(p.url),
        }))
      ),
    [groups]
  );
  const indexOf = useMemo(() => new Map(items.map((it, i) => [it.key, i])), [items]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Lock page scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Changing the filter clears the selection (the photos on screen change)
  useEffect(() => {
    setSelected([]);
    setReadyFiles(null);
  }, [range]);

  /** Download one photo as a File (cached, so selecting starts fetching early). */
  const fileFor = useCallback(
    (item: Item, n: number): Promise<File | null> => {
      const hit = fileCache.current.get(item.key);
      if (hit) return hit;
      const p = (async () => {
        const signed = await resolveMediaUrl(item.url);
        if (!signed) return null;
        const res = await fetch(signed);
        if (!res.ok) return null;
        const blob = await res.blob();
        const ext = extFor(item.url, blob.type);
        const date = formatDate(item.workDate, 'dd-MMM-yyyy');
        return new File([blob], `${safeName(projectName)}-${date}-${n}.${ext}`, { type: mimeFor(ext, blob.type) });
      })().catch(() => null);
      fileCache.current.set(item.key, p);
      // A failed download shouldn't stay cached
      p.then((f) => !f && fileCache.current.delete(item.key));
      return p;
    },
    [projectName]
  );

  const toggle = useCallback(
    (key: string) => {
      setReadyFiles(null);
      setSelected((cur) => {
        if (cur.includes(key)) return cur.filter((k) => k !== key);
        if (cur.length >= MAX_SHARE) {
          toast.info(`You can share up to ${MAX_SHARE} photos at a time`);
          return cur;
        }
        // Start fetching now so Share opens straight away
        if (shareSupported) {
          const it = items[indexOf.get(key) ?? -1];
          if (it) void fileFor(it, cur.length + 1);
        }
        return [...cur, key];
      });
    },
    [items, indexOf, fileFor, shareSupported, toast]
  );

  const exitSelect = () => {
    setSelecting(false);
    setSelected([]);
    setReadyFiles(null);
  };

  const selectAll = () => {
    const keys = items.slice(0, MAX_SHARE).map((i) => i.key);
    if (items.length > MAX_SHARE) toast.info(`Selected the first ${MAX_SHARE} — the most you can share at once`);
    setReadyFiles(null);
    setSelected(keys);
    if (shareSupported) items.slice(0, MAX_SHARE).forEach((it, i) => void fileFor(it, i + 1));
  };

  const shareText = () => {
    const picked = selected.map((k) => items[indexOf.get(k) ?? -1]).filter(Boolean) as Item[];
    const dates = Array.from(new Set(picked.map((p) => formatDate(p.workDate, 'dd MMM yyyy'))));
    return `${projectName} – site photos${dates.length === 1 ? `, ${dates[0]}` : dates.length > 1 ? `, ${dates[dates.length - 1]} to ${dates[0]}` : ''}`;
  };

  const doShare = async (files: File[]) => {
    try {
      await navigator.share({ files, title: `${projectName} site photos`, text: shareText() });
      setReadyFiles(null);
      exitSelect();
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // closed the share sheet
      if (err?.name === 'NotAllowedError') {
        // Downloading took too long for the browser to still count the tap: one more tap shares
        setReadyFiles(files);
        toast.info('Photos are ready. Tap Share again.');
        return;
      }
      toast.error('Could not open sharing on this device. Try Download instead.');
    }
  };

  const onShare = async () => {
    if (selected.length === 0) return;
    if (!shareSupported) {
      toast.info('This device can’t share photos to apps. Downloading them instead.');
      return onDownload();
    }
    if (readyFiles) return doShare(readyFiles);
    setBusy('share');
    const picked = selected.map((k) => items[indexOf.get(k) ?? -1]).filter(Boolean) as Item[];
    const files = (await Promise.all(picked.map((it, i) => fileFor(it, i + 1)))).filter((f): f is File => !!f);
    setBusy(null);
    if (files.length === 0) {
      toast.error('Could not load the selected photos. Check your connection and try again.');
      return;
    }
    if (files.length < picked.length) toast.info(`${picked.length - files.length} photo(s) could not be loaded and were left out`);
    if (!navigator.canShare({ files })) {
      toast.error('These files are too large to share together. Select fewer photos.');
      return;
    }
    await doShare(files);
  };

  const onDownload = async () => {
    if (selected.length === 0) return;
    setBusy('download');
    const picked = selected.map((k) => items[indexOf.get(k) ?? -1]).filter(Boolean) as Item[];
    let failed = 0;
    for (let i = 0; i < picked.length; i++) {
      const it = picked[i];
      const ext = extFor(it.url, it.isVideo ? 'video/mp4' : 'image/jpeg');
      const ok = await downloadSecureFile(it.url, `${safeName(projectName)}-${formatDate(it.workDate, 'dd-MMM-yyyy')}-${i + 1}.${ext}`);
      if (!ok) failed++;
      // Browsers drop back-to-back downloads fired in the same instant
      await new Promise((r) => setTimeout(r, 350));
    }
    setBusy(null);
    if (failed) toast.error(`${failed} photo(s) could not be downloaded`);
    else toast.success(picked.length === 1 ? 'Photo downloaded' : `${picked.length} photos downloaded`);
  };

  // Esc: viewer first, then select mode, then the gallery
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewing !== null) setViewing(null);
        else if (selecting) exitSelect();
        else onClose();
      } else if (viewing !== null && e.key === 'ArrowLeft') setViewing((v) => (v === null ? v : Math.max(0, v - 1)));
      else if (viewing !== null && e.key === 'ArrowRight') setViewing((v) => (v === null ? v : Math.min(items.length - 1, v + 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing, selecting, items.length, onClose]);

  // Load the next page of reports when the viewer reaches the last loaded photo
  useEffect(() => {
    if (viewing !== null && viewing >= items.length - 2 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [viewing, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (hasNextPage && !isFetchingNextPage && el.scrollHeight - el.scrollTop - el.clientHeight < 500) void fetchNextPage();
  };

  // Long-press to start selecting (touch and mouse)
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const startPress = (key: string) => {
    press.current.fired = false;
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = setTimeout(() => {
      press.current.fired = true;
      setSelecting(true);
      toggle(key);
      if (navigator.vibrate) navigator.vibrate(30);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
  };
  const onTileClick = (key: string) => {
    if (press.current.fired) {
      press.current.fired = false;
      return; // the long-press already selected it
    }
    if (selecting) toggle(key);
    else setViewing(indexOf.get(key) ?? null);
  };

  const current = viewing !== null ? items[viewing] : null;
  const subtitle = totals
    ? `${totals.photos} ${totals.photos === 1 ? 'photo' : 'photos'} from ${totals.reports} daily ${totals.reports === 1 ? 'report' : 'reports'}`
    : 'Photos from daily reports';

  const content = (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-navy-950/40"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${projectName} site photos`}
    >
      <div className="w-full md:w-[600px] h-full bg-white flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] border-b border-slate-200">
          {selecting ? (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-navy-950">{selected.length ? `${selected.length} selected` : 'Select photos'}</p>
                <p className="text-[11px] text-slate-500 truncate">{projectName}</p>
              </div>
              <button type="button" onClick={selectAll} className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-navy-950 hover:bg-slate-50 cursor-pointer">
                Select all
              </button>
              <button type="button" onClick={exitSelect} className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-navy-950 hover:bg-slate-50 cursor-pointer">
                Cancel
              </button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-navy-950 truncate">{projectName} · site photos</p>
                <p className="text-[11px] text-slate-500">{subtitle}</p>
              </div>
              {items.length > 0 && (
                <button type="button" onClick={() => setSelecting(true)} className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-navy-950 hover:bg-slate-50 cursor-pointer">
                  Select
                </button>
              )}
              <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer" aria-label="Close gallery">
                <X className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {/* Date filter */}
        <div className="flex gap-1.5 px-4 py-2 border-b border-slate-100">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`px-3 py-1 rounded-full text-xs font-bold cursor-pointer border ${
                range === r.id ? 'bg-navy-950 text-white border-navy-950' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Photos */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 select-none" onScroll={onScroll}>
          {isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-lg bg-slate-200 animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm text-slate-600">{(error as any)?.message || 'Could not load site photos.'}</p>
              <button type="button" onClick={() => refetch()} className="px-3 py-1.5 rounded-xl bg-navy-950 text-white text-xs font-bold cursor-pointer">
                Retry
              </button>
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <Images className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-sm text-slate-500">
                {range === 'all' ? 'No site photos yet. Photos added to daily reports will appear here.' : 'No site photos in this period.'}
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.reportId}>
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <h3 className="text-xs font-bold text-navy-950">{formatDate(g.workDate, 'dd MMM yyyy')}</h3>
                  <span className="text-[11px] text-slate-500 truncate">
                    {g.photos.length} {g.photos.length === 1 ? 'photo' : 'photos'} · {g.postedBy}
                  </span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {g.photos.map((p, i) => {
                    const key = `${g.reportId}:${i}`;
                    const isSel = selectedSet.has(key);
                    const video = isVideoUrl(p.url);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onTileClick(key)}
                        onPointerDown={() => startPress(key)}
                        onPointerUp={cancelPress}
                        onPointerLeave={cancelPress}
                        onPointerCancel={cancelPress}
                        onContextMenu={(e) => e.preventDefault()}
                        aria-pressed={selecting ? isSel : undefined}
                        aria-label={`${p.caption || (video ? 'Site video' : 'Site photo')}, ${formatDate(g.workDate, 'dd MMM yyyy')}`}
                        className={`relative aspect-square rounded-lg overflow-hidden bg-slate-800 cursor-pointer group [-webkit-touch-callout:none] ${
                          isSel ? 'ring-[3px] ring-brand-600 ring-inset' : ''
                        }`}
                      >
                        {video ? (
                          <span className="absolute inset-0 flex items-center justify-center text-slate-300">
                            <Film className="w-7 h-7" />
                          </span>
                        ) : (
                          <SecureImage
                            src={p.url}
                            alt={p.caption || 'Site photo'}
                            draggable={false}
                            className={`w-full h-full object-cover transition-transform ${isSel ? 'scale-95' : 'group-hover:scale-105'}`}
                          />
                        )}
                        {video && (
                          <span className="absolute inset-0 flex items-center justify-center">
                            <span className="w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center">
                              <Play className="w-4 h-4 ml-0.5" />
                            </span>
                          </span>
                        )}
                        {selecting && (
                          <span className="absolute top-1.5 right-1.5 rounded-full bg-white/90">
                            {isSel ? <CheckCircle2 className="w-5 h-5 text-brand-600" /> : <Circle className="w-5 h-5 text-slate-400" />}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
          {isFetchingNextPage && (
            <div className="flex justify-center py-3 text-slate-400">
              <LoaderCircle className="w-5 h-5 animate-spin" />
            </div>
          )}
        </div>

        {/* Share bar */}
        {selecting && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-slate-200 bg-white">
            <span className="text-[11px] text-slate-500">Up to {MAX_SHARE} at a time</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onDownload}
                disabled={!selected.length || !!busy}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 text-navy-950 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                {busy === 'download' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download
              </button>
              <button
                type="button"
                onClick={onShare}
                disabled={!selected.length || !!busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 cursor-pointer"
              >
                {busy === 'share' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                {busy === 'share' ? 'Preparing…' : `Share${selected.length ? ` (${selected.length})` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Full-size viewer */}
      {current && viewing !== null && (
        <PhotoViewer
          item={current}
          index={viewing}
          total={totals?.photos ?? items.length}
          hasPrev={viewing > 0}
          hasNext={viewing < items.length - 1}
          onPrev={() => setViewing(viewing - 1)}
          onNext={() => setViewing(viewing + 1)}
          onClose={() => setViewing(null)}
          onOpenReport={() => {
            onClose();
            navigate(`/reports/${current.reportId}`);
          }}
          onDownload={() =>
            void downloadSecureFile(
              current.url,
              `${safeName(projectName)}-${formatDate(current.workDate, 'dd-MMM-yyyy')}.${extFor(current.url, current.isVideo ? 'video/mp4' : 'image/jpeg')}`
            )
          }
          onShare={
            shareSupported
              ? async () => {
                  const f = await fileFor(current, 1);
                  if (!f) return toast.error('Could not load this photo. Check your connection and try again.');
                  try {
                    await navigator.share({ files: [f], title: `${projectName} site photo`, text: `${projectName} – site photo, ${formatDate(current.workDate, 'dd MMM yyyy')}` });
                  } catch (err: any) {
                    if (err?.name === 'NotAllowedError') toast.info('Photo is ready. Tap Share again.');
                    else if (err?.name !== 'AbortError') toast.error('Could not open sharing on this device.');
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );

  return createPortal(content, document.body);
};

const PhotoViewer: React.FC<{
  item: Item;
  index: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onOpenReport: () => void;
  onDownload: () => void;
  onShare?: () => void;
}> = ({ item, index, total, hasPrev, hasNext, onPrev, onNext, onClose, onOpenReport, onDownload, onShare }) => {
  const touchX = useRef<number | null>(null);
  return (
    <div
      data-overlay="viewer"
      className="fixed inset-0 z-[60] bg-navy-950/95 flex flex-col"
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (dx > 60 && hasPrev) onPrev();
        else if (dx < -60 && hasNext) onNext();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      <div className="flex items-center gap-2 px-2 sm:px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] text-white shrink-0">
        <button type="button" onClick={onClose} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-white/10 cursor-pointer" aria-label="Back to gallery">
          <X className="w-5 h-5" />
        </button>
        <span className="flex-1 text-xs font-semibold text-slate-300">
          {index + 1} / {total}
        </span>
        {onShare && (
          <button type="button" onClick={onShare} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-white/10 cursor-pointer" aria-label="Share">
            <Share2 className="w-5 h-5" />
          </button>
        )}
        <button type="button" onClick={onDownload} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-white/10 cursor-pointer" aria-label="Download">
          <Download className="w-5 h-5" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-14">
        {item.isVideo ? (
          <SecureVideo key={item.key} src={item.url} controls autoPlay playsInline className="max-h-full max-w-full bg-black rounded-xl" />
        ) : (
          <SecureImage key={item.key} src={item.url} alt={item.caption || 'Site photo'} className="max-h-full max-w-full object-contain" />
        )}
        {hasPrev && (
          <button type="button" onClick={onPrev} className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center cursor-pointer" aria-label="Previous photo">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {hasNext && (
          <button type="button" onClick={onNext} className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white items-center justify-center cursor-pointer" aria-label="Next photo">
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      <div className="px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] text-white shrink-0 space-y-0.5">
        {item.caption && <p className="text-sm font-semibold">{item.caption}</p>}
        <p className="text-[11px] text-slate-300">
          {formatDate(item.workDate, 'dd MMM yyyy')} · posted by {item.postedBy} ·{' '}
          <button type="button" onClick={onOpenReport} className="inline-flex items-center gap-0.5 font-bold text-amber-300 hover:underline cursor-pointer">
            Open report <ArrowUpRight className="w-3 h-3" />
          </button>
        </p>
      </div>
    </div>
  );
};
