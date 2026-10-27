import React from 'react';
import { Eye, EyeOff, AlertCircle, Check } from 'lucide-react';
import { ReadReceiptInfo } from '../../types/index.js';
import { formatDate } from '../../utils/dates.js';
import { useAuth } from '../../context/AuthContext.js';

interface ReadReceiptBadgeProps {
  readReceipt?: ReadReceiptInfo;
  className?: string;
  detailed?: boolean;
}

export const ReadReceiptBadge: React.FC<ReadReceiptBadgeProps> = ({
  readReceipt,
  className = '',
  detailed = false,
}) => {
  const { user } = useAuth();
  const isMDUser = user?.role === 'MD' || user?.role === 'OWNER';

  const status = readReceipt?.status || 'NOT_VIEWED';
  const lastViewedAt = readReceipt?.lastViewedAt;
  const viewerName = readReceipt?.lastViewedByName || 'MD';

  // ========================================================
  // MANAGING DIRECTOR VIEW:
  // "Seen by MD: [timestamp]" is strictly shown TO ONLY THE INCHARGE.
  // The MD is the reviewer; they see "Unread" / "New Revision" / "Reviewed" without self-referential timestamps.
  // ========================================================
  if (isMDUser) {
    if (status === 'NOT_VIEWED') {
      return (
        <div
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-200 ${className}`}
          title="You have not reviewed this daily report yet"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
          <span>Unread</span>
        </div>
      );
    }

    if (status === 'REVISION_NOT_VIEWED') {
      return (
        <div
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 ${className}`}
          title="The Site In-Charge edited this report after your last view"
        >
          <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
          <span>New Revision</span>
        </div>
      );
    }

    // status === 'SEEN_BY_MD'
    return (
      <div
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200/90 ${className}`}
        title="You have reviewed this daily report"
      >
        <Check className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <span>Reviewed</span>
      </div>
    );
  }

  // ========================================================
  // SITE IN-CHARGE VIEW:
  // Shows the verified MD read receipt with exact timestamp as soon as MD views it.
  // ========================================================
  if (status === 'SEEN_BY_MD') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs transition-all duration-300 animate-in fade-in zoom-in-95 ${className}`}
        title={`Verified MD view recorded at ${lastViewedAt ? formatDate(lastViewedAt, 'dd MMM yyyy, hh:mm a') : 'recent'}`}
      >
        <Eye className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 animate-pulse" />
        <span className="font-bold">
          Seen by MD{viewerName && viewerName !== 'MD' && viewerName !== 'Managing Director' ? ` (${viewerName})` : ''}
          {lastViewedAt ? `: ${formatDate(lastViewedAt, 'dd MMM, hh:mm a')}` : ''}
        </span>
      </div>
    );
  }

  if (status === 'REVISION_NOT_VIEWED') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 ${className}`}
        title="Report was updated/edited after the last recorded MD view"
      >
        <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
        <span>New revision not viewed</span>
      </div>
    );
  }

  // NOT_VIEWED
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200 ${className}`}
      title="No authorized MD has viewed this report yet"
    >
      <EyeOff className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
      <span>Not viewed yet</span>
    </div>
  );
};
