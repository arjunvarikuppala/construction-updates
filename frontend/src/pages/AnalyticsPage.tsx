import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { BarChart3, AlertTriangle, RefreshCw, Table2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/common/Card.js';
import { Select, Input } from '../components/common/Input.js';
import { Button } from '../components/common/Button.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { api } from '../api/client.js';
import { formatCompactINR, formatINR, paiseToRupees } from '../utils/currency.js';
import { formatDate } from '../utils/dates.js';
import { labourCategoryLabel } from '../utils/reportOptions.js';

// Validated categorical order (reference palette, light surface). Assigned by entity, never cycled.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER_GRAY = '#8a8984';
const GRID = '#e7e6e2';
const AXIS = { fontSize: 11, fill: '#52514e' };

interface AnalyticsResponse {
  filters: { startDate: string; endDate: string; granularity: 'day' | 'week' | 'month' };
  projects: Array<{ id: string; name: string; code: string; label: string }>;
  totals: {
    approvedInRangePaise: number;
    pendingInRangePaise: number;
    labourDays: number;
    reports: number;
    workItemsCompleted: number;
    workItemsTotal: number;
    issueReports: number;
  };
  expenditureSeries: Array<{ period: string; approvedPaise: number; pendingPaise: number }>;
  labourSeries: Array<{ period: string; labourDays: number; reports: number }>;
  labourByCategory: Array<{ category: string; headcount: number; labourHours: number }>;
  workCompletionSeries: Array<{ period: string; completed: number; inProgress: number; notStarted: number; unspecified: number }>;
  progressSeries: Array<{ period: string; values: Record<string, number> }>;
  projectComparison: Array<{
    projectId: string;
    name: string;
    code: string;
    status: string;
    budgetPaise: number;
    approvedLifetimePaise: number;
    pendingLifetimePaise: number;
    approvedInRangePaise: number;
    budgetUsedPercent: number | null;
    reportsInRange: number;
    daysReported: number;
    expectedReportDays: number;
    reportingCompliancePercent: number | null;
    labourDays: number;
    avgDailyLabour: number;
    lastReportDate: string | null;
    latestProgressPercent: number | null;
    plannedProgressPercent: number | null;
    issueReports: number;
  }>;
}

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom range' },
];

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function periodLabel(period: string, granularity: string): string {
  if (granularity === 'month') {
    const [y, m] = period.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  }
  if (granularity === 'week') return period.replace(/^\d{4}-/, '');
  const [y, m, d] = period.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const rupeeTick = (v: number) => formatCompactINR(v * 100);

const ChartTooltip: React.FC<any> = ({ active, payload, label, money }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white text-[#0b0b0b] p-2.5 rounded-lg shadow-lg border border-slate-200 text-xs space-y-1 min-w-[150px]">
      <p className="font-bold">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[#52514e]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold tabular-nums">{money ? formatINR(Math.round(Number(p.value) * 100)) : Number(p.value).toLocaleString('en-IN')}</span>
        </div>
      ))}
    </div>
  );
};

const EmptyChart: React.FC<{ message: string }> = ({ message }) => (
  <div className="h-64 flex flex-col items-center justify-center text-center text-slate-500 text-xs gap-1 px-4">
    <BarChart3 className="w-6 h-6 text-slate-300" />
    <span>{message}</span>
  </div>
);

const Kpi: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-3.5 min-w-0">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 truncate">{label}</p>
    <p className="text-xl sm:text-2xl font-black text-navy-950 mt-1 tabular-nums truncate">{value}</p>
    {sub && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{sub}</p>}
  </div>
);

const ChartCard: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <Card className="min-w-0">
    <CardHeader>
      <div className="min-w-0">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
    </CardHeader>
    <CardContent className="pt-2">{children}</CardContent>
  </Card>
);

export const AnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const [range, setRange] = useState('30');
  const [customStart, setCustomStart] = useState(isoDay(new Date(Date.now() - 29 * 86400000)));
  const [customEnd, setCustomEnd] = useState(isoDay(new Date()));
  const [granularity, setGranularity] = useState('auto');
  const [projectId, setProjectId] = useState('');

  const { start, end } = useMemo(() => {
    if (range === 'custom') return { start: customStart, end: customEnd };
    const days = Number(range);
    return { start: isoDay(new Date(Date.now() - (days - 1) * 86400000)), end: isoDay(new Date()) };
  }, [range, customStart, customEnd]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['owner-analytics', start, end, granularity, projectId],
    queryFn: () => {
      const q = new URLSearchParams({ startDate: start, endDate: end });
      if (granularity !== 'auto') q.set('granularity', granularity);
      if (projectId) q.set('projectId', projectId);
      return api.get<AnalyticsResponse>(`/dashboard/analytics?${q.toString()}`);
    },
    refetchInterval: 60000,
  });

  // Colour follows the project (its position in the full company list), not its rank in a chart
  const { data: allProjects } = useQuery({
    queryKey: ['analytics-project-list'],
    queryFn: () => api.get<{ projects: Array<{ _id: string; name: string; code: string }> }>('/projects'),
  });
  const projectColor = useMemo(() => {
    const m = new Map<string, string>();
    (allProjects?.projects || []).forEach((p, i) => m.set(p._id, i < SERIES.length ? SERIES[i] : OTHER_GRAY));
    return m;
  }, [allProjects]);

  const g = data?.filters.granularity || 'day';

  const expenditure = useMemo(
    () =>
      (data?.expenditureSeries || []).map((r) => ({
        label: periodLabel(r.period, g),
        Approved: paiseToRupees(r.approvedPaise),
        Pending: paiseToRupees(r.pendingPaise),
      })),
    [data, g]
  );
  const hasExpenditure = expenditure.some((r) => r.Approved || r.Pending);

  const labour = useMemo(
    () => (data?.labourSeries || []).map((r) => ({ label: periodLabel(r.period, g), 'Labour-days': r.labourDays })),
    [data, g]
  );
  const hasLabour = labour.some((r) => r['Labour-days'] > 0);

  const work = useMemo(
    () =>
      (data?.workCompletionSeries || []).map((r) => ({
        label: periodLabel(r.period, g),
        Completed: r.completed,
        'In progress': r.inProgress,
        'Not started': r.notStarted,
        'Status not set': r.unspecified,
      })),
    [data, g]
  );
  const hasWork = work.some((r) => r.Completed || r['In progress'] || r['Not started'] || r['Status not set']);
  const hasUnspecified = work.some((r) => r['Status not set'] > 0);

  const budgetRows = useMemo(
    () =>
      (data?.projectComparison || [])
        .filter((p) => p.budgetPaise > 0 || p.approvedLifetimePaise > 0)
        .map((p) => ({ label: p.code, Budget: paiseToRupees(p.budgetPaise), 'Approved spend': paiseToRupees(p.approvedLifetimePaise) })),
    [data]
  );

  const categoryRows = useMemo(
    () => (data?.labourByCategory || []).map((c) => ({ label: labourCategoryLabel(c.category), Headcount: c.headcount, hours: c.labourHours })),
    [data]
  );

  const progressProjects = useMemo(() => {
    const ids = new Set<string>();
    (data?.progressSeries || []).forEach((r) => Object.keys(r.values).forEach((id) => ids.add(id)));
    return (data?.projects || []).filter((p) => ids.has(String(p.id))).slice(0, SERIES.length);
  }, [data]);
  const progressRows = useMemo(
    () =>
      (data?.progressSeries || []).map((r) => {
        const row: Record<string, any> = { label: periodLabel(r.period, g) };
        progressProjects.forEach((p) => {
          if (r.values[String(p.id)] !== undefined) row[p.code] = r.values[String(p.id)];
        });
        return row;
      }),
    [data, g, progressProjects]
  );

  const t = data?.totals;
  const chartHeight = 260;

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 pb-2 border-b border-slate-200">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">Site Analytics</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Computed from submitted daily reports and recorded expenses. Pending = submitted, awaiting your approval.
          </p>
        </div>
        {/* Filters in one row above the charts */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-2 w-full lg:w-auto">
          <div className="col-span-2 sm:w-48">
            <Select aria-label="Project filter" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All my projects</option>
              {(allProjects?.projects || []).map((p) => (
                <option key={p._id} value={p._id}>
                  {p.code} – {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:w-40">
            <Select aria-label="Date range" value={range} onChange={(e) => setRange(e.target.value)} options={RANGES} />
          </div>
          <div className="sm:w-32">
            <Select
              aria-label="Group by"
              value={granularity}
              onChange={(e) => setGranularity(e.target.value)}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'day', label: 'Daily' },
                { value: 'week', label: 'Weekly' },
                { value: 'month', label: 'Monthly' },
              ]}
            />
          </div>
          {range === 'custom' && (
            <>
              <Input aria-label="Start date" type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} />
              <Input aria-label="End date" type="date" value={customEnd} min={customStart} max={isoDay(new Date())} onChange={(e) => setCustomEnd(e.target.value)} />
            </>
          )}
          <Button variant="outline" size="md" onClick={() => refetch()} aria-label="Refresh analytics" leftIcon={<RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />}>
            <span className="sm:hidden lg:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {isError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2" role="alert">
          <AlertTriangle className="w-4 h-4" /> {(error as any)?.message || 'Analytics could not be loaded.'}
        </div>
      )}

      {isLoading && !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <LoadingSkeleton key={i} rows={1} height="h-20" />
            ))}
          </div>
          <LoadingSkeleton rows={2} height="h-64" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Approved spend" value={formatCompactINR(t!.approvedInRangePaise)} sub={`${formatDate(data.filters.startDate, 'dd MMM')} – ${formatDate(data.filters.endDate, 'dd MMM')}`} />
            <Kpi label="Pending approval" value={formatCompactINR(t!.pendingInRangePaise)} />
            <Kpi label="Reports submitted" value={String(t!.reports)} />
            <Kpi label="Labour-days" value={t!.labourDays.toLocaleString('en-IN')} sub="sum of daily headcount" />
            <Kpi label="Work items done" value={`${t!.workItemsCompleted}/${t!.workItemsTotal}`} sub={t!.workItemsTotal ? `${Math.round((t!.workItemsCompleted / t!.workItemsTotal) * 100)}% marked completed` : 'no items logged'} />
            <Kpi label="Reports with issues" value={String(t!.issueReports)} sub="delays / problems flagged" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard title="Expenditure" description={`${g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly'} approved and pending expenses (₹)`}>
              {hasExpenditure ? (
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={expenditure} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={rupeeTick} width={56} />
                    <Tooltip content={<ChartTooltip money />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" />
                    <Bar dataKey="Approved" stackId="s" fill={SERIES[0]} stroke="#fcfcfb" strokeWidth={1} />
                    <Bar dataKey="Pending" stackId="s" fill={SERIES[1]} stroke="#fcfcfb" strokeWidth={1} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No expenses recorded in this period." />
              )}
            </ChartCard>

            <ChartCard title="Budget vs actual" description="Lifetime approved spend against each project's budget (₹)">
              {budgetRows.length ? (
                <ResponsiveContainer width="100%" height={Math.max(chartHeight, budgetRows.length * 44 + 60)}>
                  <BarChart data={budgetRows} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap="25%" barGap={2}>
                    <CartesianGrid horizontal={false} stroke={GRID} />
                    <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={rupeeTick} />
                    <YAxis type="category" dataKey="label" tick={AXIS} tickLine={false} axisLine={false} width={84} />
                    <Tooltip content={<ChartTooltip money />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" />
                    <Bar dataKey="Budget" fill={SERIES[2]} radius={[0, 4, 4, 0]} />
                    <Bar dataKey="Approved spend" fill={SERIES[0]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No project budgets or approved expenses yet." />
              )}
            </ChartCard>

            <ChartCard title="Labour utilisation" description="Labour-days per period (total headcount across submitted reports)">
              {hasLabour ? (
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={labour} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Bar dataKey="Labour-days" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No labour recorded in submitted reports for this period." />
              )}
            </ChartCard>

            <ChartCard title="Labour by category" description="Headcount by skilled / unskilled / supervisor in this period">
              {categoryRows.length ? (
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={categoryRows} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid horizontal={false} stroke={GRID} />
                    <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="label" tick={AXIS} tickLine={false} axisLine={false} width={96} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Bar dataKey="Headcount" fill={SERIES[0]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No labour categories recorded yet." />
              )}
            </ChartCard>

            <ChartCard title="Work completion trend" description="Work items logged per period, by reported status">
              {hasWork ? (
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={work} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" />
                    <Bar dataKey="Completed" stackId="w" fill={SERIES[2]} stroke="#fcfcfb" strokeWidth={1} />
                    <Bar dataKey="In progress" stackId="w" fill={SERIES[3]} stroke="#fcfcfb" strokeWidth={1} />
                    <Bar dataKey="Not started" stackId="w" fill={SERIES[6]} stroke="#fcfcfb" strokeWidth={1} />
                    {hasUnspecified && <Bar dataKey="Status not set" stackId="w" fill={OTHER_GRAY} stroke="#fcfcfb" strokeWidth={1} />}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No work items logged in this period." />
              )}
            </ChartCard>

            <ChartCard title="Site progress" description="Overall completion % reported by In-Charges, per project">
              {progressRows.length ? (
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <LineChart data={progressRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={44} />
                    <Tooltip content={<ChartTooltip />} />
                    {progressProjects.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                    {progressProjects.map((p) => (
                      <Line
                        key={p.id}
                        type="monotone"
                        dataKey={p.code}
                        name={p.code}
                        stroke={projectColor.get(String(p.id)) || SERIES[0]}
                        strokeWidth={2}
                        dot={{ r: 4, strokeWidth: 2, stroke: '#fcfcfb' }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No progress % reported yet. In-Charges can enter it on each daily report." />
              )}
            </ChartCard>
          </div>

          {/* Project performance comparison: the table view of the charts above */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Table2 className="w-4 h-4 text-navy-800" />
                <div>
                  <CardTitle>Project performance comparison</CardTitle>
                  <CardDescription>Reporting compliance counts days with at least one submitted report while the project is In Progress.</CardDescription>
                </div>
              </div>
            </CardHeader>
            {data.projectComparison.length === 0 ? (
              <CardContent>
                <p className="text-sm text-slate-500">No projects yet.</p>
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left min-w-[880px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-bold">
                      <th className="py-2.5 px-4">Project</th>
                      <th className="py-2.5 px-3 text-right">Progress (actual / planned)</th>
                      <th className="py-2.5 px-3 text-right">Budget used</th>
                      <th className="py-2.5 px-3 text-right">Spend in range</th>
                      <th className="py-2.5 px-3 text-right">Reporting</th>
                      <th className="py-2.5 px-3 text-right">Avg daily labour</th>
                      <th className="py-2.5 px-3 text-right">Issues</th>
                      <th className="py-2.5 px-4">Last report</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.projectComparison.map((p) => {
                      const behind =
                        p.latestProgressPercent !== null && p.plannedProgressPercent !== null && p.latestProgressPercent + 10 < p.plannedProgressPercent;
                      return (
                        <tr key={p.projectId} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/projects/${p.projectId}`)}>
                          <td className="py-2.5 px-4">
                            <span className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: projectColor.get(p.projectId) || OTHER_GRAY }} />
                              <span className="font-semibold text-navy-950">{p.code}</span>
                              <span className="text-slate-500 truncate max-w-[180px]">{p.name}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            <span className="font-semibold">{p.latestProgressPercent ?? '—'}{p.latestProgressPercent !== null ? '%' : ''}</span>
                            <span className="text-slate-400"> / {p.plannedProgressPercent ?? '—'}{p.plannedProgressPercent !== null ? '%' : ''}</span>
                            {behind && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-[#d03b3b]">
                                <AlertTriangle className="w-3 h-3" /> Behind
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {p.budgetUsedPercent !== null ? `${p.budgetUsedPercent}%` : '—'}
                            <span className="block text-[10px] text-slate-400">
                              {formatCompactINR(p.approvedLifetimePaise)} of {p.budgetPaise ? formatCompactINR(p.budgetPaise) : 'no budget'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{formatCompactINR(p.approvedInRangePaise)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {p.reportingCompliancePercent !== null ? `${p.reportingCompliancePercent}%` : '—'}
                            <span className="block text-[10px] text-slate-400">
                              {p.daysReported}/{p.expectedReportDays} days
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{p.avgDailyLabour || '—'}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{p.issueReports}</td>
                          <td className="py-2.5 px-4 whitespace-nowrap">{p.lastReportDate ? formatDate(p.lastReportDate, 'dd MMM yyyy') : 'None in range'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
};
