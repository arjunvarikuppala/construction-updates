import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileCheck2,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Receipt,
  AlertTriangle,
  Building2,
  RefreshCw,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Badge } from '../components/common/Badge.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ExpenseApprovalModal } from '../components/expenses/ExpenseApprovalModal.js';
import { ExpenseRejectModal } from '../components/expenses/ExpenseRejectModal.js';
import { Expense } from '../types/index.js';
import { formatINR } from '../utils/currency.js';
import { formatDate } from '../utils/dates.js';
import { useToast } from '../context/ToastContext.js';
import { api } from '../api/client.js';

export const ApprovalsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [approvalTarget, setApprovalTarget] = useState<Expense | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Expense | null>(null);

  // Poll every 10 seconds for real-time sync with mobile in-charge submissions!
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pending-approvals-queue'],
    queryFn: () => api.get<{ count: number; expenses: Expense[] }>('/expenses?status=PENDING'),
    refetchInterval: 10000,
  });

  const approveMutation = useMutation({
    mutationFn: (expenseId: string) => api.post(`/expenses/${expenseId}/approve`),
    onSuccess: () => {
      success('Expense approved! Synchronization update pushed to in-charge phone.');
      setApprovalTarget(null);
      queryClient.invalidateQueries({ queryKey: ['pending-approvals-queue'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals-count'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err: any) => toastError(err.message || 'Failed to approve expense'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ expenseId, reason }: { expenseId: string; reason: string }) =>
      api.post(`/expenses/${expenseId}/reject`, { reason }),
    onSuccess: () => {
      success('Expense rejected with documented reason.');
      setRejectTarget(null);
      queryClient.invalidateQueries({ queryKey: ['pending-approvals-queue'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals-count'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err: any) => toastError(err.message || 'Failed to reject expense'),
  });

  const pendingExpenses = data?.expenses || [];
  const totalPendingAmount = pendingExpenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">
              Expense Approval Queue
            </h1>
            <span className="text-xs font-bold bg-amber-500 text-navy-950 px-2.5 py-0.5 rounded-full">
              {pendingExpenses.length} Pending
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Audit submitted bills, inspect receipts, verify budget allocations, and approve expenditures.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            leftIcon={<RefreshCw className="w-3.5 h-3.5 text-amber-500" />}
          >
            Refresh Queue
          </Button>
        </div>
      </div>

      {/* Summary Banner */}
      <div className="bg-gradient-to-r from-navy-900 to-navy-950 text-white rounded-2xl p-5 shadow-lg border border-navy-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider block">
            Awaiting Executive Verification
          </span>
          <div className="text-2xl sm:text-3xl font-black text-white mt-1">
            {formatINR(totalPendingAmount)}
          </div>
          <p className="text-xs text-navy-200 mt-0.5">
            Across {new Set(pendingExpenses.map((e) => e.project?._id || e.project?.code)).size} construction projects
          </p>
        </div>

        <div className="text-xs text-navy-200 bg-navy-800/80 p-3 rounded-xl border border-navy-700/80 max-w-sm">
          <span className="font-bold text-white block mb-0.5">Real-time Cross Device Sync:</span>
          Approvals completed here update on the site in-charge&apos;s mobile phone immediately.
        </div>
      </div>

      {/* Pending Items List */}
      {isLoading ? (
        <div className="space-y-4">
          <LoadingSkeleton rows={1} height="h-28" />
          <LoadingSkeleton rows={1} height="h-28" />
        </div>
      ) : pendingExpenses.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="All expense submissions cleared!"
          description="There are currently no expenses awaiting review. New mobile submissions will appear here automatically."
        />
      ) : (
        <div className="space-y-4">
          {pendingExpenses.map((expense) => {
            const id = expense._id || expense.id!;
            return (
              <div
                key={id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-card hover:shadow-card-hover transition-all flex flex-col md:flex-row items-stretch md:items-center justify-between gap-5"
              >
                {/* Left Details */}
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-navy-950 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                      {expense.project?.code}
                    </span>
                    <Badge category={expense.category} size="sm" />
                    <span className="text-xs text-slate-500 font-medium">
                      Submitted on {formatDate(expense.date, 'dd MMM yyyy')} by {expense.submittedBy?.name}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-navy-950">{expense.vendor}</h3>
                    <p className="text-xs text-slate-600 mt-0.5">{expense.description}</p>
                  </div>

                  {expense.receiptUrl && (
                    <div className="pt-1">
                      <a
                        href={expense.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-navy-900 hover:text-amber-600 hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                        <span>Inspect Attached Receipt / Tax Invoice</span>
                      </a>
                    </div>
                  )}
                </div>

                {/* Right Amount & Actions */}
                <div className="flex flex-col sm:flex-row md:flex-col items-start sm:items-center md:items-end justify-between gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="text-left md:text-right">
                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                      Claimed Amount
                    </span>
                    <span className="text-xl sm:text-2xl font-black text-navy-950 block">
                      {formatINR(expense.amount)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs text-rose-700 border-rose-200 hover:bg-rose-50 flex-1 sm:flex-none"
                      onClick={() => setRejectTarget(expense)}
                      leftIcon={<XCircle className="w-4 h-4 text-rose-600" />}
                    >
                      Reject
                    </Button>

                    <Button
                      size="sm"
                      variant="amber"
                      className="text-xs font-bold flex-1 sm:flex-none"
                      onClick={() => setApprovalTarget(expense)}
                      leftIcon={<CheckCircle2 className="w-4 h-4 text-navy-950" />}
                    >
                      Verify & Approve
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Approval Modal */}
      {approvalTarget && (
        <ExpenseApprovalModal
          isOpen={Boolean(approvalTarget)}
          onClose={() => setApprovalTarget(null)}
          expense={approvalTarget}
          onApprove={(id) => approveMutation.mutate(id)}
          isLoading={approveMutation.isPending}
        />
      )}

      {/* Reject Modal */}
      {rejectTarget && (
        <ExpenseRejectModal
          isOpen={Boolean(rejectTarget)}
          onClose={() => setRejectTarget(null)}
          expense={rejectTarget}
          onReject={(expenseId, reason) => rejectMutation.mutate({ expenseId, reason })}
          isLoading={rejectMutation.isPending}
        />
      )}
    </div>
  );
};
