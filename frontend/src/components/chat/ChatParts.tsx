import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, Image as ImageIcon, Film, Loader2, Lock, Receipt, CreditCard, Camera, CornerUpLeft, X } from 'lucide-react';
import { api, API_ORIGIN, ApiError } from '../../api/client.js';
import { resolveMediaUrl } from '../../utils/media.js';
import { SecureImage } from '../common/SecureMedia.js';
import { Modal } from '../common/Modal.js';
import { MessageAttachment, ProjectMessage } from '../../types/index.js';
import { formatDate } from '../../utils/dates.js';

export function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function isDocAttachment(a: MessageAttachment): boolean {
  return a.type === 'document' || a.type === 'pdf' || a.mimeType === 'application/pdf';
}

export function fileTypeLabel(a: Pick<MessageAttachment, 'mimeType' | 'name' | 'type'>): string {
  if (a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.name || '')) return 'PDF';
  const sub = a.mimeType?.split('/')[1];
  return (sub || String(a.type || 'file')).toUpperCase().slice(0, 6);
}

/** Short text describing a message, used in reply quotes. */
export function messageSummary(m?: Partial<ProjectMessage> | null): { icon: 'doc' | 'image' | 'video' | null; text: string } {
  if (!m) return { icon: null, text: 'Original message unavailable' };
  const att = m.attachments?.[0];
  if (att) {
    const icon = isDocAttachment(att) ? 'doc' : att.type === 'video' ? 'video' : 'image';
    const extra = (m.attachments?.length || 0) > 1 ? ` +${(m.attachments?.length || 1) - 1}` : '';
    return { icon, text: m.content?.trim() || `${att.name}${extra}` };
  }
  return { icon: null, text: m.content || '' };
}

const QuoteIcon: React.FC<{ icon: 'doc' | 'image' | 'video' | null }> = ({ icon }) =>
  icon === 'doc' ? (
    <FileText className="w-3.5 h-3.5 shrink-0 text-amber-500" />
  ) : icon === 'image' ? (
    <ImageIcon className="w-3.5 h-3.5 shrink-0 text-sky-500" />
  ) : icon === 'video' ? (
    <Film className="w-3.5 h-3.5 shrink-0 text-sky-500" />
  ) : null;

/** Quoted original message shown inside a reply bubble. */
export const ReplyQuote: React.FC<{ original?: Partial<ProjectMessage> | null; dark: boolean; onClick: () => void }> = ({
  original,
  dark,
  onClick,
}) => {
  const { icon, text } = messageSummary(original);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex flex-col gap-0.5 rounded-lg border-l-4 border-amber-400 px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors ${
        dark ? 'bg-white/10 hover:bg-white/15 text-slate-200' : 'bg-slate-100 hover:bg-slate-200/70 text-slate-700'
      }`}
      title="Go to original message"
    >
      <span className="font-bold text-amber-500 truncate">{(original?.sender as any)?.name || 'Message'}</span>
      <span className="flex items-center gap-1 min-w-0">
        <QuoteIcon icon={icon} />
        <span className="truncate">{text}</span>
      </span>
    </button>
  );
};

/** Bar above the composer while replying; can be cancelled. */
export const ReplyComposerBar: React.FC<{ target: ProjectMessage; onCancel: () => void }> = ({ target, onCancel }) => {
  const { icon, text } = messageSummary(target);
  return (
    <div className="px-3 sm:px-6 py-2 bg-slate-50 border-t border-slate-200 flex items-center gap-2 min-w-0">
      <CornerUpLeft className="w-4 h-4 text-amber-500 shrink-0" />
      <div className="flex-1 min-w-0 border-l-4 border-amber-400 pl-2">
        <p className="text-[11px] font-bold text-navy-950 truncate">Replying to {target.sender?.name || 'message'}</p>
        <p className="text-[11px] text-slate-500 flex items-center gap-1 min-w-0">
          <QuoteIcon icon={icon} />
          <span className="truncate">{text}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full text-slate-400 hover:text-rose-600 hover:bg-slate-200 cursor-pointer"
        aria-label="Cancel reply"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/** Download a private file through a short-lived signed URL. */
export async function downloadSecureFile(url: string, filename: string): Promise<boolean> {
  const signed = await resolveMediaUrl(url);
  if (!signed) return false;
  const link = document.createElement('a');
  link.href = signed.includes('?') ? `${signed}&download=true` : `${signed}?download=true`;
  link.download = filename || 'download';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}

/**
 * Full-screen in-app viewer for PDFs and images. The PDF is fetched as a blob
 * (signed URL, never the login token) and shown from a same-origin object URL,
 * so it works even though the API forbids cross-origin framing.
 */
export const DocumentViewer: React.FC<{ attachment: MessageAttachment | null; onClose: () => void }> = ({
  attachment,
  onClose,
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const isPdf = attachment ? fileTypeLabel(attachment) === 'PDF' : false;

  useEffect(() => {
    if (!attachment || !isPdf) return;
    let alive = true;
    let objectUrl: string | null = null;
    setState('loading');
    setBlobUrl(null);
    (async () => {
      const signed = await resolveMediaUrl(attachment.url);
      if (!signed) return alive && setState('denied');
      try {
        const res = await fetch(signed);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        if (alive) {
          setBlobUrl(objectUrl);
          setState('ready');
        }
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, isPdf]);

  useEffect(() => {
    if (!attachment) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [attachment, onClose]);

  if (!attachment) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-navy-950/95 flex flex-col animate-in fade-in duration-150" role="dialog" aria-modal="true">
      <div className="flex items-center gap-2 px-2 sm:px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] border-b border-white/10 text-white shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-white/10 cursor-pointer"
          aria-label="Back to chat"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{attachment.name}</p>
          <p className="text-[11px] text-slate-400">
            {fileTypeLabel(attachment)}
            {attachment.size ? ` • ${formatFileSize(attachment.size)}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void downloadSecureFile(attachment.url, attachment.name)}
          className="flex items-center gap-1.5 px-3 min-h-[40px] rounded-xl bg-amber-500 hover:bg-amber-400 text-navy-950 font-bold text-xs cursor-pointer shrink-0"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Download</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-0 sm:p-4">
        {!isPdf ? (
          <SecureImage src={attachment.url} alt={attachment.name} className="max-h-full max-w-full object-contain" />
        ) : state === 'ready' && blobUrl ? (
          <iframe title={attachment.name} src={blobUrl} className="w-full h-full bg-white sm:rounded-xl border-0" />
        ) : state === 'loading' ? (
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" aria-label="Loading document" />
        ) : (
          <div className="text-center text-slate-300 space-y-2 px-6">
            <Lock className="w-8 h-8 mx-auto text-slate-400" />
            <p className="text-sm font-semibold">
              {state === 'denied' ? 'You do not have access to this document.' : 'This document could not be loaded.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export interface ShareableFile {
  kind: 'EXPENSE_RECEIPT' | 'PAYMENT_INVOICE' | 'REPORT_PHOTO';
  url: string;
  name: string;
  recordId: string;
  createdAt: string;
  amount?: number;
}

const KIND_META: Record<ShareableFile['kind'], { label: string; Icon: React.FC<any> }> = {
  EXPENSE_RECEIPT: { label: 'Expense receipt', Icon: Receipt },
  PAYMENT_INVOICE: { label: 'Payment invoice', Icon: CreditCard },
  REPORT_PHOTO: { label: 'Report photo', Icon: Camera },
};

/** Picker for receipts / invoices / report photos already stored in this project. */
export const ShareProjectFileModal: React.FC<{
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onPick: (file: ShareableFile) => void;
}> = ({ projectId, isOpen, onClose, onPick }) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['chat-shareable', projectId],
    queryFn: () => api.get<{ files: ShareableFile[] }>(`/projects/${projectId}/messages/shareable`),
    enabled: isOpen && Boolean(projectId),
  });
  const files = data?.files || [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share from project records" description="Receipts, invoices and report photos are shared without re-uploading." size="md">
      {isLoading ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
        </div>
      ) : isError ? (
        <p className="text-sm text-rose-600 py-4">Could not load project files.</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-slate-500 py-4">No receipts, invoices or report photos in this project yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 -mx-2">
          {files.map((f) => {
            const { label, Icon } = KIND_META[f.kind];
            return (
              <li key={`${f.kind}-${f.url}`}>
                <button
                  type="button"
                  onClick={() => onPick(f)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 text-left hover:bg-slate-50 rounded-xl cursor-pointer min-h-[48px]"
                >
                  <span className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-navy-950 truncate">{f.name}</span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {label}
                      {typeof f.amount === 'number' ? ` • ₹${(f.amount / 100).toLocaleString('en-IN')}` : ''}
                      {f.createdAt ? ` • ${formatDate(f.createdAt, 'dd MMM yyyy')}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};

/** Multipart upload with progress events (fetch has no upload progress). */
export function uploadWithProgress<T>(
  endpoint: string,
  form: FormData,
  onProgress: (pct: number) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_ORIGIN}/api/v1${endpoint}`);
    const token = localStorage.getItem('sitetrack_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let body: any = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(body.message || `Upload failed (${xhr.status})`, xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError('Network error during upload', 0));
    xhr.send(form);
  });
}
