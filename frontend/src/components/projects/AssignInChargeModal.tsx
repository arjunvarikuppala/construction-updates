import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Search,
  UserPlus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Mail,
  Lock,
  Phone,
  User as UserIcon,
  Link as LinkIcon,
  Copy,
  Check,
  Send,
} from 'lucide-react';
import { Modal } from '../common/Modal.js';
import { Button } from '../components/../common/Button.js';
import { Input } from '../components/../common/Input.js';
import { useToast } from '../../context/ToastContext.js';
import { ProjectAssignment } from '../../types/index.js';
import { formatDate } from '../../utils/dates.js';
import { api } from '../../api/client.js';

interface AssignInChargeModalProps {
  projectId: string;
  projectName: string;
  projectCode: string;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export const AssignInChargeModal: React.FC<AssignInChargeModalProps> = ({
  projectId,
  projectName,
  projectCode,
  isOpen,
  onClose,
  onUpdated,
}) => {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [activeTab, setActiveTab] = useState<'search' | 'invite' | 'create' | 'list'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);

  // Invite state
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [generatedInviteLink, setGeneratedInviteLink] = useState('');
  const [hasCopied, setHasCopied] = useState(false);

  // New user form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // 1. Fetch current assignments for this project
  const { data: assignmentsData, refetch: refetchAssignments } = useQuery({
    queryKey: ['project-assignments', projectId],
    queryFn: () => api.get<{ count: number; assignments: ProjectAssignment[] }>(`/projects/${projectId}/assignments`),
    enabled: isOpen && Boolean(projectId),
  });

  // 2. Fetch/search existing in-charge users
  const { data: usersData, isLoading: isSearchingUsers } = useQuery({
    queryKey: ['search-incharge-users', searchQuery],
    queryFn: () => api.get<{ count: number; users: any[] }>(`/users/in-charge?q=${encodeURIComponent(searchQuery)}`),
    enabled: isOpen && activeTab === 'search',
  });

  // Assign existing user mutation
  const assignExistingMutation = useMutation({
    mutationFn: (siteInChargeId: string) =>
      api.post(`/projects/${projectId}/assignments`, { siteInChargeId }),
    onSuccess: () => {
      success('Site In-Charge assigned successfully!');
      refetchAssignments();
      onUpdated();
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (err: any) => {
      toastError(err.message || 'Failed to assign in-charge');
    },
  });

  // Create invite link mutation
  const createInviteMutation = useMutation({
    mutationFn: (data: { name: string; email: string; projectId: string }) =>
      api.post<{ success: boolean; inviteLink: string }>('/users/invitations', data),
    onSuccess: (res) => {
      success('Invitation generated! Copy the link to send to the engineer.');
      const fullUrl = `${window.location.origin}${res.inviteLink}`;
      setGeneratedInviteLink(fullUrl);
    },
    onError: (err: any) => {
      toastError(err.message || 'Failed to generate invitation');
    },
  });

  // Create new user and assign mutation
  const createAndAssignMutation = useMutation({
    mutationFn: (newUser: any) =>
      api.post(`/projects/${projectId}/assignments`, { newUser }),
    onSuccess: () => {
      success('New Site In-Charge created and assigned successfully!');
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewPhone('');
      refetchAssignments();
      onUpdated();
      setActiveTab('list');
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (err: any) => {
      toastError(err.message || 'Failed to create and assign in-charge');
    },
  });

  // Revoke assignment mutation
  const revokeMutation = useMutation({
    mutationFn: (siteInChargeId: string) =>
      api.delete(`/projects/${projectId}/assignments/${siteInChargeId}`),
    onSuccess: () => {
      success('Assignment revoked. Project access immediately terminated.');
      setRevokeTargetId(null);
      refetchAssignments();
      onUpdated();
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (err: any) => {
      toastError(err.message || 'Failed to revoke assignment');
    },
  });

  const assignments = assignmentsData?.assignments || [];
  const activeAssignments = assignments.filter((a) => a.assignmentStatus === 'ACTIVE');
  const existingUsers = usersData?.users || [];

  const handleGenerateInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toastError('Name and email are required for invitation.');
      return;
    }
    createInviteMutation.mutate({
      name: inviteName.trim(),
      email: inviteEmail.trim(),
      projectId,
    });
  };

  const handleCopyInviteLink = () => {
    if (generatedInviteLink) {
      navigator.clipboard.writeText(generatedInviteLink);
      setHasCopied(true);
      success('Invitation link copied to clipboard!');
      setTimeout(() => setHasCopied(false), 2500);
    }
  };

  const handleCreateNewUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim() || !newPassword) {
      toastError('Name, email, and password are required.');
      return;
    }
    if (newPassword.length < 6) {
      toastError('Password must be at least 6 characters.');
      return;
    }

    createAndAssignMutation.mutate({
      name: newName.trim(),
      email: newEmail.trim(),
      password: newPassword,
      phone: newPhone.trim(),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Manage Site In-Charge • ${projectCode}`}
      description={`Assign authorized site engineers to ${projectName}. In-charges gain on-ground access to log daily reports and submit expenses.`}
      size="lg"
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`py-2 px-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'search'
                ? 'border-navy-900 text-navy-950'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Select Existing</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('invite')}
            className={`py-2 px-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'invite'
                ? 'border-navy-900 text-navy-950'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <LinkIcon className="w-3.5 h-3.5 text-amber-600" />
            <span>Invite via Link (Recommended)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`py-2 px-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'create'
                ? 'border-navy-900 text-navy-950'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Direct Create</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`py-2 px-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'list'
                ? 'border-navy-900 text-navy-950'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Active Assignments ({activeAssignments.length})</span>
          </button>
        </div>

        {/* TAB 1: Search & Select Existing In-Charge */}
        {activeTab === 'search' && (
          <div className="space-y-3">
            <Input
              placeholder="Search by name, email, or phone number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4 text-slate-400" />}
              className="py-2 text-xs"
            />

            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
              {existingUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  {isSearchingUsers ? 'Searching...' : 'No site in-charge accounts found.'}
                </div>
              ) : (
                existingUsers.map((u) => {
                  const isAssigned = activeAssignments.some(
                    (a) => a.siteInCharge?._id === u._id || a.siteInCharge?.id === u.id
                  );

                  return (
                    <div
                      key={u._id || u.id}
                      className="p-3 flex items-center justify-between hover:bg-slate-50/80 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-navy-950">{u.name}</span>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">
                            {u.role}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          <span>{u.email}</span>
                          {u.phone && <span>• {u.phone}</span>}
                        </div>
                      </div>

                      {isAssigned ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Currently Assigned
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="amber"
                          onClick={() => assignExistingMutation.mutate(u._id || u.id)}
                          isLoading={assignExistingMutation.isPending}
                        >
                          Assign to Project
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Invite via Secure Link (Recommended) */}
        {activeTab === 'invite' && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 leading-relaxed">
              <strong>Secure Invitation Workflow:</strong> Generate a unique invitation link. When the engineer opens the link, they securely set their own password and are immediately linked to this project. Never use default passwords.
            </div>

            <form onSubmit={handleGenerateInvite} className="space-y-3">
              <Input
                label="Engineer Full Name"
                placeholder="e.g. Ramesh Verma"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                leftIcon={<UserIcon className="w-4 h-4 text-slate-400" />}
                required
              />

              <Input
                label="Engineer Email Address"
                type="email"
                placeholder="e.g. ramesh.site@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4 text-slate-400" />}
                required
              />

              <Button
                type="submit"
                variant="amber"
                className="w-full font-bold"
                isLoading={createInviteMutation.isPending}
                leftIcon={<Send className="w-4 h-4" />}
              >
                Generate Invitation Link
              </Button>
            </form>

            {generatedInviteLink && (
              <div className="p-4 bg-navy-50 rounded-xl border border-navy-200 space-y-2 mt-3">
                <span className="text-xs font-bold text-navy-950 block">
                  Invitation Link Ready:
                </span>
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
                    onClick={handleCopyInviteLink}
                    leftIcon={hasCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  >
                    {hasCopied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Send this link to the site engineer via WhatsApp, SMS, or email. The link is valid for 7 days.
                </p>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Direct Account Creation */}
        {activeTab === 'create' && (
          <form onSubmit={handleCreateNewUser} className="space-y-3">
            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 leading-relaxed">
              <strong>Explicit Password Provisioning:</strong> Specify a secure, custom password for the engineer. Never use default or known shared passwords.
            </div>

            <Input
              label="Full Name"
              placeholder="e.g. Anand Varma"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              leftIcon={<UserIcon className="w-4 h-4 text-slate-400" />}
              required
            />

            <Input
              label="Email Address"
              type="email"
              placeholder="e.g. anand.site@company.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              leftIcon={<Mail className="w-4 h-4 text-slate-400" />}
              required
            />

            <Input
              label="Password (min. 6 characters)"
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              leftIcon={<Lock className="w-4 h-4 text-slate-400" />}
              required
            />

            <Input
              label="Phone Number (Optional)"
              placeholder="+91 98765 12345"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              leftIcon={<Phone className="w-4 h-4 text-slate-400" />}
            />

            <Button
              type="submit"
              variant="primary"
              className="w-full font-bold mt-2"
              isLoading={createAndAssignMutation.isPending}
            >
              Create Account & Assign to Project
            </Button>
          </form>
        )}

        {/* TAB 4: Active & Past Assignments List */}
        {activeTab === 'list' && (
          <div className="space-y-3">
            {assignments.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No Site In-Charge has been assigned to this project yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white max-h-64 overflow-y-auto">
                {assignments.map((a) => {
                  const userObj = a.siteInCharge;
                  if (!userObj) return null;

                  return (
                    <div
                      key={a._id}
                      className="p-3 flex items-center justify-between hover:bg-slate-50/60 transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-navy-950">{userObj.name}</span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                              a.assignmentStatus === 'ACTIVE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-700 line-through'
                            }`}
                          >
                            {a.assignmentStatus}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {userObj.email} {userObj.phone && `• ${userObj.phone}`}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Assigned: {formatDate(a.createdAt)}
                        </div>
                      </div>

                      {a.assignmentStatus === 'ACTIVE' && (
                        <div>
                          {revokeTargetId === userObj._id ? (
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRevokeTargetId(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
                                onClick={() => revokeMutation.mutate(userObj._id)}
                                isLoading={revokeMutation.isPending}
                              >
                                Confirm Revoke
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                              onClick={() => setRevokeTargetId(userObj._id)}
                              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                            >
                              Revoke Access
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
