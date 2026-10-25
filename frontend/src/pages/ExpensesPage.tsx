import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Filter,
  FileSpreadsheet,
  Receipt,
  CheckCircle2,
  Clock,
  XCircle,
  FileDown,
} from 'lucide-react';
import { ExpenseTable } from '../components/expenses/ExpenseTable.js';
import { ExpenseCard } from '../components/expenses/ExpenseCard.js';
import { ExpenseApprovalModal } from '../components/expenses/ExpenseApprovalModal.js';
import { ExpenseRejectModal } from '../components/expenses/ExpenseRejectModal.js';
import { ExpenseResubmitModal } from '../components/expenses/ExpenseResubmitModal.js';
import { Button } from '../components/common/Button.js';
import { Input, Select } from '../components/common/Input.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Expense, Project, ExpenseCategory, ExpenseStatus } from '../types/index.js';
import { formatCompactINR, formatINR } from '../utils/currency.js';
import { downloadExpensesExcel } from '../utils/exportExcel.js';
import { api } from '../api/client.js';

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'All Categories' },
  { value: 'CONSTRUCTION_MATERIALS', label: 'Construction Materials' },
  { value: 'LABOUR', label: 'Labour' },
  { value: 'DIESEL_AND_FUEL', label: 'Diesel and Fuel' },
  { value: 'MACHINERY_AND_EQUIPMENT', label: 'Machinery & Equipment' },
  { value: 'TRANSPORTATION', label: 'Transportation' },
  { value: 'FOOD_AND_ACCOMMODATION', label: 'Food & Accommodation' },
  { value: 'REPAIRS_AND_MAINTENANCE', label: 'Repairs & Maintenance' },
  { value: 'OTHER', label: 'Other' },
];

export const ExpensesPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isOwner } = useAuth();
  const { success, error: toastError } = useToast();

  const [statusTab, setStatusTab] = useState<string>('ALL');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals state
  const [approvalTarget, setApprovalTarget] = useState<Expense | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Expense | null>(null);
  const [resubmitTarget, setResubmitTarget] = useState<Expense | null>(null);

  // Projects list for filter
  const { data: projectsData } = useQuery({
    queryKey: ['projects-expenses-filter'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });

  // Query expenses with 15s polling for multi-device sync
  const { data, isLoading } = useQuery({
    queryKey: ['expenses', statusTab, selectedProject, selectedCategory, searchTerm],
    queryFn: async () => {
      let params = new URLSearchParams();
      if (statusTab !== 'ALL') params.append('status', statusTab);
      if (selectedProject) params.append('projectId', selectedProject);
      if (selectedCategory !== 'ALL') params.append('category', selectedCategory);
      if (searchTerm.trim()) params.append('search', searchTerm.trim());

      return api.get<{ count: number; expenses: Expense[] }>(`/expenses?${params.toString()}`);
    },
    refetchInterval: 15000,
  });

  // Approval Mutation
  const approveMutation = useMutation({
    mutationFn: async (expenseId: string) => {
      return api.post(`/expenses/${expenseId}/approve`);
    },
    onSuccess: () => {
      success('Expense verified and approved successfully!');
      setApprovalTarget(null);
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals-count'] });
    },
    onError: (err: any) => toastError(err.message || 'Failed to approve expense'),
  });

  // Reject Mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ expenseId, reason }: { expenseId: string; reason: string }) => {
      return api.post(`/expenses/${expenseId}/reject`, { reason });
    },
    onSuccess: () => {
      success('Expense rejected with documented reason');
      setRejectTarget(null);
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals-count'] });
    },
    onError: (err: any) => toastError(err.message || 'Failed to reject expense'),
  });

  // Resubmit Mutation
  const resubmitMutation = useMutation({
    mutationFn: async (updatedData: any) => {
      return api.post(`/expenses/${updatedData.id}/resubmit`, updatedData);
    },
    onSuccess: () => {
      success('Expense corrected and resubmitted for owner review!');
      setResubmitTarget(null);
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err: any) => toastError(err.message || 'Failed to resubmit expense'),
  });

  const expenses = data?.expenses || [];
  const projects = projectsData?.projects || [];

  // Calculate totals from current list
  const approvedTotal = expenses
    .filter((e) => e.status === 'APPROVED')
    .reduce((sum, e) => sum + e.amount, 0);

  const pendingTotal = expenses
    .filter((e) => e.status === 'PENDING')
    .reduce((sum, e) => sum + e.amount, 0);

  const rejectedTotal = expenses
    .filter((e) => e.status === 'REJECTED')
    .reduce((sum, e) => sum + e.amount, 0);

  const handleExportExcel = () => {
    const params: Record<string, string> = {};
    if (selectedProject) params.projectId = selectedProject;
    if (statusTab !== 'ALL') params.status = statusTab;
    if (selectedCategory !== 'ALL') params.category = selectedCategory;
    downloadExpensesExcel(params);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">
            {isOwner ? 'Master Expenses Register' : 'Site Expenses & Receipts'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Verified material invoices, labour vouchers, fuel bills, and payment records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportExcel}
              leftIcon={<FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
            >
              Export Excel
            </Button>
          )}

          <Button
            size="sm"
            variant="amber"
            onClick={() => navigate('/expenses/new')}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Submit Expense
          </Button>
        </div>
      </div>

      {/* Financial Totals Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-card text-xs">
        <div>
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Total In Register
          </span>
          <span className="text-lg font-black text-navy-950 block mt-1">{expenses.length} Records</span>
        </div>
        <div>
          <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
            Approved Spend
          </span>
          <span className="text-lg font-black text-emerald-700 block mt-1">
            {formatCompactINR(approvedTotal)}
          </span>
        </div>
        <div>
          <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block">
            Pending Approval
          </span>
          <span className="text-lg font-black text-amber-700 block mt-1">
            {formatCompactINR(pendingTotal)}
          </span>
        </div>
        <div>
          <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">
            Rejected
          </span>
          <span className="text-lg font-black text-rose-700 block mt-1">
            {formatCompactINR(rejectedTotal)}
          </span>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-1">
        {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusTab(tab)}
            className={`py-2 px-4 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
              statusTab === tab
                ? 'bg-navy-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {tab === 'ALL'
              ? 'All Expenses'
              : tab === 'PENDING'
              ? 'Pending Approval'
              : tab === 'APPROVED'
              ? 'Approved'
              : 'Rejected'}
          </button>
        ))}
      </div>

      {/* Search and Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          placeholder="Search by vendor, bill description..."
          leftIcon={<Search className="w-4 h-4" />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <Select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p._id || p.id} value={p._id || p.id}>
              {p.code} - {p.name}
            </option>
          ))}
        </Select>

        <Select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          options={CATEGORIES}
        />
      </div>

      {/* Responsive View: Desktop Table, Mobile Cards */}
      {isLoading ? (
        <div className="space-y-4">
          <LoadingSkeleton rows={1} height="h-20" />
          <LoadingSkeleton rows={4} height="h-16" />
        </div>
      ) : expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No expenses match current filters"
          description="Submit an expense with a receipt photo or adjust your filters above."
          actionText="Submit Expense"
          onAction={() => navigate('/expenses/new')}
        />
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden">
            <ExpenseTable
              expenses={expenses}
              isOwner={isOwner}
              onApprove={(exp) => setApprovalTarget(exp)}
              onReject={(exp) => setRejectTarget(exp)}
              onResubmit={(exp) => setResubmitTarget(exp)}
              onView={(exp) => setApprovalTarget(exp)}
            />
          </div>

          {/* Mobile Cards View */}
          <div className="md:hidden space-y-3">
            {expenses.map((expense) => (
              <ExpenseCard
                key={expense._id || expense.id}
                expense={expense}
                isOwner={isOwner}
                onApprove={(exp) => setApprovalTarget(exp)}
                onReject={(exp) => setRejectTarget(exp)}
                onResubmit={(exp) => setResubmitTarget(exp)}
                onView={(exp) => setApprovalTarget(exp)}
              />
            ))}
          </div>
        </>
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

      {/* Resubmit Modal */}
      {resubmitTarget && (
        <ExpenseResubmitModal
          isOpen={Boolean(resubmitTarget)}
          onClose={() => setResubmitTarget(null)}
          expense={resubmitTarget}
          onResubmit={(data) => resubmitMutation.mutate(data)}
          isLoading={resubmitMutation.isPending}
        />
      )}
    </div>
  );
};
