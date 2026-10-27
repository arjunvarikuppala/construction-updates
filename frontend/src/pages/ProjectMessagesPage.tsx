import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Send,
  Paperclip,
  Building2,
  FileText,
  CreditCard,
  Receipt,
  X,
  ExternalLink,
  Check,
  CheckCheck,
  Search,
  Users,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { useSocket } from '../context/SocketContext.js';
import { useToast } from '../context/ToastContext.js';
import { Button } from '../components/common/Button.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { ProjectMessage, MessageContextType } from '../types/index.js';
import { formatDate } from '../utils/dates.js';

export const ProjectMessagesPage: React.FC = () => {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const [searchParams] = useSearchParams();
  const linkedPaymentId = searchParams.get('paymentId');
  const linkedReportId = searchParams.get('reportId');

  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  const { socket, joinProject, leaveProject } = useSocket();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Active selected project
  const [selectedProjectId, setSelectedProjectId] = useState<string>(routeProjectId || '');

  // Form input states
  const [content, setContent] = useState('');
  const [contextType, setContextType] = useState<MessageContextType>(
    linkedPaymentId ? 'PAYMENT_REQUEST' : linkedReportId ? 'DAILY_REPORT' : 'GENERAL'
  );
  const [contextId, setContextId] = useState<string>(
    linkedPaymentId || linkedReportId || ''
  );
  const [contextSummary, setContextSummary] = useState<string>(
    linkedPaymentId ? `Payment Request #${linkedPaymentId.substring(linkedPaymentId.length - 6)}` : ''
  );

  // Attachments
  const [attachments, setAttachments] = useState<Array<{ url: string; name: string; type: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');

  // Fetch Projects list
  const { data: projectsData, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ success: boolean; projects: any[] }>('/projects'),
  });
  const projects = projectsData?.projects || [];

  // Auto-select first project if none selected
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      const firstId = projects[0]._id || projects[0].id;
      setSelectedProjectId(firstId);
    }
  }, [projects, selectedProjectId]);

  // Keep route synced with selected project
  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== routeProjectId) {
      navigate(`/messages/${selectedProjectId}`, { replace: true });
    }
  }, [selectedProjectId, routeProjectId, navigate]);

  // Socket room join / leave lifecycle
  useEffect(() => {
    if (selectedProjectId) {
      joinProject(selectedProjectId);

      // Mark messages read for this project
      api.put(`/projects/${selectedProjectId}/messages/read`).then(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      }).catch(() => {});

      return () => {
        leaveProject(selectedProjectId);
      };
    }
  }, [selectedProjectId, joinProject, leaveProject, queryClient]);

  // Fetch Messages for active project
  const { data: messagesData, isLoading: isLoadingMessages } = useQuery({
    queryKey: ['project-messages', selectedProjectId],
    queryFn: () =>
      api.get<{ success: boolean; messages: ProjectMessage[] }>(
        `/projects/${selectedProjectId}/messages`
      ),
    enabled: Boolean(selectedProjectId),
    refetchInterval: 10000,
  });
  const messages = messagesData?.messages || [];

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: (data: any) =>
      api.post(`/projects/${selectedProjectId}/messages`, data),
    onSuccess: (res: any) => {
      setContent('');
      setAttachments([]);
      if (!linkedPaymentId && !linkedReportId) {
        setContextType('GENERAL');
        setContextId('');
        setContextSummary('');
      }
      queryClient.invalidateQueries({ queryKey: ['project-messages', selectedProjectId] });
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to deliver message', 'error');
    },
  });

  // Handle attachment upload
  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('receipt', file);

      const res = await api.post<{ success: boolean; receiptUrl: string }>(
        '/expenses/upload-receipt',
        formData
      );

      if (res.success && res.receiptUrl) {
        setAttachments((prev) => [
          ...prev,
          {
            url: res.receiptUrl,
            name: file.name,
            type: file.type || 'document',
          },
        ]);
        showToast('Attachment uploaded successfully', 'info');
      }
    } catch (err: any) {
      showToast(err.message || 'Attachment upload failed', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!content.trim() && attachments.length === 0) return;

    sendMessageMutation.mutate({
      content: content.trim(),
      attachments,
      contextType: contextType !== 'GENERAL' ? contextType : undefined,
      contextId: contextId || undefined,
      contextSummary: contextSummary || undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeProject = projects.find(
    (p: any) => (p._id || p.id) === selectedProjectId
  );

  const filteredProjects = projects.filter((p: any) => {
    if (!projectSearch) return true;
    const q = projectSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
  });

  const currentUserId = user?.id || (user as any)?._id;

  return (
    <div className="h-[calc(100vh-5.5rem)] flex flex-col md:flex-row bg-white rounded-3xl border border-slate-200/90 shadow-card overflow-hidden">
      {/* LEFT SIDEBAR: PROJECTS CHAT LIST */}
      <div className="w-full md:w-80 border-r border-slate-200/90 flex flex-col bg-slate-50/50">
        <div className="p-4 border-b border-slate-200/90 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-navy-900 text-amber-500 flex items-center justify-center font-bold">
                <MessageSquare className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-black text-navy-950">Project Channels</h2>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {projects.length}
            </span>
          </div>

          {/* Search channel */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Filter project channels..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-slate-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>
        </div>

        {/* Project Channels List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {isLoadingProjects ? (
            <div className="p-4">
              <LoadingSkeleton rows={4} height="h-14" />
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No project channels found</div>
          ) : (
            filteredProjects.map((p: any) => {
              const id = p._id || p.id;
              const isSelected = id === selectedProjectId;
              return (
                <button
                  key={id}
                  onClick={() => setSelectedProjectId(id)}
                  className={`w-full text-left p-3.5 transition-colors flex items-start gap-3 ${
                    isSelected ? 'bg-amber-500/10 border-l-4 border-amber-500' : 'hover:bg-slate-100/70'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                    isSelected ? 'bg-navy-900 text-amber-400' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {p.code?.substring(0, 3) || 'PRJ'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-xs truncate ${isSelected ? 'font-black text-navy-950' : 'font-bold text-slate-800'}`}>
                        {p.name}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                      {p.code} • {p.status}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT MAIN AREA: PROJECT CHAT CONVERSATION */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Chat Header */}
        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between bg-white flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-navy-900 text-amber-500 flex items-center justify-center font-bold text-xs flex-shrink-0">
              {activeProject?.code || 'PRJ'}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-navy-950 truncate">
                {activeProject?.name || 'Select a project channel'}
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Real-time operational communication between MD & assigned Site Engineers
              </p>
            </div>
          </div>

          {activeProject && (
            <div className="hidden sm:flex items-center gap-2">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-navy-50 text-navy-800 border border-navy-200">
                {activeProject.code}
              </span>
            </div>
          )}
        </div>

        {/* Messages Feed */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50/30">
          {isLoadingMessages ? (
            <LoadingSkeleton rows={5} height="h-16" />
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-navy-950">Start the conversation</h4>
              <p className="text-xs text-slate-400 max-w-sm">
                Discuss site progress, review payment requests, clarify invoice doubts, or coordinate operations.
              </p>
            </div>
          ) : (
            messages.map((m: ProjectMessage) => {
              const id = m._id || m.id;
              const isMine =
                m.sender?._id === currentUserId ||
                m.sender?.id === currentUserId ||
                m.sender?.email === user?.email;

              const isSenderOwner =
                m.sender?.role === 'MD' || m.sender?.role === 'OWNER';

              return (
                <div
                  key={id}
                  className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} space-y-1`}
                >
                  {/* Sender Header */}
                  <div className="flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
                    <span className="font-bold text-slate-700">{m.sender?.name}</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                        isSenderOwner
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-navy-100 text-navy-900'
                      }`}
                    >
                      {isSenderOwner ? 'MD' : 'Site Engineer'}
                    </span>
                    <span>•</span>
                    <span>{formatDate(m.createdAt, 'hh:mm a')}</span>
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`max-w-lg rounded-2xl p-4 shadow-xs space-y-2.5 ${
                      isMine
                        ? 'bg-navy-950 text-white rounded-tr-none'
                        : 'bg-white text-navy-950 border border-slate-200/90 rounded-tl-none'
                    }`}
                  >
                    {/* Linked Context Card (Payment Request, Daily Report, Expense) */}
                    {m.contextType && m.contextType !== 'GENERAL' && (
                      <div
                        className={`p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 border ${
                          isMine
                            ? 'bg-white/10 border-white/20 text-slate-200'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {m.contextType === 'PAYMENT_REQUEST' && (
                            <CreditCard className="w-4 h-4 text-amber-400 flex-shrink-0" />
                          )}
                          {m.contextType === 'DAILY_REPORT' && (
                            <FileText className="w-4 h-4 text-sky-400 flex-shrink-0" />
                          )}
                          {m.contextType === 'EXPENSE' && (
                            <Receipt className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          )}
                          <span className="font-bold text-[11px] truncate">
                            {m.contextSummary || `${m.contextType.replace(/_/g, ' ')} Reference`}
                          </span>
                        </div>
                        {m.contextId && (
                          <button
                            onClick={() => {
                              if (m.contextType === 'PAYMENT_REQUEST') navigate('/payments');
                              if (m.contextType === 'DAILY_REPORT') navigate(`/reports/${m.contextId}`);
                              if (m.contextType === 'EXPENSE') navigate('/expenses');
                            }}
                            className="flex items-center gap-1 text-[10px] font-bold hover:underline flex-shrink-0"
                          >
                            <span>Open</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Content text */}
                    {m.content && (
                      <p className="text-xs leading-relaxed whitespace-pre-wrap">{m.content}</p>
                    )}

                    {/* Attachments */}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {m.attachments.map((att: any, idx: number) => (
                          <a
                            key={idx}
                            href={att.url}
                            target="_blank"
                            rel="noreferrer"
                            className={`flex items-center gap-2 p-2 rounded-xl text-xs border transition-colors ${
                              isMine
                                ? 'bg-white/10 hover:bg-white/20 border-white/20 text-white'
                                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-navy-950'
                            }`}
                          >
                            <Paperclip className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                            <span className="font-semibold truncate text-[11px] flex-1">
                              {att.name || 'Attached Document'}
                            </span>
                            <ExternalLink className="w-3 h-3 text-slate-400" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Active Context Tag Pill */}
        {contextType !== 'GENERAL' && (
          <div className="px-6 py-2 bg-amber-50 border-t border-amber-200 flex items-center justify-between text-xs text-amber-950">
            <div className="flex items-center gap-2">
              <span className="font-bold uppercase text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">
                Attached Context
              </span>
              <span className="font-semibold text-xs">{contextSummary || contextType}</span>
            </div>
            <button
              onClick={() => {
                setContextType('GENERAL');
                setContextId('');
                setContextSummary('');
              }}
              className="p-1 text-amber-700 hover:text-amber-900 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Attachments preview tray */}
        {attachments.length > 0 && (
          <div className="px-6 py-2 bg-slate-50 border-t border-slate-200 flex items-center gap-2 overflow-x-auto">
            {attachments.map((att, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 shadow-xs flex-shrink-0"
              >
                <Paperclip className="w-3 h-3 text-amber-500" />
                <span className="truncate max-w-[120px] text-[11px]">{att.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-0.5 text-slate-400 hover:text-rose-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Message Input Box */}
        <div className="p-4 border-t border-slate-200 bg-white">
          <form onSubmit={handleSend} className="flex items-end gap-2">
            {/* Attachment Button */}
            <label
              className="p-2.5 text-slate-500 hover:text-navy-900 hover:bg-slate-100 rounded-xl cursor-pointer transition-colors flex-shrink-0"
              title="Attach photo or document"
            >
              <Paperclip className="w-5 h-5" />
              <input
                type="file"
                className="hidden"
                accept="image/*,application/pdf"
                onChange={handleAttachmentUpload}
                disabled={isUploading}
              />
            </label>

            {/* Textarea */}
            <textarea
              rows={1}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message... (Shift + Enter for newline)"
              className="flex-1 px-4 py-2.5 rounded-2xl border border-slate-300 text-xs text-navy-950 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none resize-none max-h-32"
            />

            {/* Send Button */}
            <Button
              size="md"
              variant="primary"
              type="submit"
              isLoading={sendMessageMutation.isPending || isUploading}
              disabled={!content.trim() && attachments.length === 0}
              className="rounded-2xl"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};
