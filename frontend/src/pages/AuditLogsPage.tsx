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
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-bold text-navy-950 text-sm truncate">
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
                    <dl className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                      {formatAuditDetails(log.details).map(([k, v]) => (
                        <div key={k} className="flex gap-1.5 min-w-0">
                          <dt className="text-slate-500 shrink-0">{k}:</dt>
                          <dd className="text-slate-800 font-medium truncate" title={v}>{v}</dd>
                        </div>
                      ))}
                    </dl>
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

const HIDDEN_DETAIL_KEYS = new Set(['password', 'token', 'secret', '__v']);

/** Turn an audit details object into readable label/value pairs. */
function formatAuditDetails(details: unknown): Array<[string, string]> {
  if (!details || typeof details !== 'object') return [['Details', String(details)]];
  return Object.entries(details as Record<string, unknown>)
    .filter(([k, v]) => !HIDDEN_DETAIL_KEYS.has(k) && v !== undefined && v !== null && v !== '')
    .slice(0, 12)
    .map(([k, v]) => {
      const label = k
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase());
      let value: string;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) value = new Date(v).toLocaleString('en-IN');
      else if (typeof v === 'boolean') value = v ? 'Yes' : 'No';
      else if (Array.isArray(v)) value = `${v.length} item${v.length === 1 ? '' : 's'}`;
      else if (typeof v === 'object') value = JSON.stringify(v);
      else value = String(v);
      return [label, value];
    });
}
