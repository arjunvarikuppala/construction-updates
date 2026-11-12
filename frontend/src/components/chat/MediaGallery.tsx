/**
 * Project "Media · Docs · Voice" gallery: every photo, video, document and voice note
 * shared in a project chat, newest first, grouped by month.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { X, Images, FileText, Mic, Play, Film, Download, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { api } from '../../api/client.js';
import type { MessageAttachment } from '../../types/index.js';
import { formatDate } from '../../utils/dates.js';
import { SecureImage, SecureVideo } from '../common/SecureMedia.js';
import { VoiceNotePlayer, formatClock } from './AdvancedChat.js';
import { formatFileSize } from './ChatParts.js';

export type GalleryTab = 'media' | 'docs' | 'voice';

interface GalleryItem {
  messageId: string;
  createdAt: string;
  sender?: { _id?: string; name?: string; role?: string };
  attachment: MessageAttachment;
}

interface GalleryPage {
  items: GalleryItem[];
  hasMore: boolean;
  nextCursor: { before: string; beforeId: string } | null;
}

const TABS: Array<{ id: GalleryTab; label: string; icon: React.ElementType }> = [
  { id: 'media', label: 'Media', icon: Images },
  { id: 'docs', label: 'Docs', icon: FileText },
  { id: 'voice', label: 'Voice', icon: Mic },
];

const EMPTY_TEXT: Record<GalleryTab, string> = {
  media: 'No photos or videos have been shared in this project yet.',
  docs: 'No documents have been shared in this project yet.',
  voice: 'No voice notes have been sent in this project yet.',
};

interface Props {
  projectId: string;
  projectName?: string;
  onClose: () => void;
  onOpenImage: (url: string, name: string) => void;
  onOpenDoc: (attachment: MessageAttachment) => void;
  onDownload: (e: React.MouseEvent, url: string, name: string) => void;
  onJump: (messageId: string) => void;
}

const senderLabel = (s?: GalleryItem['sender']) =>
  `${s?.name || 'Unknown'}${s?.role ? ` · ${s.role === 'MD' || s.role === 'OWNER' ? 'MD' : 'Site Engineer'}` : ''}`;

export const MediaGallery: React.FC<Props> = ({ projectId, projectName, onClose, onOpenImage, onOpenDoc, onDownload, onJump }) => {
  const [tab, setTab] = useState<GalleryTab>('media');
  const [playing, setPlaying] = useState<GalleryItem | null>(null);

  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['project-gallery', projectId, tab],
    initialPageParam: null as GalleryPage['nextCursor'],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ type: tab, limit: '40' });
      if (pageParam) {
        params.set('before', String(pageParam.before));
        params.set('beforeId', String(pageParam.beforeId));
      }
      return api.get<GalleryPage>(`/projects/${projectId}/messages/gallery?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : null),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A photo / document opened from here is on top: Esc closes that one first
      if (document.querySelector('[data-overlay="viewer"]')) return;
      if (playing) setPlaying(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, onClose]);

  // Group by month: "November 2026"
  const groups = useMemo(() => {
    const items = data?.pages.flatMap((p) => p.items) || [];
    const out: Array<{ label: string; items: GalleryItem[] }> = [];
    for (const item of items) {
      const label = formatDate(item.createdAt, 'MMMM yyyy');
      if (out.length === 0 || out[out.length - 1].label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push(item);
    }
    return out;
  }, [data]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (hasNextPage && !isFetchingNextPage && el.scrollHeight - el.scrollTop - el.clientHeight < 400) void fetchNextPage();
  };

  const jump = (messageId: string) => {
    onClose();
    onJump(messageId);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-navy-950/40" onClick={onClose} role="dialog" aria-modal="true" aria-label="Shared media, documents and voice notes">
      <div className="w-full md:w-[520px] h-full bg-white flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-navy-950">Shared in this project</p>
            {projectName && <p className="text-[11px] text-slate-500 truncate">{projectName}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 pt-2 border-b border-slate-200" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 -mb-px cursor-pointer ${
                tab === id ? 'border-brand-600 text-navy-950' : 'border-transparent text-slate-500 hover:text-navy-950'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4" onScroll={onScroll}>
          {isLoading ? (
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-lg bg-slate-200 animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm text-slate-600">{(error as any)?.message || 'Could not load shared files.'}</p>
              <button type="button" onClick={() => refetch()} className="px-3 py-1.5 rounded-xl bg-navy-950 text-white text-xs font-bold cursor-pointer">
                Retry
              </button>
            </div>
          ) : groups.length === 0 ? (
            <p className="text-center text-sm text-slate-500 py-10">{EMPTY_TEXT[tab]}</p>
          ) : (
            groups.map((g) => (
              <section key={g.label}>
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">{g.label}</h3>
                {tab === 'media' ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {g.items.map((item, i) => {
                      const a = item.attachment;
                      const isVideo = a.type === 'video' || a.mimeType?.startsWith('video/');
                      return (
                        <button
                          key={`${item.messageId}-${i}`}
                          type="button"
                          onClick={() => (isVideo ? setPlaying(item) : onOpenImage(a.url, a.name))}
                          className="relative aspect-square rounded-lg overflow-hidden bg-slate-800 cursor-pointer group"
                          title={`${a.name} — ${senderLabel(item.sender)}, ${formatDate(item.createdAt, 'dd MMM, hh:mm a')}`}
                        >
                          {isVideo && !a.thumbnailUrl ? (
                            <span className="absolute inset-0 flex items-center justify-center text-slate-400">
                              <Film className="w-7 h-7" />
                            </span>
                          ) : (
                            <SecureImage variant="thumb" src={a.thumbnailUrl || a.url} alt={a.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                          )}
                          {isVideo && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center">
                                <Play className="w-4 h-4 ml-0.5" />
                              </span>
                            </span>
                          )}
                          {isVideo && !!a.duration && (
                            <span className="absolute bottom-1 right-1 px-1 rounded text-[10px] font-bold font-mono bg-black/60 text-white">
                              {formatClock(a.duration)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : tab === 'docs' ? (
                  <ul className="space-y-1.5">
                    {g.items.map((item, i) => {
                      const a = item.attachment;
                      return (
                        <li key={`${item.messageId}-${i}`} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50">
                          <button type="button" onClick={() => onOpenDoc(a)} className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer">
                            <span className="w-9 h-9 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                              <FileText className="w-5 h-5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-navy-950 truncate">{a.name}</span>
                              <span className="block text-[11px] text-slate-500 truncate">
                                {a.size ? `${formatFileSize(a.size)} · ` : ''}
                                {senderLabel(item.sender)} · {formatDate(item.createdAt, 'dd MMM, hh:mm a')}
                              </span>
                            </span>
                          </button>
                          <button type="button" onClick={(e) => onDownload(e, a.url, a.name)} className="p-2 rounded-lg text-slate-500 hover:text-navy-950 hover:bg-slate-100 cursor-pointer" aria-label={`Download ${a.name}`}>
                            <Download className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => jump(item.messageId)} className="p-2 rounded-lg text-slate-500 hover:text-navy-950 hover:bg-slate-100 cursor-pointer" aria-label="Show in chat" title="Show in chat">
                            <ArrowUpRight className="w-4 h-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="space-y-2">
                    {g.items.map((item, i) => (
                      <li key={`${item.messageId}-${i}`} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                          <span className="truncate">
                            {senderLabel(item.sender)} · {formatDate(item.createdAt, 'dd MMM, hh:mm a')}
                          </span>
                          <button type="button" onClick={() => jump(item.messageId)} className="font-semibold text-amber-700 hover:underline cursor-pointer shrink-0">
                            Show in chat
                          </button>
                        </div>
                        <VoiceNotePlayer attachment={item.attachment} dark={false} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}
          {isFetchingNextPage && (
            <div className="flex justify-center py-3 text-slate-400">
              <LoaderCircle className="w-5 h-5 animate-spin" />
            </div>
          )}
          {hasNextPage && !isFetchingNextPage && (
            <div className="flex justify-center">
              <button type="button" onClick={() => fetchNextPage()} className="px-3 py-1.5 rounded-full text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">
                Load more
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Video player */}
      {playing && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setPlaying(null); }}>
          <div className="w-full max-w-3xl space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between text-white text-sm">
              <span className="truncate font-semibold">{playing.attachment.name}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => jump(playing.messageId)} className="px-2 py-1 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 cursor-pointer">
                  Show in chat
                </button>
                <button type="button" onClick={() => setPlaying(null)} className="p-2 rounded-lg hover:bg-white/10 cursor-pointer" aria-label="Close video">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <SecureVideo
              src={playing.attachment.url}
              posterSrc={playing.attachment.thumbnailUrl}
              controls
              autoPlay
              playsInline
              controlsList="nodownload"
              className="w-full max-h-[75vh] bg-black rounded-xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
