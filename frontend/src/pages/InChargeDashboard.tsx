import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  FileText,
  DollarSign,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Eye,
  AlertTriangle,
  HardHat,
  UserX,
  Layers,
  ArrowRightLeft,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { ExpenseCard } from '../components/expenses/ExpenseCard.js';
import { ExpenseResubmitModal } from '../components/expenses/ExpenseResubmitModal.js';
import { InChargeDashboardData, Expense } from '../types/index.js';
import { formatCompactINR, formatINR } from '../utils/currency.js';
import { formatDate } from '../utils/dates.js';
import { useToast } from '../context/ToastContext.js';
import { api } from '../api/client.js';

export const InChargeDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [resubmitTarget, setResubmitTarget] = useState<Expense | null>(null);
  const [selectedProjectIndex, setSelectedProjectIndex] = useState<number>(0);

  // Poll every 15s to catch Owner approvals or rejections near-real-time!
  const { data: dashboard, isLoading, refetch } = useQuery({
    queryKey: ['in-charge-dashboard'],
    queryFn: () => api.get<InChargeDashboardData>('/dashboard/in-charge'),
    refetchInterval: 15000,
  });

  const resubmitMutation = useMutation({
    mutationFn: async (updatedData: any) => {
      return api.post(`/expenses/${updatedData.id}/resubmit`, updatedData);
    },
    onSuccess: () => {
      success('Expense corrected and resubmitted to Owner for review!');
      setResubmitTarget(null);
      queryClient.invalidateQueries({ queryKey: ['in-charge-dashboard'] });
    },
    onError: (err: any) => {
      toastError(err.message || 'Failed to resubmit expense');
    },
  });

  if (isLoading && !dashboard) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton rows={1} height="h-36" />
        <LoadingSkeleton rows={2} height="h-24" />
        <LoadingSkeleton rows={3} height="h-48" />
      </div>
    );
  }

  const assignedProjects = dashboard?.assignedProjects || [];
  const isUnassigned = assignedProjects.length === 0;
  const activeProject = assignedProjects[selectedProjectIndex] || assignedProjects[0];
  const todayReportStatus = dashboard?.todayReportStatus;
  const recentReports = dashboard?.recentReports || [];
  const pendingExpenses = dashboard?.pendingExpenses || [];
  const rejectedExpenses = dashboard?.rejectedExpenses || [];
  const approvedExpenses = dashboard?.approvedExpenses || [];

  return (
    <div className="space-y-5">
      {/* 1. Empty State when In-Charge has no assigned projects */}
      {isUnassigned ? (
        <div className="bg-white rounded-3xl border-2 border-amber-300 p-8 sm:p-12 text-center shadow-card space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
            <HardHat className="w-8 h-8" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900">
              <UserX className="w-3.5 h-3.5" />
              Awaiting Managing Director Project Assignment
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-navy-950">
              No Construction Projects Assigned
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Your Site In-Charge account is active. To begin submitting daily site logs, recording work items, and entering expenses, your Managing Director must first assign you to an active project.
            </p>
          </div>
          <div className="pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              leftIcon={<RefreshCw className="w-4 h-4 text-amber-600" />}
            >
              Check for New Assignments
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Multiple Projects Switcher if assigned to > 1 */}
          {assignedProjects.length > 1 && (
            <div className="flex items-center justify-between bg-slate-100 p-2 rounded-2xl border border-slate-200">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 pl-2">
                <ArrowRightLeft className="w-3.5 h-3.5 text-navy-900" />
                Assigned Projects ({assignedProjects.length}):
              </span>
              <div className="flex items-center gap-1 overflow-x-auto">
                {assignedProjects.map((p, idx) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProjectIndex(idx)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                      selectedProjectIndex === idx
                        ? 'bg-navy-900 text-white shadow-sm'
                        : 'bg-white text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {p.code} - {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Hero Card for Assigned Construction Project */}
          <div className="bg-gradient-to-br from-navy-900 to-navy-950 text-white rounded-3xl p-5 sm:p-6 shadow-xl border border-navy-800 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded-md">
                  {activeProject.code}
                </span>
                <h2 className="text-lg sm:text-xl font-black text-white mt-1.5 leading-snug">
                  {activeProject.name}
                </h2>
                <span className="text-xs text-navy-200 mt-0.5 block">{activeProject.location}</span>
              </div>

              <Button
                size="sm"
                variant="amber"
                onClick={() => navigate(`/projects/${activeProject.id}`)}
                rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Project Workspace
              </Button>
            </div>

            {/* Budget progress bar */}
            <div className="space-y-1.5 pt-2 border-t border-navy-800/80">
              <div className="flex items-center justify-between text-xs">
                <span className="text-navy-300">Site Budget: {formatCompactINR(activeProject.budget)}</span>
                <span className="font-bold text-emerald-400">
                  Approved Spend: {formatCompactINR(activeProject.approved)}
                </span>
              </div>
              <div className="w-full bg-navy-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-500 h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      activeProject.budget > 0
                        ? Math.round((activeProject.approved / activeProject.budget) * 100)
                        : 0
                    )}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-navy-300 pt-0.5">
                <span>Remaining: {formatCompactINR(activeProject.remaining)}</span>
                {activeProject.pending > 0 && (
                  <span className="text-amber-400 font-semibold">
                    {formatCompactINR(activeProject.pending)} pending review
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Today's Daily Report Quick Action Status Card */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm font-bold text-navy-950">Today&apos;s Daily Construction Log</h3>
              </div>
              <div>
                {todayReportStatus === 'SUBMITTED' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Submitted
                  </span>
                ) : todayReportStatus === 'DRAFT' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                    <Clock className="w-3.5 h-3.5" />
                    Draft Saved
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Missing Today
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Log manual work titles, completed quantities, labour counts, and site photos for {activeProject.name} ({activeProject.code}).
            </p>

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="amber"
                onClick={() => navigate(`/reports/new?projectId=${activeProject.id}`)}
                leftIcon={<Plus className="w-4 h-4" />}
                className="w-full sm:w-auto font-bold"
              >
                Log Today&apos;s Report
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/reports')}
                className="w-full sm:w-auto"
              >
                View Past Reports
              </Button>
            </div>
          </div>

          {/* Quick Action Buttons Grid */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => navigate(`/expenses/new?projectId=${activeProject.id}`)}
              className="p-4 rounded-2xl bg-white border border-slate-200 hover:border-amber-400 hover:shadow-card transition-all text-left space-y-1.5 group"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <DollarSign className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold text-navy-950 block group-hover:text-amber-800">
                Submit Site Expense
              </span>
              <span className="text-[11px] text-slate-500 block leading-tight">
                Bill upload with camera receipt photo
              </span>
            </button>

            <button
              onClick={() => navigate(`/projects/${activeProject.id}`)}
              className="p-4 rounded-2xl bg-white border border-slate-200 hover:border-navy-400 hover:shadow-card transition-all text-left space-y-1.5 group"
            >
              <div className="w-9 h-9 rounded-xl bg-navy-50 text-navy-900 flex items-center justify-center font-bold">
                <Building2 className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold text-navy-950 block group-hover:text-navy-900">
                Project Workspace
              </span>
              <span className="text-[11px] text-slate-500 block leading-tight">
                Work items, labour, machinery logs
              </span>
            </button>
          </div>

          {/* Action Required: Rejected Expenses Alert */}
          {rejectedExpenses.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-800 font-bold text-xs uppercase tracking-wider">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>Action Required: {rejectedExpenses.length} Rejected Expense(s)</span>
                </div>
                <span className="text-[11px] text-rose-600 font-semibold">Correct & Resubmit</span>
              </div>

              <div className="space-y-2">
                {rejectedExpenses.slice(0, 3).map((exp) => (
                  <div
                    key={exp._id || exp.id}
                    className="bg-white p-3 rounded-xl border border-rose-100 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-navy-950 block">{exp.description}</span>
                      <span className="text-[11px] text-rose-700 font-medium">
                        Reason: {exp.rejectionReason || 'Receipt unclear'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-navy-950">{formatINR(exp.amount)}</span>
                      <Button
                        size="sm"
                        variant="amber"
                        onClick={() => setResubmitTarget(exp)}
                        className="text-xs py-1 px-2.5"
                      >
                        Resubmit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Expenses List with Statuses */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-card space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-navy-950">Recent Site Submissions</h3>
                <p className="text-xs text-slate-500">Live review status from Managing Director</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate('/expenses')}
                rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                All
              </Button>
            </div>

            <div className="space-y-2">
              {pendingExpenses.slice(0, 3).map((e) => (
                <ExpenseCard key={e._id || e.id} expense={e} isOwner={false} />
              ))}
              {approvedExpenses.slice(0, 2).map((e) => (
                <ExpenseCard key={e._id || e.id} expense={e} isOwner={false} />
              ))}
              {pendingExpenses.length === 0 && approvedExpenses.length === 0 && (
                <p className="text-xs text-slate-400 italic py-2 text-center">
                  No expenses submitted yet for this project.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Resubmit Modal */}
      {resubmitTarget && (
        <ExpenseResubmitModal
          expense={resubmitTarget}
          isOpen={Boolean(resubmitTarget)}
          onClose={() => setResubmitTarget(null)}
          onResubmit={(data: any) => resubmitMutation.mutate(data)}
          isLoading={resubmitMutation.isPending}
        />
      )}
    </div>
  );
};
