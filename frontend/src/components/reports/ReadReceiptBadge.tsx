import React from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { ReadReceiptInfo } from '../../types/index.js';
import { formatDate } from '../../utils/dates.js';

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
  const status = readReceipt?.status || 'NOT_VIEWED';
  const lastViewedAt = readReceipt?.lastViewedAt;
  const viewerName = readReceipt?.lastViewedByName || 'MD';

  if (status === 'SEEN_BY_MD') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 ${className}`}
        title={`Verified MD view recorded at ${lastViewedAt ? formatDate(lastViewedAt, 'dd MMM yyyy, hh:mm a') : 'recent'}`}
      >
        <Eye className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
        <span>
          Seen by MD{detailed && viewerName !== 'MD' ? ` (${viewerName})` : ''}
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
