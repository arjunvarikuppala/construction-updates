import React from 'react';
import { Eye, EyeOff, AlertCircle, CheckCheck } from 'lucide-react';
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
  const viewerName = readReceipt?.lastViewedByName;

  // 1. SEEN BY MD (Active verified review timestamp)
  if (status === 'SEEN_BY_MD') {
    const formattedTimestamp = lastViewedAt
      ? formatDate(lastViewedAt, 'dd MMM yyyy, hh:mm a')
      : '';

    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs transition-all duration-300 animate-in fade-in zoom-in-95 ${className}`}
        title={`Verified MD view recorded at ${formattedTimestamp || 'recently'}${viewerName ? ` by ${viewerName}` : ''}`}
      >
        <Eye className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 animate-pulse" />
        <span className="font-bold">
          Seen by MD{formattedTimestamp ? ` — ${formattedTimestamp}` : ''}
        </span>
      </div>
    );
  }

  // 2. REPORT UPDATED AFTER MD LAST VIEW
  if (status === 'REVISION_NOT_VIEWED') {
    const previousTimestamp = lastViewedAt
      ? formatDate(lastViewedAt, 'dd MMM yyyy, hh:mm a')
      : '';

    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 shadow-2xs ${className}`}
        title={`Report updated after last view · Awaiting MD review${previousTimestamp ? ` (Last viewed: ${previousTimestamp})` : ''}`}
      >
        <AlertCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
        <span className="font-bold">
          {detailed ? 'Seen by MD — updated version not yet viewed' : "Updated after MD's last view"}
        </span>
      </div>
    );
  }

  // 3. NOT VIEWED YET
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200 ${className}`}
      title={isMDUser ? 'You have not opened and viewed this report yet' : 'MD has not viewed this report yet'}
    >
      <EyeOff className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
      <span>{isMDUser ? 'MD has not viewed this report yet' : 'Not viewed by MD yet'}</span>
    </div>
  );
};
