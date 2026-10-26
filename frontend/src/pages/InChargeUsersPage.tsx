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
  DollarSign,
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

export const InChargeUsersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'invite' | 'direct'>('invite');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [salary, setSalary] = useState('');
  const [salaryFrequency, setSalaryFrequency] = useState<'MONTHLY' | 'DAILY' | 'PER_PROJECT'>('MONTHLY');
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

  // Direct creation mutation
  const createMutation = useMutation({
    mutationFn: async (userData: any) => api.post('/users/in-charge', userData),
    onSuccess: () => {
      success('In-charge account created successfully!');
      setIsModalOpen(false);
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setSalary('');
      setSalaryFrequency('MONTHLY');
      queryClient.invalidateQueries({ queryKey: ['in-charge-users'] });
    },
    onError: (err: any) => toastError(err.message || 'Failed to create user account'),
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

  const users = data?.users || [];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (modalMode === 'invite') {
      if (!name.trim() || !email.trim()) {
        toastError('Name and email are required for invitation');
        return;
      }
      inviteMutation.mutate({ name: name.trim(), email: email.trim() });
    } else {
      if (!name.trim() || !email.trim() || !password) {
        toastError('Please fill in required fields');
        return;
      }
      if (password.length < 6) {
        toastError('Password must be at least 6 characters');
        return;
      }
      createMutation.mutate({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
        salary: salary ? Number(salary) : undefined,
        salaryFrequency,
      });
    }
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
          onClick={() => {
            setIsModalOpen(true);
            setGeneratedInviteLink('');
          }}
          leftIcon={<UserPlus className="w-4 h-4" />}
        >
          Invite or Add In-Charge
        </Button>
      </div>

      {/* Users List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <LoadingSkeleton rows={1} height="h-44" />
          <LoadingSkeleton rows={1} height="h-44" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {users.map((user) => (
            <Card key={user.id || user._id} className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-navy-900 text-amber-400 flex items-center justify-center font-bold text-lg shadow-sm">
                  {user.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-navy-950 text-sm">{user.name}</h3>
                  <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Site In-Charge
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-xs pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2 text-slate-600">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">{user.email}</span>
                </div>
                {user.phone && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{user.phone}</span>
                  </div>
                )}
              </div>

              {/* MD-Only Salary Compensation View & Edit */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
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
                  className="text-xs py-1 px-2.5 h-7"
                >
                  Edit Salary
                </Button>
              </div>

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
            </Card>
          ))}
        </div>
      )}

      {/* Add / Invite User Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Authorize Site In-Charge Account"
        description="Invite an engineer via secure link or specify explicit account credentials."
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
            <button
              type="button"
              onClick={() => {
                setModalMode('invite');
                setGeneratedInviteLink('');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                modalMode === 'invite' ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Generate Invite Link (Recommended)
            </button>
            <button
              type="button"
              onClick={() => {
                setModalMode('direct');
                setGeneratedInviteLink('');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                modalMode === 'direct' ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Direct Creation
            </button>
          </div>

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

            {modalMode === 'direct' ? (
              <>
                <Input
                  label="Password (min. 6 characters)"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />

                <Input
                  label="Mobile Phone Number (Optional)"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                  <Input
                    label="Salary (₹ Rupees)"
                    type="number"
                    placeholder="e.g. 50000"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                    helperText="MD view only"
                  />

                  <Select
                    label="Salary Frequency"
                    value={salaryFrequency}
                    onChange={(e) => setSalaryFrequency(e.target.value as any)}
                    options={[
                      { value: 'MONTHLY', label: 'Monthly' },
                      { value: 'DAILY', label: 'Daily' },
                      { value: 'PER_PROJECT', label: 'Per Project' },
                    ]}
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full font-bold mt-2"
                  isLoading={createMutation.isPending}
                >
                  Create Account
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="submit"
                  variant="amber"
                  className="w-full font-bold mt-2"
                  isLoading={inviteMutation.isPending}
                  leftIcon={<Send className="w-4 h-4" />}
                >
                  Generate Invitation Link
                </Button>
              </>
            )}
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
    </div>
  );
};
