import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { DailyReport } from '../types/index.js';
import { formatDate } from '../utils/dates.js';
import { exportDailyReportPdf } from '../utils/exportPdf.js';
import { api } from '../api/client.js';

export const DailyReportDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['daily-report-detail', id],
    queryFn: () => api.get<{ success: boolean; report: DailyReport }>(`/daily-reports/${id}`),
    enabled: Boolean(id),
  });

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
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/reports')}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-navy-900 bg-navy-50 border border-navy-200 px-2 py-0.5 rounded">
                {report.project?.code}
              </span>
              <Badge status={report.status} size="sm" />
              <span className="text-xs text-slate-500 font-medium">
                {formatDate(report.workDate, 'EEEE, dd MMMM yyyy')}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-navy-950 mt-1">
              {report.titleOfWork || 'Daily Construction Progress Log'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-card text-xs">
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
            <CardTitle>Measured Work Items Completed</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase">
                  <th className="py-3 px-4">Item / Activity Description</th>
                  <th className="py-3 px-4 text-right">Quantity</th>
                  <th className="py-3 px-4 text-left">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.workItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-semibold text-navy-950">{item.description}</td>
                    <td className="py-3 px-4 text-right font-bold text-navy-900">{item.quantity}</td>
                    <td className="py-3 px-4 text-slate-600 font-medium">{item.unit}</td>
                  </tr>
                ))}
              </tbody>
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
    </div>
  );
};
