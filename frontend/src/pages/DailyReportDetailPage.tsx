import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  FileDown,
  Users,
  Wrench,
  AlertTriangle,
  Calendar,
  Building2,
  ExternalLink,
  Edit3,
  MessageSquare,
  Send,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { ReadReceiptBadge } from '../components/reports/ReadReceiptBadge.js';
import { DailyReport } from '../types/index.js';
import { formatDate } from '../utils/dates.js';
import { exportDailyReportPdf } from '../utils/exportPdf.js';
import { formatRupees } from '../utils/currency.js';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../api/client.js';

export const DailyReportDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMDUser = user?.role === 'MD' || user?.role === 'OWNER';

  const [commentText, setCommentText] = useState('');
  const [commentType, setCommentType] = useState<'COMMENT' | 'CHANGES_REQUESTED'>('COMMENT');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['daily-report-detail', id],
    queryFn: () => api.get<{ success: boolean; report: DailyReport }>(`/daily-reports/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (data?.report && isMDUser) {
      queryClient.invalidateQueries({ queryKey: ['daily-reports-unread-summary'] });
    }
  }, [data?.report, isMDUser, queryClient]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    try {
      setIsSubmittingComment(true);
      await api.post(`/daily-reports/${id}/comments`, {
        message: commentText.trim(),
        type: commentType,
      });
      setCommentText('');
      queryClient.invalidateQueries({ queryKey: ['daily-report-detail', id] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton rows={1} height="h-20" />
        <LoadingSkeleton rows={3} height="h-32" />
      </div>
    );
  }

  const report = data.report;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/reports')}
            aria-label="Back to daily reports"
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="font-mono text-xs font-bold text-navy-900 bg-navy-50 border border-navy-200 px-2 py-0.5 rounded">
                {report.project?.code}
              </span>
              <Badge status={report.status} size="sm" />
              {report.version && report.version > 1 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                  Rev #{report.version}
                </span>
              )}
              <span className="text-xs text-slate-500 font-medium">
                {formatDate(report.workDate, 'dd MMM yyyy')}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-navy-950 mt-1 break-words">
              {report.titleOfWork || 'Daily Construction Progress Log'}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto [&>button]:flex-1 [&>button]:sm:flex-initial">
          <Button
            variant="outline"
            onClick={() => navigate(`/reports/new?edit=${report._id || report.id}`)}
            leftIcon={<Edit3 className="w-4 h-4 text-slate-600" />}
          >
            Edit Report
          </Button>

          <Button
            variant="primary"
            onClick={() => exportDailyReportPdf(report)}
            leftIcon={<FileDown className="w-4 h-4 text-amber-400" />}
          >
            Export Official PDF
          </Button>
        </div>
      </div>

      {/* Meta Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-card text-xs">
        <div>
          <span className="text-slate-400 block font-medium">Title of Work:</span>
          <span className="font-bold text-navy-950 block mt-0.5 truncate">{report.titleOfWork || 'General Work'}</span>
        </div>
        <div>
          <span className="text-slate-400 block font-medium">Project Name:</span>
          <span className="font-bold text-navy-950 block mt-0.5 truncate">{report.project?.name}</span>
        </div>
        <div>
          <span className="text-slate-400 block font-medium">Site In-Charge:</span>
          <span className="font-bold text-navy-950 block mt-0.5">{report.submittedBy?.name}</span>
          {report.lastEditedBy && report.lastEditedBy?._id !== report.submittedBy?._id && (
            <span className="text-[10px] text-amber-700 font-semibold block mt-0.5">
              Last edit: {report.lastEditedBy?.name}
            </span>
          )}
        </div>
        <div>
          <span className="text-slate-400 block font-medium">Total Site Labour:</span>
          <span className="font-bold text-amber-700 block mt-0.5">{report.totalLabourCount} Workers</span>
        </div>
      </div>

      {/* Read Receipt Status Banner (Shown exclusively to Site In-Charge) */}
      {!isMDUser && report.readReceipt && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <ReadReceiptBadge readReceipt={report.readReceipt} detailed />
            {report.readReceipt?.viewedBy && report.readReceipt.viewedBy.length > 0 && (
              <span className="text-slate-500 font-medium">
                Verified viewers: {report.readReceipt.viewedBy.map((v) => v.viewerName).join(', ')}
              </span>
            )}
            {report.version && report.version > 1 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                Revision #{report.version}
              </span>
            )}
          </div>
          <div className="text-slate-400 text-[11px]">
            Source of truth: Server-verified timestamp tracking
          </div>
        </div>
      )}

      {/* Work Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Work Summary & Execution</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
            {report.workSummary}
          </p>
        </CardContent>
      </Card>

      {/* Work Items Table */}
      {report.workItems && report.workItems.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <CardTitle>Measured Work Items Completed</CardTitle>
              <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                Work Budget: {formatRupees(report.totalWorkBudget ?? report.workItems.reduce((s, i) => s + (i.budget || 0), 0))}
              </span>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[500px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase">
                  <th className="py-3 px-4">Item / Activity Description</th>
                  <th className="py-3 px-4 text-right">Quantity</th>
                  <th className="py-3 px-4 text-left">Unit</th>
                  <th className="py-3 px-4 text-right">Work Budget (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.workItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-semibold text-navy-950">{item.description}</td>
                    <td className="py-3 px-4 text-right font-bold text-navy-900">{item.quantity}</td>
                    <td className="py-3 px-4 text-slate-600 font-medium">{item.unit}</td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-700">
                      {formatRupees(item.budget || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-bold">
                  <td className="py-3 px-4 text-slate-700" colSpan={3}>
                    <div className="flex flex-col">
                      <span className="text-xs uppercase tracking-wider text-slate-600">Total Work Budget (Estimated)</span>
                      <span className="text-[11px] text-slate-400 font-normal">Planned task allocations; separate from actual paid expenses</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-emerald-800 text-sm">
                    {formatRupees(report.totalWorkBudget ?? report.workItems.reduce((s, i) => s + (i.budget || 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Labour Breakdown Table */}
      {report.labourBreakdown && report.labourBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <CardTitle>Labour Attendance by Trade</CardTitle>
              <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                Total: {report.totalLabourCount} Headcount
              </span>
            </div>
          </CardHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
            {report.labourBreakdown.map((l, idx) => (
              <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <span className="text-slate-500 block truncate">{l.role}</span>
                <span className="text-base font-black text-navy-950 block mt-0.5">{l.count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Machinery & Issues */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {report.equipmentDetails && (
          <Card>
            <CardHeader>
              <CardTitle>Machinery & Heavy Equipment</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">
                {report.equipmentDetails}
              </p>
            </CardContent>
          </Card>
        )}

        {report.issuesAndDelays && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5 text-rose-700">
                <AlertTriangle className="w-4 h-4" />
                <CardTitle className="text-rose-950">Issues & Delays</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-rose-900 bg-rose-50/70 p-3 rounded-xl border border-rose-200">
                {report.issuesAndDelays}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Next Day Plan */}
      {report.nextDayPlan && (
        <Card>
          <CardHeader>
            <CardTitle>Next-Day Construction Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">
              {report.nextDayPlan}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Site Photos & Videos Gallery */}
      {report.photos && report.photos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Site Media & Video Walkthroughs ({report.photos.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {report.photos.map((photo, idx) => {
                const isVideo = /\.(mp4|webm|mov|mkv|avi|3gp)($|\?)/i.test(photo.url);

                return (
                  <div key={idx} className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 space-y-2">
                    {isVideo ? (
                      <div className="h-56 bg-black flex items-center justify-center">
                        <video
                          src={photo.url}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : (
                      <a href={photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden h-48">
                        <img
                          src={photo.url}
                          alt={photo.caption || 'Site photo'}
                          className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                        />
                      </a>
                    )}
                    {photo.caption && (
                      <div className="p-2 text-xs text-slate-600 font-medium">
                        {photo.caption}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Management Review & Feedback Comments Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-amber-500" />
              <CardTitle>Management Review & Feedback</CardTitle>
            </div>
            {report.comments && report.comments.length > 0 && (
              <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                {report.comments.length} {report.comments.length === 1 ? 'note' : 'notes'}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(!report.comments || report.comments.length === 0) && (
            <p className="text-xs text-slate-500 italic">
              No management comments or change requests logged yet.
            </p>
          )}

          {report.comments && report.comments.length > 0 && (
            <div className="space-y-3">
              {report.comments.map((c, i) => (
                <div
                  key={c._id || i}
                  className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                    c.type === 'CHANGES_REQUESTED'
                      ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                      : 'bg-slate-50 border-slate-200/80 text-navy-950'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-navy-950">{c.authorName}</span>
                      <span className="font-mono text-[10px] text-slate-500 uppercase">({c.authorRole})</span>
                      {c.type === 'CHANGES_REQUESTED' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-200 text-amber-900">
                          Changes Requested
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400">
                      {formatDate(c.createdAt, 'MMM d, h:mm a')}
                    </span>
                  </div>
                  <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{c.message}</p>
                </div>
              ))}
            </div>
          )}

          {/* Comment submission form for MD / Owner */}
          {isMDUser && (
            <form onSubmit={handleAddComment} className="pt-2 border-t border-slate-100 space-y-3">
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-slate-700">Feedback Type:</span>
                <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="commentType"
                    checked={commentType === 'COMMENT'}
                    onChange={() => setCommentType('COMMENT')}
                    className="accent-amber-500"
                  />
                  <span>General Comment</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-amber-900 font-semibold cursor-pointer">
                  <input
                    type="radio"
                    name="commentType"
                    checked={commentType === 'CHANGES_REQUESTED'}
                    onChange={() => setCommentType('CHANGES_REQUESTED')}
                    className="accent-amber-500"
                  />
                  <span>Request Changes / Additional Photos</span>
                </label>
              </div>

              <div className="flex gap-2">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={
                    commentType === 'CHANGES_REQUESTED'
                      ? 'Specify corrections or photos needed from the site in-charge...'
                      : 'Leave an official MD note or guidance on this report...'
                  }
                  rows={2}
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-none"
                />
                <Button
                  type="submit"
                  variant="amber"
                  disabled={!commentText.trim() || isSubmittingComment}
                  className="self-end px-4 font-bold"
                  rightIcon={<Send className="w-3.5 h-3.5" />}
                >
                  {isSubmittingComment ? 'Sending...' : 'Send'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
