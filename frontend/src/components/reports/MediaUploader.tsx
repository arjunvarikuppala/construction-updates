import React, { useEffect, useState } from 'react';
import { Camera, ImagePlus, Trash2, Video, AlertTriangle, RotateCcw, Loader2 } from 'lucide-react';
import { SitePhoto } from '../../types/index.js';
import { SecureImage, SecureVideo } from '../common/SecureMedia.js';
import { uploadFileWithProgress } from '../../utils/upload.js';
import { isVideoUrl } from '../../utils/media.js';

interface PendingUpload {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  error?: string;
}

interface MediaUploaderProps {
  photos: SitePhoto[];
  /** Accepts a value or updater (pass a React state setter) so parallel uploads never overwrite each other. */
  onChange: (next: SitePhoto[] | ((prev: SitePhoto[]) => SitePhoto[])) => void;
  onBusyChange?: (busy: boolean) => void;
  maxItems?: number;
}

/**
 * Site photo / video capture for In-Charges.
 * - "Take photo" opens the rear camera directly on phones (capture="environment").
 * - Each file shows its own progress bar, error and retry button.
 */
export const MediaUploader: React.FC<MediaUploaderProps> = ({ photos, onChange, onBusyChange, maxItems = 30 }) => {
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const setPendingAndNotify = (updater: (p: PendingUpload[]) => PendingUpload[]) => setPending(updater);

  // Report "busy" (uploads in flight) to the parent after render, never during it
  const busy = pending.some((u) => !u.error);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const runUpload = async (item: PendingUpload) => {
    setPendingAndNotify((prev) => prev.map((u) => (u.id === item.id ? { ...u, progress: 0, error: undefined } : u)));
    try {
      const res = await uploadFileWithProgress(item.file, (progress) =>
        setPending((prev) => prev.map((u) => (u.id === item.id ? { ...u, progress } : u)))
      );
      onChange((prev) => [
        ...prev,
        { url: res.url, caption: item.file.name.replace(/\.[^.]+$/, ''), uploadedAt: new Date().toISOString() },
      ]);
      URL.revokeObjectURL(item.previewUrl);
      setPendingAndNotify((prev) => prev.filter((u) => u.id !== item.id));
    } catch (err: any) {
      setPendingAndNotify((prev) => prev.map((u) => (u.id === item.id ? { ...u, error: err.message || 'Upload failed' } : u)));
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = Math.max(0, maxItems - photos.length - pending.length);
    const accepted = Array.from(files).slice(0, room);
    const items: PendingUpload[] = accepted.map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
    }));
    setPendingAndNotify((prev) => [...prev, ...items]);
    items.forEach(runUpload);
  };

  const discardPending = (id: string) => {
    setPendingAndNotify((prev) => {
      const item = prev.find((u) => u.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((u) => u.id !== id);
    });
  };

  const updateCaption = (idx: number, caption: string) => {
    onChange((prev) => prev.map((p, i) => (i === idx ? { ...p, caption } : p)));
  };

  const tileBase = 'relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 aspect-square';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
        <label className="flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl bg-navy-900 text-white text-sm font-semibold cursor-pointer hover:bg-navy-800 active:scale-[0.98] transition sm:w-auto">
          <Camera className="w-5 h-5 text-brand-400" />
          <span>Take photo</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <label className="flex items-center justify-center gap-2 px-4 min-h-[48px] rounded-xl border border-slate-300 bg-white text-slate-800 text-sm font-semibold cursor-pointer hover:bg-slate-50 active:scale-[0.98] transition sm:w-auto">
          <ImagePlus className="w-5 h-5 text-slate-500" />
          <span>From gallery</span>
          <input
            type="file"
            multiple
            accept="image/*,video/*"
            className="sr-only"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {photos.length === 0 && pending.length === 0 ? (
        <p className="text-xs text-slate-500">No photos yet. Capture today&apos;s work so the MD can see progress remotely.</p>
      ) : (
        <div className="grid grid-cols-2 min-[400px]:grid-cols-3 sm:grid-cols-4 gap-2.5">
          {photos.map((photo, idx) => (
            <div key={`${photo.url}-${idx}`} className="space-y-1">
              <div className={tileBase}>
                {isVideoUrl(photo.url) ? (
                  <>
                    <SecureVideo src={photo.url} className="w-full h-full object-cover opacity-80" preload="metadata" muted />
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="w-9 h-9 rounded-full bg-navy-900/80 text-brand-400 flex items-center justify-center">
                        <Video className="w-4 h-4" />
                      </span>
                    </span>
                  </>
                ) : (
                  <SecureImage variant="thumb" src={photo.url} alt={photo.caption || 'Site photo'} className="w-full h-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => onChange((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label="Remove photo"
                  className="absolute top-1.5 right-1.5 w-9 h-9 flex items-center justify-center rounded-full bg-navy-950/80 text-white hover:bg-rose-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <input
                value={photo.caption || ''}
                onChange={(e) => updateCaption(idx, e.target.value)}
                placeholder="Caption"
                aria-label="Photo caption"
                maxLength={200}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
              />
            </div>
          ))}

          {pending.map((u) => (
            <div key={u.id} className={tileBase}>
              {u.file.type.startsWith('image/') ? (
                <img src={u.previewUrl} alt="" className="w-full h-full object-cover opacity-60" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400">
                  <Video className="w-6 h-6" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 p-2 bg-navy-950/80 text-white space-y-1.5">
                {u.error ? (
                  <>
                    <p className="text-[10px] leading-tight flex items-start gap-1 text-rose-200">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                      <span className="line-clamp-2">{u.error}</span>
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => runUpload(u)}
                        className="flex-1 flex items-center justify-center gap-1 min-h-[32px] rounded-md bg-brand-600 text-white text-[11px] font-bold"
                      >
                        <RotateCcw className="w-3 h-3" /> Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => discardPending(u.id)}
                        aria-label="Discard failed upload"
                        className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-md bg-white/15"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-[10px] font-semibold">
                      <span className="flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Uploading
                      </span>
                      <span>{u.progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/20 overflow-hidden" role="progressbar" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-amber-400 transition-all" style={{ width: `${u.progress}%` }} />
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
