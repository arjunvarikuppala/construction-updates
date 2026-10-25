import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Shield, Clock, UserCheck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { formatDateTime } from '../utils/dates.js';
import { api } from '../api/client.js';

export const AuditLogsPage: React.FC = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => api.get<{ count: number; logs: any[] }>('/audit-logs?limit=50'),
    refetchInterval: 15000,
  });

  const logs = data?.logs || [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">
            Security & Activity Audit Trail
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Immutable chronological record of project creation, daily reports, expense approvals, and logins.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-navy-800" />
            <CardTitle>Recent System Events ({logs.length})</CardTitle>
          </div>
        </CardHeader>

        {isLoading ? (
          <div className="p-5 space-y-3">
            <LoadingSkeleton rows={4} height="h-14" />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {logs.map((log: any) => (
              <div key={log._id || log.id} className="p-4 hover:bg-slate-50/60 transition-colors flex items-start gap-3.5 text-xs">
                <div className="w-9 h-9 rounded-xl bg-navy-50 text-navy-900 border border-navy-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Shield className="w-4 h-4 text-navy-700" />
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-navy-950 text-sm">
                      {log.action.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-slate-600">
                    <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      Performed by <strong className="text-slate-800">{log.performedBy?.name || 'System'}</strong> ({log.performedBy?.role})
                    </span>
                  </div>

                  {log.details && (
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 font-mono text-[11px] mt-1">
                      {JSON.stringify(log.details)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
