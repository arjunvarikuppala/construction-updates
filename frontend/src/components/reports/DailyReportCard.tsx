import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Users, Wrench, AlertTriangle, ArrowRight, FileDown, Image as ImageIcon, Edit3, CheckCheck } from 'lucide-react';
import { DailyReport } from '../../types/index.js';
import { Badge } from '../common/Badge.js';
import { Button } from '../common/Button.js';
import { ReadReceiptBadge } from './ReadReceiptBadge.js';
import { formatDate } from '../../utils/dates.js';
import { exportDailyReportPdf } from '../../utils/exportPdf.js';
import { useAuth } from '../../context/AuthContext.js';
import { useToast } from '../../context/ToastContext.js';
import { api } from '../../api/client.js';

interface DailyReportCardProps {
  report: DailyReport;
}

export const DailyReportCard: React.FC<DailyReportCardProps> = ({ report }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { success } = useToast();
  const id = report._id || report.id;

  const isMDUser = user?.role === 'MD' || user?.role === 'OWNER';
  const isUnreadByMD = isMDUser && report.readReceipt?.status === 'NOT_VIEWED';

  const markViewedMutation = useMutation({
    mutationFn: () => api.post(`/daily-reports/${id}/view`),
    onSuccess: () => {
      success('Report marked as reviewed');
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
    },
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-card hover:shadow-card-hover transition-all space-y-3.5">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-navy-900 bg-navy-50 border border-navy-200/80 px-2 py-0.5 rounded-md">
            {report.project?.code}
          </span>
          <span className="font-bold text-xs text-slate-600 truncate max-w-xs">
            {report.project?.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge status={report.status} size="sm" />
          <span className="text-xs text-slate-500 font-medium">
            {formatDate(report.workDate, 'EEEE, dd MMM yyyy')}
          </span>
        </div>
      </div>

      {/* Prominent Title of Work & Read Receipt */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h3
          onClick={() => navigate(`/reports/${id}`)}
          className="text-base font-extrabold text-navy-950 tracking-tight hover:text-amber-600 transition-colors cursor-pointer"
          title="Click to view full report"
        >
          {report.titleOfWork || 'Daily Construction Work Log'}
        </h3>
        <ReadReceiptBadge readReceipt={report.readReceipt} />
      </div>

      {/* Summary */}
      <div>
        <p className="text-xs text-slate-700 leading-relaxed line-clamp-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
          {report.workSummary}
        </p>
      </div>

      {/* Stats row: Labour count & Work items */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50/70 border border-amber-100 text-amber-950">
          <Users className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div>
            <span className="text-[10px] text-amber-700 block uppercase font-bold">Total Labour</span>
            <span className="font-bold text-xs">{report.totalLabourCount} Workers</span>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 rounded-lg bg-navy-50/70 border border-navy-100 text-navy-950">
          <Wrench className="w-4 h-4 text-navy-700 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] text-navy-700 block uppercase font-bold">Work Items</span>
            <span className="font-bold text-xs truncate block">{report.workItems?.length || 0} Quantities Logged</span>
          </div>
        </div>

        {report.issuesAndDelays ? (
          <div className="col-span-2 sm:col-span-1 flex items-center gap-2 p-2 rounded-lg bg-rose-50/70 border border-rose-100 text-rose-950">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] text-rose-700 block uppercase font-bold">Issue Reported</span>
              <span className="font-semibold text-xs truncate block">{report.issuesAndDelays}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Photo previews */}
      {report.photos && report.photos.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
            <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
            <span>Site Photos ({report.photos.length})</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {report.photos.map((p, idx) => (
              <a
                key={idx}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border border-slate-200 group"
              >
                <img
                  src={p.url}
                  alt={p.caption || 'Site photo'}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
        <span className="text-slate-500 font-medium">
          By {report.submittedBy?.name || 'In-Charge'}
        </span>

        <div className="flex items-center gap-2">
          {/* Quick Mark as Reviewed for MD */}
          {isUnreadByMD && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markViewedMutation.mutate()}
              isLoading={markViewedMutation.isPending}
              leftIcon={<CheckCheck className="w-3.5 h-3.5 text-emerald-600" />}
              className="border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
              title="Quickly mark as reviewed (notifies In-Charge in real time)"
            >
              Mark Reviewed
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/reports/new?edit=${id}`)}
            leftIcon={<Edit3 className="w-3.5 h-3.5 text-slate-500" />}
          >
            Edit
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => exportDailyReportPdf(report)}
            leftIcon={<FileDown className="w-3.5 h-3.5 text-slate-500" />}
          >
            PDF
          </Button>

          <Button
            size="sm"
            variant="primary"
            onClick={() => navigate(`/reports/${id}`)}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            View Full Report
          </Button>
        </div>
      </div>
    </div>
  );
};
