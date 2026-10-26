import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  MapPin,
  Calendar,
  User,
  DollarSign,
  FileSpreadsheet,
  FileDown,
  Plus,
  ArrowLeft,
  Edit,
  ClipboardList,
  Receipt,
  Clock,
  CheckCircle2,
  Users,
  UserX,
  Truck,
  HardHat,
  AlertTriangle,
  Layers,
  ArrowRightLeft,
  FileText,
  Boxes,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { Select } from '../components/common/Input.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { ExpenseTable } from '../components/expenses/ExpenseTable.js';
import { DailyReportCard } from '../components/reports/DailyReportCard.js';
import { ProjectModal } from '../components/projects/ProjectModal.js';
import { AssignInChargeModal } from '../components/projects/AssignInChargeModal.js';
import { useAuth } from '../context/AuthContext.js';
import { Project, Expense, DailyReport } from '../types/index.js';
import { formatCompactINR, formatINR } from '../utils/currency.js';
import { formatDate } from '../utils/dates.js';
import { exportProjectExpensesPdf } from '../utils/exportPdf.js';
import { downloadExpensesExcel } from '../utils/exportExcel.js';
import { api } from '../api/client.js';

export const ProjectDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isOwner, isMD } = useAuth();

  type WorkspaceModule =
    | 'overview'
    | 'reports'
    | 'workItems'
    | 'expenses'
    | 'labour'
    | 'materials'
    | 'machinery'
    | 'issues'
    | 'exports';

  const [activeTab, setActiveTab] = useState<WorkspaceModule>('overview');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  // Fetch Project details
  const { data: projectData, isLoading: isProjectLoading, refetch: refetchProject } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<{ success: boolean; project: Project }>(`/projects/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15000,
  });

  // Fetch all authorized projects for the Switch Project dropdown
  const { data: allProjectsData } = useQuery({
    queryKey: ['authorized-projects-dropdown'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });

  // Fetch project expenses
  const { data: expensesData, isLoading: isExpensesLoading } = useQuery({
    queryKey: ['project-expenses', id],
    queryFn: () => api.get<{ count: number; expenses: Expense[] }>(`/expenses?projectId=${id}`),
    enabled: Boolean(id),
    refetchInterval: 15000,
  });

  // Fetch project daily reports
  const { data: reportsData, isLoading: isReportsLoading } = useQuery({
    queryKey: ['project-reports', id],
    queryFn: () => api.get<{ count: number; reports: DailyReport[] }>(`/daily-reports?projectId=${id}`),
    enabled: Boolean(id),
    refetchInterval: 15000,
  });

  if (isProjectLoading || !projectData) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton rows={1} height="h-20" />
        <LoadingSkeleton rows={4} height="h-32" />
      </div>
    );
  }

  const project = projectData.project;
  const financials = project.financials;
  const expenses = expensesData?.expenses || [];
  const reports = reportsData?.reports || [];
  const authorizedProjects = allProjectsData?.projects || [];

  // Resolve all assigned in-charges (supports N in-charges per project)
  const assignedEngineers: any[] = [];
  const seenIds = new Set<string>();

  if (project.activeAssignments && project.activeAssignments.length > 0) {
    project.activeAssignments.forEach((a: any) => {
      const u = a.siteInCharge;
      if (u && !seenIds.has(String(u._id || u.id))) {
        seenIds.add(String(u._id || u.id));
        assignedEngineers.push(u);
      }
    });
  }

  if (project.assignedInCharge && !seenIds.has(String(project.assignedInCharge._id || project.assignedInCharge.id))) {
    assignedEngineers.push(project.assignedInCharge);
  }

  const hasInCharges = assignedEngineers.length > 0;

  const handleExportPdf = () => {
    exportProjectExpensesPdf(project, expenses);
  };

  const handleExportExcel = () => {
    downloadExpensesExcel({ projectId: project._id || project.id! });
  };

  // Compile Work Items from all daily reports
  const allWorkItems = reports.flatMap((r) =>
    (r.workItems || []).map((w) => ({
      ...w,
      workDate: r.workDate,
      reportTitle: r.titleOfWork,
      submittedBy: r.submittedBy?.name || 'In-Charge',
    }))
  );

  // Compile Labour counts from all daily reports
  const allLabourItems = reports.flatMap((r) =>
    (r.labourBreakdown || []).map((l) => ({
      ...l,
      workDate: r.workDate,
      reportTitle: r.titleOfWork,
    }))
  );

  // Compile Issues & Delays from daily reports
  const allIssues = reports.filter((r) => r.issuesAndDelays && r.issuesAndDelays.trim().length > 0);

  // Compile Equipment & Machinery from daily reports
  const allMachinery = reports.filter((r) => r.equipmentDetails && r.equipmentDetails.trim().length > 0);

  return (
    <div className="space-y-6">
      {/* Top Header: Breadcrumbs, Switch Project Selector, and Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/projects')}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                {project.code}
              </span>
              <Badge status={project.status} size="sm" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-navy-950 mt-1">{project.name}</h1>
          </div>
        </div>

        {/* Project Switcher & Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Switch Project Dropdown */}
          {authorizedProjects.length > 1 && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold text-slate-600 px-2 flex items-center gap-1">
                <ArrowRightLeft className="w-3 h-3 text-navy-900" />
                Switch Project:
              </span>
              <select
                value={project._id || project.id}
                onChange={(e) => navigate(`/projects/${e.target.value}`)}
                className="text-xs bg-white border border-slate-300 rounded-lg py-1 px-2 font-medium text-navy-950 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                {authorizedProjects.map((p) => (
                  <option key={p._id || p.id} value={p._id || p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsEditModalOpen(true)}
              leftIcon={<Edit className="w-3.5 h-3.5" />}
            >
              Edit Scope
            </Button>
          )}

          <Button
            size="sm"
            variant="amber"
            onClick={() => setIsAssignModalOpen(true)}
            leftIcon={<Users className="w-3.5 h-3.5" />}
          >
            {hasInCharges ? `Manage In-Charges (${assignedEngineers.length})` : 'Assign In-Charge'}
          </Button>

          <Button
            size="sm"
            variant="primary"
            onClick={handleExportPdf}
            leftIcon={<FileDown className="w-3.5 h-3.5 text-amber-400" />}
          >
            PDF Statement
          </Button>
        </div>
      </div>

      {/* Unassigned Warning Alert Banner if no in-charge */}
      {!hasInCharges && (
        <div className="bg-amber-500/15 border-2 border-amber-500/40 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold flex-shrink-0 shadow-sm">
              <UserX className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-navy-950">No Site In-Charge Assigned</h4>
              <p className="text-xs text-navy-900/80 mt-0.5">
                Daily reports, work item amounts, and site expenses cannot be entered until an In-Charge is assigned.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="amber"
            onClick={() => setIsAssignModalOpen(true)}
            leftIcon={<Users className="w-4 h-4" />}
          >
            Assign In-Charge Now
          </Button>
        </div>
      )}

      {/* Financial Health & KPI Strip - Strictly visible to MD only */}
      {isMD ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Total Budget
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-navy-950 block mt-1">
              {formatCompactINR(project.budget)}
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">{formatINR(project.budget)}</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-card bg-emerald-50/20">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
              Approved Spend
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-emerald-700 block mt-1">
              {financials ? formatCompactINR(financials.approvedPaise) : '₹0'}
            </span>
            <span className="text-[11px] text-emerald-600 mt-0.5 block">
              {financials?.burnPercentage || 0}% budget utilized
            </span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-card bg-amber-50/20">
            <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block">
              Pending Approval
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-amber-700 block mt-1">
              {financials ? formatCompactINR(financials.pendingPaise) : '₹0'}
            </span>
            <span className="text-[11px] text-amber-600 mt-0.5 block">
              {financials?.pendingCount || 0} bills pending review
            </span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-sky-200 shadow-card bg-sky-50/20">
            <span className="text-[11px] font-bold text-sky-800 uppercase tracking-wider block">
              Remaining Budget
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-sky-800 block mt-1">
              {financials ? formatCompactINR(financials.remainingPaise) : '₹0'}
            </span>
            <span className="text-[11px] text-sky-600 mt-0.5 block">Available uncommitted</span>
          </div>
        </div>
      ) : (
        /* Operational Strip for Site In-Charge */
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-card">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Daily Construction Logs
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-navy-950 block mt-1">
              {reports.length}
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">Logged site entries</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-card bg-emerald-50/20">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
              Site Expense Claims
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-emerald-700 block mt-1">
              {expenses.length}
            </span>
            <span className="text-[11px] text-emerald-600 mt-0.5 block">Total recorded vouchers</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-card bg-amber-50/20 col-span-2 sm:col-span-1">
            <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block">
              Pending Verification
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-amber-700 block mt-1">
              {expenses.filter(e => e.status === 'PENDING').length}
            </span>
            <span className="text-[11px] text-amber-600 mt-0.5 block">Under MD review</span>
          </div>
        </div>
      )}

      {/* Project Workspace Module Navigation Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-200 scrollbar-none">
        <button
          onClick={() => setActiveTab('overview')}
          className={`py-2 px-3 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'overview'
              ? 'bg-navy-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
          }`}
        >
          Project Overview
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`py-2 px-3 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === 'reports'
              ? 'bg-navy-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Daily Reports</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/80 text-navy-950 font-bold">
            {reports.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('workItems')}
          className={`py-2 px-3 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === 'workItems'
              ? 'bg-navy-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Work Items & Quantities</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/80 text-navy-950 font-bold">
            {allWorkItems.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('expenses')}
          className={`py-2 px-3 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === 'expenses'
              ? 'bg-navy-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>Expenditure</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200/80 text-navy-950 font-bold">
            {expenses.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('labour')}
          className={`py-2 px-3 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === 'labour'
              ? 'bg-navy-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
          }`}
        >
          <HardHat className="w-3.5 h-3.5" />
          <span>Labour Breakdown</span>
        </button>

        <button
          onClick={() => setActiveTab('materials')}
          className={`py-2 px-3 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === 'materials'
              ? 'bg-navy-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
          }`}
        >
          <Boxes className="w-3.5 h-3.5" />
          <span>Materials & Stock</span>
        </button>

        <button
          onClick={() => setActiveTab('machinery')}
          className={`py-2 px-3 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === 'machinery'
              ? 'bg-navy-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span>Machinery & Equipment</span>
        </button>

        <button
          onClick={() => setActiveTab('issues')}
          className={`py-2 px-3 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === 'issues'
              ? 'bg-navy-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span>Issues & Instructions</span>
          {allIssues.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-200 text-amber-900 font-bold">
              {allIssues.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('exports')}
          className={`py-2 px-3 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 ${
            activeTab === 'exports'
              ? 'bg-navy-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-navy-950'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
          <span>Reports & Exports</span>
        </button>
      </div>

      {/* MODULE 1: Overview */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Project Details & Scope of Work</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-700 leading-relaxed">
                  {project.description || 'No detailed scope of work specified.'}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-xs">
                  <div>
                    <span className="text-slate-400 font-medium block">Site Location:</span>
                    <span className="font-semibold text-slate-800 block mt-0.5">{project.location}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-medium block">Project Schedule:</span>
                    <span className="font-semibold text-slate-800 block mt-0.5">
                      {project.startDate ? formatDate(project.startDate) : 'Not set'} to{' '}
                      {project.expectedCompletionDate ? formatDate(project.expectedCompletionDate) : 'Not set'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions Strip */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="amber"
                onClick={() => navigate('/reports/new')}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Log Today&apos;s Daily Report
              </Button>

              <Button
                variant="primary"
                onClick={() => navigate('/expenses/new')}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                Submit Site Expense
              </Button>

              <Button
                variant="outline"
                onClick={() => setIsAssignModalOpen(true)}
                leftIcon={<Users className="w-4 h-4 text-navy-800" />}
              >
                Manage In-Charge Assignment
              </Button>
            </div>
          </div>

          {/* Right Column: In-Charge Card */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>
                  Assigned Site In-Charges {hasInCharges && `(${assignedEngineers.length})`}
                </CardTitle>
                {hasInCharges && (
                  <button
                    type="button"
                    onClick={() => setIsAssignModalOpen(true)}
                    className="text-xs font-bold text-amber-700 hover:text-amber-800 transition-colors"
                  >
                    + Assign More
                  </button>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {hasInCharges ? (
                  <>
                    <div className="space-y-3 max-h-80 overflow-y-auto divide-y divide-slate-100 pr-1">
                      {assignedEngineers.map((engineer: any, idx: number) => (
                        <div key={engineer._id || engineer.id || idx} className="pt-2 first:pt-0 space-y-2">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold text-sm shadow-sm flex-shrink-0">
                              {engineer.name?.charAt(0) || 'E'}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="font-bold text-navy-950 text-xs truncate">{engineer.name}</h4>
                              <span className="text-[10px] text-slate-500 font-medium block">Site In-Charge</span>
                            </div>
                          </div>

                          <div className="space-y-1 text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                            <div className="flex justify-between">
                              <span className="text-slate-400">Email:</span>
                              <span className="font-semibold text-slate-700 truncate ml-2">{engineer.email}</span>
                            </div>
                            {engineer.phone && (
                              <div className="flex justify-between">
                                <span className="text-slate-400">Phone:</span>
                                <span className="font-semibold text-slate-700 ml-2">{engineer.phone}</span>
                              </div>
                            )}
                            {isMD && (
                              <div className="flex justify-between pt-1 border-t border-slate-200/60">
                                <span className="text-slate-500 font-medium">Salary (MD View):</span>
                                <span className="font-bold text-emerald-700 ml-2">
                                  {engineer.salary !== undefined && engineer.salary !== null
                                    ? `${formatINR(engineer.salary)} / ${(engineer.salaryFrequency || 'monthly').toLowerCase().replace('_', ' ')}`
                                    : 'Not set'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full mt-3 font-semibold"
                      onClick={() => setIsAssignModalOpen(true)}
                    >
                      Manage In-Charge Assignments
                    </Button>
                  </>
                ) : (
                  <div className="text-center py-4 space-y-3">
                    <UserX className="w-10 h-10 text-amber-500 mx-auto" />
                    <div>
                      <h4 className="text-xs font-bold text-navy-950">No In-Charge Assigned</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Assign engineers to enable field daily reports and site expenses.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="amber"
                      onClick={() => setIsAssignModalOpen(true)}
                    >
                      Assign In-Charge
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* MODULE 2: Daily Reports */}
      {activeTab === 'reports' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Project Daily Site Register</CardTitle>
              <p className="text-xs text-slate-500">Every daily report submitted for this project with Work Titles</p>
            </div>
            <Button
              size="sm"
              variant="amber"
              onClick={() => navigate('/reports/new')}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Log Daily Report
            </Button>
          </CardHeader>
          <CardContent>
            {reports.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                No daily construction reports submitted for this project yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reports.map((report) => (
                  <DailyReportCard key={report._id || report.id} report={report} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* MODULE 3: Work Items and Quantities */}
      {activeTab === 'workItems' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Work Items and Completed Quantities</CardTitle>
              <p className="text-xs text-slate-500">Chronological register of all construction work items and units</p>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            {allWorkItems.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No specific work item quantities recorded yet in daily reports.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 font-bold uppercase tracking-wider">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Daily Report Title</th>
                    <th className="py-3 px-4">Item Description</th>
                    <th className="py-3 px-4 text-right">Quantity</th>
                    <th className="py-3 px-4 text-left">Unit</th>
                    <th className="py-3 px-4">Submitted By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {allWorkItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-semibold text-slate-700">{formatDate(item.workDate)}</td>
                      <td className="py-3 px-4 font-bold text-navy-950">{item.reportTitle}</td>
                      <td className="py-3 px-4 text-slate-800">{item.description}</td>
                      <td className="py-3 px-4 text-right font-black text-navy-950">{item.quantity}</td>
                      <td className="py-3 px-4 font-semibold text-slate-600">{item.unit}</td>
                      <td className="py-3 px-4 text-slate-500">{item.submittedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {/* MODULE 4: Expenditure */}
      {activeTab === 'expenses' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Project Expenditure Register</CardTitle>
              <p className="text-xs text-slate-500">All expenses logged, verified bills, and status history</p>
            </div>
            <Button
              size="sm"
              variant="amber"
              onClick={() => navigate('/expenses/new')}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              New Expense
            </Button>
          </CardHeader>
          <ExpenseTable expenses={expenses} isOwner={isOwner} />
        </Card>
      )}

      {/* MODULE 5: Labour Breakdown */}
      {activeTab === 'labour' && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Labour Attendance & Trade Counts</CardTitle>
              <p className="text-xs text-slate-500">Masons, carpenters, bar benders, electricians, and helpers</p>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            {allLabourItems.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No labour breakdowns recorded yet in daily reports.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 font-bold uppercase tracking-wider">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Daily Report</th>
                    <th className="py-3 px-4">Labour Trade / Role</th>
                    <th className="py-3 px-4 text-right">Headcount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {allLabourItems.map((labour, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-semibold text-slate-700">{formatDate(labour.workDate)}</td>
                      <td className="py-3 px-4 font-bold text-navy-950">{labour.reportTitle}</td>
                      <td className="py-3 px-4 font-medium text-slate-800">{labour.role}</td>
                      <td className="py-3 px-4 text-right font-black text-amber-700">{labour.count} workers</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {/* MODULE 6: Materials and Stock */}
      {activeTab === 'materials' && (
        <Card>
          <CardHeader>
            <CardTitle>Materials & Stock Consumption Records</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500">
              Aggregated from verified daily reports and material expenditure entries.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {expenses
                .filter((e) => e.category === 'CONSTRUCTION_MATERIALS')
                .map((m) => (
                  <div key={m._id || m.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-xs text-navy-950">{m.description}</span>
                      <span className="font-bold text-xs text-emerald-700">{formatINR(m.amount)}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex justify-between">
                      <span>Vendor: {m.vendor}</span>
                      <span>{formatDate(m.date)}</span>
                    </div>
                  </div>
                ))}
            </div>
            {expenses.filter((e) => e.category === 'CONSTRUCTION_MATERIALS').length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                No material purchase records recorded for this project yet.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* MODULE 7: Machinery and Equipment */}
      {activeTab === 'machinery' && (
        <Card>
          <CardHeader>
            <CardTitle>Machinery & Heavy Equipment Log</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {allMachinery.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No machinery or equipment logs documented in daily site reports yet.
              </div>
            ) : (
              <div className="space-y-2">
                {allMachinery.map((m) => (
                  <div key={m._id || m.id} className="p-3 rounded-xl border border-slate-200 bg-white space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-bold text-navy-950">{m.titleOfWork}</span>
                      <span className="text-slate-500">{formatDate(m.workDate)}</span>
                    </div>
                    <p className="text-xs text-slate-700 bg-slate-50 p-2 rounded-lg font-mono">
                      {m.equipmentDetails}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* MODULE 8: Issues and Instructions */}
      {activeTab === 'issues' && (
        <Card>
          <CardHeader>
            <CardTitle>Site Issues, Delays & Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {allIssues.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No issues or site delays flagged in daily reports. All sites proceeding smoothly!
              </div>
            ) : (
              <div className="space-y-3">
                {allIssues.map((issue) => (
                  <div key={issue._id || issue.id} className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2">
                    <div className="flex justify-between text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-amber-950">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span>{issue.titleOfWork}</span>
                      </div>
                      <span className="text-slate-500">{formatDate(issue.workDate)}</span>
                    </div>
                    <p className="text-xs text-amber-900 leading-relaxed">
                      {issue.issuesAndDelays}
                    </p>
                    {issue.nextDayPlan && (
                      <div className="text-[11px] text-slate-600 pt-1 border-t border-amber-200/50">
                        <strong>Mitigation / Next Day Plan:</strong> {issue.nextDayPlan}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* MODULE 9: Reports and Exports */}
      {activeTab === 'exports' && (
        <Card>
          <CardHeader>
            <CardTitle>Project Financial Reports & Audit Export Center</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3">
                <FileDown className="w-8 h-8 text-amber-600" />
                <h4 className="font-bold text-sm text-navy-950">Official PDF Financial Statement</h4>
                <p className="text-xs text-slate-500">
                  Comprehensive audit statement with project metadata, budget utilization, category breakdowns, and verified line-item receipts.
                </p>
                <Button variant="primary" onClick={handleExportPdf} leftIcon={<FileDown className="w-4 h-4 text-amber-400" />}>
                  Export Project PDF
                </Button>
              </div>

              <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3">
                <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                <h4 className="font-bold text-sm text-navy-950">Excel Data Register (.xlsx)</h4>
                <p className="text-xs text-slate-500">
                  Raw tabular export of all expenses, vendors, GST tags, approval dates, and site engineers for accounting and reconciliation.
                </p>
                <Button variant="outline" onClick={handleExportExcel} leftIcon={<FileSpreadsheet className="w-4 h-4 text-emerald-600" />}>
                  Download Excel Spreadsheet
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Project Edit Scope Modal */}
      {isEditModalOpen && (
        <ProjectModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          project={project}
        />
      )}

      {/* Assign / Manage In-Charge Modal */}
      {isAssignModalOpen && (
        <AssignInChargeModal
          projectId={project._id || project.id!}
          projectName={project.name}
          projectCode={project.code}
          isOpen={isAssignModalOpen}
          onClose={() => setIsAssignModalOpen(false)}
          onUpdated={() => {
            refetchProject();
          }}
        />
      )}
    </div>
  );
};
