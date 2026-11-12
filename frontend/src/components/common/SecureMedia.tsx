import React from 'react';
import { ImageOff, Lock, FileText } from 'lucide-react';
import { useDisplayMedia, openMedia, type MediaVariant } from '../../utils/media.js';
import { useToast } from '../../context/ToastContext.js';

type ImgProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null;
  /** 'thumb' for grids, 'large' for full-screen; small resized copies load much faster */
  variant?: MediaVariant;
};

/** <img> for private uploads: fetches a short-lived signed URL first. */
export const SecureImage: React.FC<ImgProps> = ({ src, variant = 'original', className = '', alt = '', onError, ...rest }) => {
  const { url, loading, denied, retryWithFallback } = useDisplayMedia(src, variant);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [url]);
  if (loading) return <div className={`bg-slate-200 animate-pulse ${className}`} aria-label="Loading image" />;
  if (!url || failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400 ${className}`} role="img" aria-label={alt || 'Image unavailable'}>
        {denied ? <Lock className="w-5 h-5" /> : <ImageOff className="w-5 h-5" />}
        <span className="text-[10px] font-semibold">{denied ? 'No access' : failed ? 'File no longer available' : 'Unavailable'}</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={(e) => {
        if (retryWithFallback()) return;
        setFailed(true);
        onError?.(e);
      }}
      {...rest}
    />
  );
};

type VideoProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src' | 'poster'> & {
  src?: string | null;
  /** Stored URL of a preview frame; shown until the video is played. */
  posterSrc?: string | null;
};

export const SecureVideo: React.FC<VideoProps> = ({ src, posterSrc, className = '', onError, ...rest }) => {
  const { url, loading, retryWithFallback } = useDisplayMedia(src);
  const poster = useDisplayMedia(posterSrc);
  if (loading) return <div className={`bg-slate-800 animate-pulse ${className}`} aria-label="Loading video" />;
  if (!url) return <div className={`flex items-center justify-center bg-slate-800 text-slate-400 text-xs ${className}`}>Video unavailable</div>;
  return (
    <video
      src={url}
      poster={poster.url || undefined}
      className={className}
      onError={(e) => {
        if (retryWithFallback()) return;
        onError?.(e);
      }}
      {...rest}
    />
  );
};

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> {
  href?: string | null;
}

/**
 * Link that opens a private file in a new tab. The signed URL is fetched on
 * click so stale links never leak into the DOM.
 */
export const SecureLink: React.FC<LinkProps> = ({ href, children, className = '', ...rest }) => {
  const { error } = useToast();
  return (
    <a
      href="#"
      role="button"
      className={className}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await openMedia(href);
        if (!ok) error('This file is unavailable or you do not have access to it.');
      }}
      {...rest}
    >
      {children}
    </a>
  );
};

/** Small thumbnail for a receipt/bill: image preview, or a PDF/file chip. */
export const ReceiptThumb: React.FC<{ url?: string | null; className?: string; label?: string }> = ({
  url,
  className = 'w-14 h-14',
  label = 'Receipt',
}) => {
  if (!url) return null;
  const isPdf = /\.pdf($|\?)/i.test(url);
  return (
    <SecureLink
      href={url}
      className={`inline-flex shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white hover:ring-2 hover:ring-amber-400 transition ${className}`}
      aria-label={`Open ${label}`}
      title={`Open ${label}`}
    >
      {isPdf ? (
        <span className="flex flex-col items-center justify-center w-full h-full text-rose-600 bg-rose-50">
          <FileText className="w-5 h-5" />
          <span className="text-[9px] font-bold">PDF</span>
        </span>
      ) : (
        <SecureImage src={url} alt={label} className="w-full h-full object-cover" />
      )}
    </SecureLink>
  );
};
