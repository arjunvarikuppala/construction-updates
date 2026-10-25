import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  DollarSign,
  Clock,
  AlertCircle,
  FileText,
  FileCheck2,
  ArrowRight,
  FileSpreadsheet,
  AlertTriangle,
  UserX,
  ExternalLink,
  Plus,
  Receipt,
  Users,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { Select } from '../components/common/Input.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { ProjectBudgetBarChart } from '../components/charts/ProjectBudgetBarChart.js';
import { CategoryExpensePieChart } from '../components/charts/CategoryExpensePieChart.js';
import { ExpenditureTrendChart } from '../components/charts/ExpenditureTrendChart.js';
import { OwnerDashboardData, Project } from '../types/index.js';
import { formatCompactINR, formatINR } from '../utils/currency.js';
import { formatDate } from '../utils/dates.js';
import { downloadExpensesExcel } from '../utils/exportExcel.js';
import { api } from '../api/client.js';

export const OwnerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedDateRange, setSelectedDateRange] = useState<string>('ALL');

  // Query projects for filter dropdown & workspace switcher
  const { data: projectsData } = useQuery({
    queryKey: ['projects-list-filter'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });

  // Query dashboard statistics with polling every 15s for cross-device sync
  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['owner-dashboard', selectedProjectId, selectedDateRange],
    queryFn: async () => {
      let queryParams = new URLSearchParams();
      if (selectedProjectId) queryParams.append('projectId', selectedProjectId);

      if (selectedDateRange === 'LAST_30_DAYS') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        queryParams.append('startDate', d.toISOString().split('T')[0]);
      } else if (selectedDateRange === 'THIS_MONTH') {
        const d = new Date();
        d.setDate(1);
        queryParams.append('startDate', d.toISOString().split('T')[0]);
      }

      const res = await api.get<OwnerDashboardData>(`/dashboard/owner?${queryParams.toString()}`);
      return res;
    },
    refetchInterval: 15000,
  });

  const kpis = dashboardData?.kpis;
  const projects = projectsData?.projects || [];
  const projectExpenditures = dashboardData?.projectExpenditures || [];
  const attentionProjects = projectExpenditures.filter((p) => p.requiresAttention);
  const unassignedCount = kpis?.unassignedProjectsCount || 0;
  const recentlyUpdatedProjects = dashboardData?.recentlyUpdatedProjects || [];
  const recentReports = dashboardData?.recentReports || [];
  const recentExpenses = dashboardData?.recentExpenses || [];

  const handleExportExcel = () => {
    downloadExpensesExcel(selectedProjectId ? { projectId: selectedProjectId } : {});
  };

  const handleOpenWorkspace = () => {
    if (selectedProjectId) {
      navigate(`/projects/${selectedProjectId}`);
    } else if (projects.length > 0) {
      navigate(`/projects/${projects[0]._id || projects[0].id}`);
    } else {
      navigate('/projects');
    }
  };

  if (isLoading && !dashboardData) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton rows={2} height="h-8" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <LoadingSkeleton rows={1} height="h-32" />
          <LoadingSkeleton rows={1} height="h-32" />
          <LoadingSkeleton rows={1} height="h-32" />
          <LoadingSkeleton rows={1} height="h-32" />
        </div>
        <LoadingSkeleton rows={3} height="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header with Workspace Quick Selector & Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">
            Managing Director Executive Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Real-time project oversight, in-charge assignments, daily reports & live expenditure stream.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Workspace Quick Switcher */}
          <div className="flex items-center gap-1.5 bg-navy-900/5 p-1 rounded-xl border border-navy-900/10">
            <div className="w-48">
              <Select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="py-1.5 text-xs bg-white font-medium"
              >
                <option value="">All Authorized Projects</option>
                {projects.map((p) => (
                  <option key={p._id || p.id} value={p._id || p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </Select>
            </div>
            {selectedProjectId && (
              <Button
                size="sm"
                variant="amber"
                onClick={handleOpenWorkspace}
                className="text-xs px-2.5 py-1.5"
                rightIcon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                Open Workspace
              </Button>
            )}
          </div>

          <div className="w-36">
            <Select
              value={selectedDateRange}
              onChange={(e) => setSelectedDateRange(e.target.value)}
              className="py-1.5 text-xs"
              options={[
                { value: 'ALL', label: 'All Time' },
                { value: 'THIS_MONTH', label: 'This Month' },
                { value: 'LAST_30_DAYS', label: 'Last 30 Days' },
              ]}
            />
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleExportExcel}
            leftIcon={<FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
          >
            Export Excel
          </Button>

          <Button
            size="sm"
            variant="primary"
            onClick={() => navigate('/projects')}
            leftIcon={<Plus className="w-4 h-4 text-amber-400" />}
          >
            New Project
          </Button>
        </div>
      </div>

      {/* Unassigned Projects Warning Banner if any */}
      {unassignedCount > 0 && (
        <div className="bg-amber-500/15 border-2 border-amber-500/30 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold flex-shrink-0 shadow-sm">
              <UserX className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-navy-950">
                {unassignedCount} {unassignedCount === 1 ? 'Project' : 'Projects'} without an Assigned Site In-Charge
              </h4>
              <p className="text-xs text-navy-900/80 mt-0.5">
                Site reports and on-ground expenses cannot be submitted until a Site In-Charge is assigned.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="amber"
            onClick={() => navigate('/projects')}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Assign In-Charge
          </Button>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Authorized Projects */}
        <Card className="border-l-4 border-l-navy-900">
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Authorized Projects
              </span>
              <div className="w-8 h-8 rounded-lg bg-navy-50 text-navy-900 flex items-center justify-center">
                <Building2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-black text-navy-950">
              {kpis?.totalProjectsCount || 0}
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between">
              <span>{kpis?.activeProjectsCount || 0} active in-progress</span>
              {unassignedCount > 0 ? (
                <span className="font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                  {unassignedCount} unassigned
                </span>
              ) : (
                <span className="font-semibold text-emerald-700">All assigned</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Approved Spend */}
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Approved Spend
              </span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-black text-emerald-700">
              {formatCompactINR(kpis?.approvedPaise || 0)}
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between">
              <span>{kpis?.budgetBurnPercentage || 0}% budget utilized</span>
              <span className="font-semibold text-slate-700">{kpis?.approvedCount || 0} expenses</span>
            </div>
          </CardContent>
        </Card>

        {/* Pending Approvals */}
        <Card
          className="border-l-4 border-l-amber-500 hover:border-amber-400 cursor-pointer"
          onClick={() => navigate('/approvals')}
        >
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Pending Approval
              </span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-black text-amber-700">
              {formatCompactINR(kpis?.pendingPaise || 0)}
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between">
              <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                {kpis?.pendingCount || 0} awaiting review
              </span>
              <span className="text-navy-900 font-semibold underline flex items-center gap-0.5">
                Review <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Remaining Budget */}
        <Card className="border-l-4 border-l-sky-500">
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Remaining Budget
              </span>
              <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                <FileCheck2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-black text-sky-800">
              {formatCompactINR(kpis?.remainingBudgetPaise || 0)}
            </div>
            <div className="text-xs text-slate-500 flex items-center justify-between">
              <span>Total: {formatCompactINR(kpis?.totalBudgetPaise || 0)}</span>
              <span className="font-semibold text-slate-700">
                {100 - (kpis?.budgetBurnPercentage || 0)}% left
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Compliance & Attention Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Missing Daily Reports Banner */}
        <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                Daily Report Compliance (Last 7 Days)
              </h4>
              {kpis?.missingReportsCount && kpis.missingReportsCount > 0 ? (
                <span className="text-[10px] bg-amber-500 text-navy-950 font-bold px-2 py-0.5 rounded-full">
                  {kpis.missingReportsCount} Missing
                </span>
              ) : (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                  100% Up to Date
                </span>
              )}
            </div>
            <p className="text-xs text-amber-900">
              {kpis?.submittedReportsLast7Days || 0} of {kpis?.expectedReportsLast7Days || 0} expected site reports submitted across active construction projects.
            </p>
            <button
              onClick={() => navigate('/reports')}
              className="text-xs font-bold text-amber-900 hover:text-amber-950 underline inline-flex items-center gap-1 pt-1"
            >
              <span>View Report History</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Projects Requiring Attention */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-navy-950 uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Projects Requiring Attention</span>
            </h4>
            <span className="text-xs text-slate-500">{attentionProjects.length} projects flagged</span>
          </div>

          {attentionProjects.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-1">
              All projects operating within normal budget thresholds and zero pending backlogs.
            </p>
          ) : (
            <div className="space-y-2 pt-1">
              {attentionProjects.slice(0, 2).map((p) => (
                <div
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="flex items-center justify-between p-2 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer text-xs transition-colors"
                >
                  <div>
                    <span className="font-bold text-navy-950">{p.name}</span>
                    <span className="text-slate-500 text-[11px] block">{p.code} • {p.inCharge}</span>
                  </div>
                  <div className="text-right">
                    <span className={`font-bold ${p.burnRate >= 80 ? 'text-rose-600' : 'text-slate-700'}`}>
                      {p.burnRate}% spent
                    </span>
                    {p.pending > 0 && (
                      <span className="text-[10px] text-amber-700 block font-semibold">
                        {formatCompactINR(p.pending)} pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recently Updated Projects & Real-Time Site Submissions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recently Updated Projects Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <div>
                <CardTitle>Recently Updated Projects</CardTitle>
                <p className="text-xs text-slate-500">Fast access to active sites and recent project modifications</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate('/projects')}
                rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                All Projects
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {recentlyUpdatedProjects.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No recently updated projects.</p>
            ) : (
              recentlyUpdatedProjects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="p-3 rounded-xl border border-slate-100 hover:border-amber-300 hover:bg-amber-50/30 cursor-pointer transition-colors flex items-center justify-between"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-navy-950">{p.name}</span>
                      <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                        {p.code}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                      <span>{p.location}</span>
                      <span>•</span>
                      <span className={p.inCharge === 'Unassigned' ? 'text-amber-700 font-bold' : 'text-slate-700'}>
                        In-Charge: {p.inCharge}
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <Badge status={p.status} size="sm" />
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Live Shared Site Submissions Feed */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <div>
                <CardTitle>Recent Site Reports & Expenses</CardTitle>
                <p className="text-xs text-slate-500">Instantly synced from site in-charges without delay</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate('/reports')}
                rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                View Feed
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {recentReports.length === 0 && recentExpenses.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No recent site reports or expenses recorded.</p>
            ) : (
              <div className="space-y-2">
                {/* Interleave or show top 3 reports and top 3 expenses */}
                {recentReports.slice(0, 3).map((r) => (
                  <div
                    key={r._id || r.id}
                    onClick={() => navigate('/reports')}
                    className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-bold text-navy-950 block">{r.titleOfWork || 'Site Daily Log'}</span>
                        <span className="text-[11px] text-slate-500">
                          {r.project?.code} • {r.submittedBy?.name || 'In-Charge'} • {formatDate(r.workDate)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                      Report
                    </span>
                  </div>
                ))}

                {recentExpenses.slice(0, 3).map((e) => (
                  <div
                    key={e._id || e.id}
                    onClick={() => navigate('/approvals')}
                    className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">
                        <Receipt className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <span className="font-bold text-navy-950 block">{e.description}</span>
                        <span className="text-[11px] text-slate-500">
                          {e.project?.code} • {e.vendor} • {formatINR(e.amount)}
                        </span>
                      </div>
                    </div>
                    <Badge status={e.status} size="sm" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Budget vs Actual Expenditure Chart */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Budget vs. Actual Expenditure</CardTitle>
              <p className="text-xs text-slate-500">Comparison of allocated budget vs verified spend per project</p>
            </div>
          </CardHeader>
          <CardContent>
            <ProjectBudgetBarChart data={projectExpenditures} />
          </CardContent>
        </Card>

        {/* Expense Category Breakdown Pie Chart */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Verified Expenditure by Category</CardTitle>
              <p className="text-xs text-slate-500">Materials, labour, fuel, and equipment cost distribution</p>
            </div>
          </CardHeader>
          <CardContent>
            <CategoryExpensePieChart data={dashboardData?.categoryBreakdown || []} />
          </CardContent>
        </Card>
      </div>

      {/* Expenditure Trend Over Time */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Expenditure Trend Over Time</CardTitle>
            <p className="text-xs text-slate-500">Monthly financial flow across all active project sites</p>
          </div>
        </CardHeader>
        <CardContent>
          <ExpenditureTrendChart data={dashboardData?.expenditureTrend || []} />
        </CardContent>
      </Card>

      {/* Multi-Project Financial Summary Table */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Authorized Construction Projects Overview</CardTitle>
            <p className="text-xs text-slate-500">Real-time status, in-charge site engineers, and budget burn rate</p>
          </div>
          <Button
            size="sm"
            variant="amber"
            onClick={() => navigate('/projects')}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Manage Projects
          </Button>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Site In-Charge</th>
                <th className="py-3 px-4 text-right">Budget</th>
                <th className="py-3 px-4 text-right">Approved Spend</th>
                <th className="py-3 px-4 text-right">Pending</th>
                <th className="py-3 px-4 text-center">Burn %</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {projectExpenditures.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3.5 px-4">
                    <span className="font-bold text-navy-950 block">{p.name}</span>
                    <span className="font-mono text-[11px] text-slate-500">{p.code} • {p.location}</span>
                  </td>
                  <td className="py-3.5 px-4">
                    {p.inCharge && p.inCharge !== 'Unassigned' ? (
                      <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-navy-800" />
                        {p.inCharge}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">
                        <UserX className="w-3 h-3" />
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right font-bold text-navy-950">
                    {formatINR(p.budget)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-bold text-emerald-700">
                    {formatINR(p.approved)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-semibold text-amber-700">
                    {p.pending > 0 ? formatINR(p.pending) : '—'}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded font-bold text-xs ${
                      p.burnRate >= 80 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-800'
                    }`}>
                      {p.burnRate}%
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <Badge status={p.status} size="sm" />
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/projects/${p.id}`)}
                      rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                    >
                      Workspace
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
