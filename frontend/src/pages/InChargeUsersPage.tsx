import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  UserPlus,
  Mail,
  Phone,
  Building2,
  CheckCircle2,
  Link as LinkIcon,
  Copy,
  Check,
  Send,
  Edit3,
  Trash2,
  IndianRupee,
  FileSpreadsheet,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/common/Card.js';
import { Button } from '../components/common/Button.js';
import { Input, Select } from '../components/common/Input.js';
import { Modal } from '../components/common/Modal.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { User } from '../types/index.js';
import { formatINR } from '../utils/currency.js';
import { useToast } from '../context/ToastContext.js';
import { api } from '../api/client.js';
import { localMonthString } from '../utils/dates.js';
import { inr } from '../utils/payments.js';
import { SALARY_STATUS, addMonths, monthLabel, type SalaryEmployee, type SalarySummaryResponse } from '../utils/salary.js';
import { PaySalaryModal, SalaryHistoryModal } from '../components/salary/SalaryModals.js';
import { InChargePaymentsModal } from '../components/salary/InChargePaymentsModal.js';
import { downloadFromApi } from '../utils/download.js';
import { EditMobileModal } from '../components/users/AccountAccessModals.js';
import { formatMobile } from '../utils/phone.js';

export const InChargeUsersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [hasCopied, setHasCopied] = useState(false);

  // Edit Salary State
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editSalary, setEditSalary] = useState('');
  const [editSalaryFrequency, setEditSalaryFrequency] = useState<'MONTHLY' | 'DAILY' | 'PER_PROJECT'>('MONTHLY');

  const { data, isLoading } = useQuery({
    queryKey: ['in-charge-users'],
    queryFn: () => api.get<{ count: number; users: User[] }>('/users/in-charge'),
  });

  // Invitation link mutation
  const inviteMutation = useMutation({
    mutationFn: async (data: { name: string; email: string }) =>
      api.post<{ success: boolean; inviteLink: string }>('/users/invitations', data),
    onSuccess: (res) => {
      success('Invitation generated successfully!');
      const fullUrl = `${window.location.origin}${res.inviteLink}`;
      setGeneratedInviteLink(fullUrl);
      queryClient.invalidateQueries({ queryKey: ['in-charge-users'] });
    },
    onError: (err: any) => toastError(err.message || 'Failed to generate invitation'),
  });

  // Update salary mutation
  const updateSalaryMutation = useMutation({
    mutationFn: async ({ id, salary, salaryFrequency }: { id: string; salary?: number; salaryFrequency?: string }) => {
      return api.put(`/users/in-charge/${id}`, { salary, salaryFrequency });
    },
    onSuccess: () => {
      success('In-charge salary updated successfully!');
      setEditUser(null);
      queryClient.invalidateQueries({ queryKey: ['in-charge-users'] });
    },
    onError: (err: any) => toastError(err.message || 'Failed to update salary'),
  });

  // Delete account (Google Play account-deletion policy)
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [mobileFor, setMobileFor] = useState<User | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean; message: string }>(`/users/in-charge/${id}`),
    onSuccess: (r: any) => {
      success(r?.message || 'Account deleted.');
      setDeleteUser(null);
      queryClient.invalidateQueries({ queryKey: ['in-charge-users'] });
    },
    onError: (err: any) => toastError(err.message || 'Could not delete the account'),
  });

  const users = data?.users || [];

  // Monthly salaries
  const currentMonth = localMonthString();
  const [payMonth, setPayMonth] = useState(currentMonth);
  const [payFor, setPayFor] = useState<SalaryEmployee | null>(null);
  const [historyFor, setHistoryFor] = useState<SalaryEmployee | null>(null);
  const [ledgerFor, setLedgerFor] = useState<SalaryEmployee | null>(null);
  const [salaryDownloading, setSalaryDownloading] = useState('');
  const downloadSalary = async (u: User) => {
    const id = u.id || (u as any)._id;
    setSalaryDownloading(id);
    try {
      await downloadFromApi(`/export/in-charges/${id}/salary.xlsx`, `Salary-${u.name.replace(/[^A-Za-z0-9]+/g, '-')}.xlsx`);
    } catch (err: any) {
      toastError(err.message || 'Could not download the salary file');
    } finally {
      setSalaryDownloading('');
    }
  };
  const { data: payroll } = useQuery({
    queryKey: ['salary', 'summary', payMonth],
    queryFn: () => api.get<SalarySummaryResponse>(`/salaries/summary?month=${payMonth}`),
  });
  const salaryRow = (u: User) => payroll?.rows.find((r) => r.employee._id === (u.id || (u as any)._id));
  const toEmployee = (u: User): SalaryEmployee => {
    const row = salaryRow(u);
    return { _id: u.id || (u as any)._id, name: u.name, salary: u.salary, salaryFrequency: u.salaryFrequency, vpa: row?.employee.vpa };
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toastError('Name and email are required for invitation');
      return;
    }
    inviteMutation.mutate({ name: name.trim(), email: email.trim() });
  };

  const handleCopyLink = () => {
    if (generatedInviteLink) {
      navigator.clipboard.writeText(generatedInviteLink);
      setHasCopied(true);
      success('Invite link copied to clipboard!');
      setTimeout(() => setHasCopied(false), 2500);
    }
  };

  const handleOpenEditSalary = (user: User) => {
    setEditUser(user);
    // User salary is returned in paise from backend, convert to rupees for the input
    setEditSalary(
      user.salary !== undefined && user.salary !== null ? String(user.salary / 100) : ''
    );
    setEditSalaryFrequency(user.salaryFrequency || 'MONTHLY');
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-navy-950 tracking-tight">
            Site In-Charge Engineers
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage site engineers authorized to submit daily construction reports, on-site expenses, and track confidential compensation.
          </p>
        </div>

        <Button
          variant="amber"
          className="w-full sm:w-auto font-bold"
          onClick={() => {
            setIsModalOpen(true);
            setGeneratedInviteLink('');
          }}
          leftIcon={<UserPlus className="w-4 h-4" />}
        >
          Invite In-Charge
        </Button>
      </div>

      {/* Monthly payroll */}
      {users.length > 0 && payroll && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <IndianRupee className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-bold text-navy-950 text-sm">Salaries · {monthLabel(payMonth)}</h2>
                <p className="text-xs text-slate-500">
                  {payroll.totals.paidCount} of {payroll.totals.count} paid in full
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setPayMonth(addMonths(payMonth, -1))} aria-label="Previous month">
                ‹
              </Button>
              <span className="min-w-[96px] text-center text-xs font-bold text-navy-950">{monthLabel(payMonth, true)}</span>
              <Button size="sm" variant="outline" onClick={() => setPayMonth(addMonths(payMonth, 1))} disabled={payMonth >= addMonths(currentMonth, 1)} aria-label="Next month">
                ›
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2 lg:ml-auto text-xs">
              {[
                { k: 'Salaries', v: inr(payroll.totals.duePaise), c: 'text-navy-950' },
                { k: 'Paid', v: inr(payroll.totals.paidPaise), c: 'text-emerald-700' },
                { k: 'Still due', v: inr(payroll.totals.balancePaise), c: payroll.totals.balancePaise ? 'text-rose-700' : 'text-emerald-700' },
              ].map((t) => (
                <div key={t.k} className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t.k}</div>
                  <div className={`text-sm font-black ${t.c}`}>{t.v}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Users List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <LoadingSkeleton rows={1} height="h-44" />
          <LoadingSkeleton rows={1} height="h-44" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {users.map((user) => (
            <Card key={user.id || user._id} className="p-4 sm:p-5 space-y-4 min-w-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-navy-900 text-brand-400 flex items-center justify-center font-bold text-lg shadow-sm shrink-0">
                  {user.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-navy-950 text-sm truncate">{user.name}</h3>
                  <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Site In-Charge
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-xs pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2 text-slate-600 min-w-0">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{user.email}</span>
                </div>
                {user.phone ? (
                  <div className="flex items-center gap-2 text-slate-600 min-w-0">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{formatMobile(user.phone)}</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                    <Phone className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>No mobile number. Every account needs one: add it.</span>
                  </div>
                )}
                <div className="pt-1">
                  <Button size="sm" variant="outline" className="text-xs w-full" onClick={() => setMobileFor(user)} leftIcon={<Phone className="w-3.5 h-3.5" />}>
                    {user.phone ? 'Change mobile' : 'Add mobile'}
                  </Button>
                </div>
              </div>

              {/* MD-Only Salary Compensation View & Edit */}
              <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Salary (MD View Only)
                  </span>
                  <span className="text-xs font-bold text-emerald-700">
                    {user.salary !== undefined && user.salary !== null
                      ? `${formatINR(user.salary)} / ${(user.salaryFrequency || 'monthly').toLowerCase().replace('_', ' ')}`
                      : 'Not specified'}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenEditSalary(user)}
                  leftIcon={<Edit3 className="w-3.5 h-3.5 text-navy-800" />}
                  className="text-xs py-1.5 px-3 min-h-[38px] sm:min-h-0 sm:h-7 w-full sm:w-auto"
                >
                  Edit Salary
                </Button>
              </div>

              {/* This month's salary */}
              {(() => {
                const row = salaryRow(user);
                const meta = SALARY_STATUS[row?.status || 'UNPAID'];
                return (
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Salary · {monthLabel(payMonth, true)}</span>
                      <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${meta.tone}`}>{meta.label}</span>
                    </div>
                    {row && (row.paidPaise > 0 || row.duePaise > 0) && (
                      <div className="text-xs text-slate-600 flex flex-wrap gap-x-3">
                        <span>
                          Paid <strong className="text-emerald-700">{inr(row.paidPaise)}</strong>
                        </span>
                        {row.balancePaise > 0 && (
                          <span>
                            Due <strong className="text-rose-700">{inr(row.balancePaise)}</strong>
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 text-xs"
                        disabled={row?.status === 'PAID'}
                        onClick={() => setPayFor(toEmployee(user))}
                        leftIcon={<IndianRupee className="w-3.5 h-3.5" />}
                      >
                        {row?.status === 'PAID' ? 'Paid' : row?.status === 'PARTIAL' ? 'Pay balance' : 'Pay salary'}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => setHistoryFor(toEmployee(user))}>
                        Salary history
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => downloadSalary(user)}
                        disabled={salaryDownloading === (user.id || (user as any)._id)}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[34px] rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        {salaryDownloading === (user.id || (user as any)._id) ? 'Preparing…' : 'Salary (Excel)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLedgerFor(toEmployee(user))}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[34px] rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" /> All payments
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Assigned Projects */}
              <div className="pt-2 border-t border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  Assigned Construction Sites ({user.assignedProjects?.length || 0})
                </span>
                {user.assignedProjects && user.assignedProjects.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {user.assignedProjects.map((p: any) => (
                      <span
                        key={p._id || p.id}
                        className="text-[11px] font-semibold text-navy-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200"
                      >
                        {p.code || p.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400 italic">No projects currently assigned</span>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setDeleteUser(user)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg px-2 min-h-[36px]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete account
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Invite User Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Invite a Site In-Charge"
        description="In-charges join only by invitation link."
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
            Send them the link. They choose their own password and add their mobile number when they open it.
          </p>

          <form onSubmit={handleCreate} className="space-y-3">
            <Input
              label="Full Name"
              placeholder="e.g. Ramesh Verma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />

            <Input
              label="Email Address"
              type="email"
              placeholder="e.g. ramesh.verma@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Button
              type="submit"
              variant="amber"
              className="w-full font-bold mt-2"
              isLoading={inviteMutation.isPending}
              leftIcon={<Send className="w-4 h-4" />}
            >
              Generate Invitation Link
            </Button>
          </form>

          {generatedInviteLink && (
            <div className="p-3.5 bg-navy-50 rounded-xl border border-navy-200 space-y-2">
              <span className="text-xs font-bold text-navy-950 block">Invitation Link:</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={generatedInviteLink}
                  className="w-full text-xs font-mono p-2 bg-white rounded-lg border border-slate-300 select-all"
                />
                <Button
                  size="sm"
                  variant={hasCopied ? 'primary' : 'outline'}
                  onClick={handleCopyLink}
                  leftIcon={hasCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                >
                  {hasCopied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-[11px] text-slate-500">
                Send this link to the site engineer. They can open it to securely establish their password.
              </p>
            </div>
          )}
        </div>
      </Modal>

      {/* Edit Salary Modal */}
      <Modal
        isOpen={Boolean(editUser)}
        onClose={() => setEditUser(null)}
        title="Update In-Charge Compensation"
        description={`Set or modify the confidential salary compensation for ${editUser?.name || 'In-Charge'}. Only the MD can view this.`}
        size="sm"
      >
        {editUser && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateSalaryMutation.mutate({
                id: editUser.id || (editUser as any)._id,
                salary: editSalary ? Number(editSalary) : undefined,
                salaryFrequency: editSalaryFrequency,
              });
            }}
            className="space-y-4"
          >
            <Input
              label="Salary Amount (₹ Rupees)"
              type="number"
              placeholder="e.g. 50000"
              value={editSalary}
              onChange={(e) => setEditSalary(e.target.value)}
              helperText="Enter full amount in rupees (e.g. 50000 for ₹50,000)"
              required
            />

            <Select
              label="Salary Frequency"
              value={editSalaryFrequency}
              onChange={(e) => setEditSalaryFrequency(e.target.value as any)}
              options={[
                { value: 'MONTHLY', label: 'Monthly (per month)' },
                { value: 'DAILY', label: 'Daily (per day)' },
                { value: 'PER_PROJECT', label: 'Per Project (milestone)' },
              ]}
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditUser(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="font-bold"
                isLoading={updateSalaryMutation.isPending}
              >
                Save Compensation
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <PaySalaryModal employee={payFor} month={payMonth} onClose={() => setPayFor(null)} />
      <InChargePaymentsModal employee={ledgerFor} onClose={() => setLedgerFor(null)} />
      <SalaryHistoryModal
        employee={historyFor}
        onClose={() => setHistoryFor(null)}
        onPay={(e) => {
          setHistoryFor(null);
          setPayFor(e);
        }}
      />

      {/* Delete Account Modal */}
      <Modal
        isOpen={Boolean(deleteUser)}
        onClose={() => !deleteMutation.isPending && setDeleteUser(null)}
        title={`Delete ${deleteUser?.name || 'this'}'s account?`}
        size="sm"
      >
        {deleteUser && (
          <div className="space-y-4 text-sm text-slate-700">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Their name, email, phone and salary details are erased.</li>
              <li>They are signed out everywhere and can never sign in again.</li>
              <li>
                Their reports, expenses, payments and chat stay as company records, shown as “Deleted user”.
              </li>
            </ul>
            <p className="font-semibold text-rose-700">This cannot be undone.</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button type="button" variant="outline" onClick={() => setDeleteUser(null)} disabled={deleteMutation.isPending}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                isLoading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteUser.id || (deleteUser as any)._id)}
              >
                Delete account
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {mobileFor && <EditMobileModal user={mobileFor} onClose={() => setMobileFor(null)} />}
    </div>
  );
};
