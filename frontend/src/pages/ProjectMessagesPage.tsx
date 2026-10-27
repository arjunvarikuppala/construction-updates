import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Eye,
  Circle,
  Image as ImageIcon,
  Film,
  Download,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  UploadCloud,
  AlertCircle,
  Loader2,
  RefreshCw,
  Play,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { useSocket } from '../context/SocketContext.js';
import { useToast } from '../context/ToastContext.js';
import { Button } from '../components/common/Button.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import {
  ProjectMessage,
  MessageAttachment,
  MessageContextType,
  ProjectParticipantPresence,
  ProjectPresenceData,
} from '../types/index.js';
import { formatDate } from '../utils/dates.js';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_DOC_TYPES = ['application/pdf'];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_DOC_SIZE = 25 * 1024 * 1024; // 25 MB

interface StagedAttachment {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  size: number;
  type: 'image' | 'video' | 'document' | 'other';
  mimeType: string;
  uploading: boolean;
  progress: number;
  uploadedUrl?: string;
  storageKey?: string;
  error?: string;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getAuthenticatedMediaUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const token = localStorage.getItem('sitetrack_token');
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const replacingIdRef = useRef<string | null>(null);
  const dragCounter = useRef(0);

  // Active selected project
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

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

  // Staged attachments & drag-and-drop
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');

  // Lightbox Viewer Modal State
  const [lightboxMedia, setLightboxMedia] = useState<{
    url: string;
    name: string;
    type: 'image' | 'video';
  } | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);

  // Fetch Projects list
  const { data: projectsData, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ success: boolean; projects: any[] }>('/projects'),
  });
  const projects = projectsData?.projects || [];

  // Match routeProjectId (which may be an ObjectId OR Project Code like "TG-156") with projects list
  useEffect(() => {
    if (projects.length > 0) {
      if (routeProjectId) {
        const matched = projects.find(
          (p: any) =>
            (p._id || p.id) === routeProjectId ||
            (p.code && p.code.toLowerCase() === routeProjectId.toLowerCase())
        );
        if (matched) {
          setSelectedProjectId(matched._id || matched.id);
        } else {
          setSelectedProjectId(routeProjectId);
        }
      } else if (!selectedProjectId) {
        const firstId = projects[0]._id || projects[0].id;
        setSelectedProjectId(firstId);
      }
    }
  }, [projects, routeProjectId, selectedProjectId]);

  // Keep route synced with selected project
  useEffect(() => {
    if (selectedProjectId && selectedProjectId !== routeProjectId) {
      navigate(`/messages/${selectedProjectId}`, { replace: true });
    }
  }, [selectedProjectId, routeProjectId, navigate]);

  // Socket room join / leave lifecycle & mark seen
  useEffect(() => {
    if (selectedProjectId) {
      joinProject(selectedProjectId);

      // Tell backend & peers that messages are read
      api
        .put(`/projects/${selectedProjectId}/messages/read`)
        .then(() => {
          socket?.emit('messages:mark_seen', { projectId: selectedProjectId });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
        })
        .catch(() => {});

      return () => {
        leaveProject(selectedProjectId);
      };
    }
  }, [selectedProjectId, joinProject, leaveProject, socket, queryClient]);

  // Handle ESC key for Lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeLightbox();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch Presence & Online participants for active project
  const { data: presenceData } = useQuery({
    queryKey: ['project-presence', selectedProjectId],
    queryFn: () =>
      api.get<ProjectPresenceData>(`/projects/${selectedProjectId}/messages/presence`),
    enabled: Boolean(selectedProjectId),
    refetchInterval: 5000,
  });

  const participants = presenceData?.participants || [];
  const currentUserId = user?.id || (user as any)?._id;

  const otherParticipants = participants.filter((p) => p.userId !== currentUserId);
  const otherOnlineParticipants = otherParticipants.filter((p) => p.isOnline);
  const isOtherPartyOnline = otherOnlineParticipants.length > 0;

  // Fetch Messages for active project
  const { data: messagesData, isLoading: isLoadingMessages } = useQuery({
    queryKey: ['project-messages', selectedProjectId],
    queryFn: () =>
      api.get<{ success: boolean; messages: ProjectMessage[] }>(
        `/projects/${selectedProjectId}/messages`
      ),
    enabled: Boolean(selectedProjectId),
    refetchInterval: 6000,
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
    onSuccess: () => {
      setContent('');
      // Clean up previews
      stagedAttachments.forEach((a) => {
        if (a.previewUrl && a.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(a.previewUrl);
        }
      });
      setStagedAttachments([]);
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

  // Upload files to backend
  const uploadFiles = async (filesToUpload: File[]) => {
    if (!selectedProjectId) {
      showToast('Please select a project channel first', 'error');
      return;
    }

    const newStaged: StagedAttachment[] = [];

    for (const file of filesToUpload) {
      const mime = file.type.toLowerCase();
      let mediaType: 'image' | 'video' | 'document' | 'other' = 'other';

      if (ALLOWED_IMAGE_TYPES.includes(mime)) {
        mediaType = 'image';
        if (file.size > MAX_IMAGE_SIZE) {
          showToast(`"${file.name}" exceeds 10 MB limit for images`, 'error');
          continue;
        }
      } else if (ALLOWED_VIDEO_TYPES.includes(mime) || file.name.endsWith('.mp4') || file.name.endsWith('.webm') || file.name.endsWith('.mov')) {
        mediaType = 'video';
        if (file.size > MAX_VIDEO_SIZE) {
          showToast(`"${file.name}" exceeds 100 MB limit for videos`, 'error');
          continue;
        }
      } else if (ALLOWED_DOC_TYPES.includes(mime) || file.name.endsWith('.pdf')) {
        mediaType = 'document';
        if (file.size > MAX_DOC_SIZE) {
          showToast(`"${file.name}" exceeds 25 MB limit for PDF documents`, 'error');
          continue;
        }
      } else {
        showToast(`"${file.name}" has an unsupported format. Allowed: JPG, PNG, WEBP, MP4, WEBM, PDF`, 'error');
        continue;
      }

      const tempId = `att-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const previewUrl = URL.createObjectURL(file);

      newStaged.push({
        id: tempId,
        file,
        previewUrl,
        name: file.name,
        size: file.size,
        type: mediaType,
        mimeType: mime || (mediaType === 'image' ? 'image/jpeg' : mediaType === 'video' ? 'video/mp4' : 'application/pdf'),
        uploading: true,
        progress: 10,
      });
    }

    if (newStaged.length === 0) return;

    setStagedAttachments((prev) => [...prev, ...newStaged]);

    // Upload each staged item
    for (const staged of newStaged) {
      try {
        const formData = new FormData();
        formData.append('files', staged.file);

        const res = await api.post<{
          success: boolean;
          message?: string;
          attachments: MessageAttachment[];
        }>(`/projects/${selectedProjectId}/messages/upload`, formData);

        if (res.success && res.attachments && res.attachments.length > 0) {
          const uploaded = res.attachments[0];
          setStagedAttachments((prev) =>
            prev.map((item) =>
              item.id === staged.id
                ? {
                    ...item,
                    uploading: false,
                    progress: 100,
                    uploadedUrl: uploaded.url,
                    storageKey: uploaded.storageKey,
                    type: (uploaded.type as any) || item.type,
                  }
                : item
            )
          );
        } else {
          throw new Error(res.message || 'Server rejected media upload');
        }
      } catch (err: any) {
        setStagedAttachments((prev) =>
          prev.map((item) =>
            item.id === staged.id
              ? {
                  ...item,
                  uploading: false,
                  error: err.message || 'Upload failed',
                }
              : item
          )
        );
        showToast(`Failed to upload "${staged.name}": ${err.message || 'Network error'}`, 'error');
      }
    }
  };

  const handleFilesSelected = (files: File[]) => {
    uploadFiles(files);
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      setIsDragging(false);
      dragCounter.current = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(Array.from(e.dataTransfer.files));
    }
  };

  // Remove staged attachment
  const handleRemoveStaged = (id: string) => {
    setStagedAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  // Replace attachment trigger
  const handleTriggerReplace = (id: string) => {
    replacingIdRef.current = id;
    replaceInputRef.current?.click();
  };

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = replacingIdRef.current;
    if (!file || !targetId) return;

    // Remove old item
    handleRemoveStaged(targetId);
    // Upload replacement
    await uploadFiles([file]);

    if (e.target) e.target.value = '';
    replacingIdRef.current = null;
  };

  // Send message
  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const isUploadingAny = stagedAttachments.some((a) => a.uploading);
    if (isUploadingAny) {
      showToast('Please wait for media uploads to finish before sending', 'info');
      return;
    }

    const readyAttachments = stagedAttachments
      .filter((a) => a.uploadedUrl)
      .map((a) => ({
        url: a.uploadedUrl!,
        name: a.name,
        type: a.type,
        size: a.size,
        mimeType: a.mimeType,
        storageKey: a.storageKey,
      }));

    if (!content.trim() && readyAttachments.length === 0) {
      showToast('Please enter a message or attach an image or video', 'info');
      return;
    }

    sendMessageMutation.mutate({
      content: content.trim(),
      attachments: readyAttachments,
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

  // Lightbox controls
  const openLightbox = (url: string, name: string, type: 'image' | 'video' = 'image') => {
    setLightboxMedia({ url, name, type });
    setZoomLevel(1);
    setRotation(0);
  };

  const closeLightbox = () => {
    setLightboxMedia(null);
    setZoomLevel(1);
    setRotation(0);
  };

  const handleDownload = (e: React.MouseEvent, url: string, filename: string) => {
    e.stopPropagation();
    const authUrl = getAuthenticatedMediaUrl(url);
    const downloadUrl = authUrl.includes('?') ? `${authUrl}&download=true` : `${authUrl}?download=true`;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename || 'download';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeProject = projects.find(
    (p: any) =>
      (p._id || p.id) === selectedProjectId ||
      (p.code && p.code.toLowerCase() === selectedProjectId.toLowerCase())
  );

  const filteredProjects = projects.filter((p: any) => {
    if (!projectSearch) return true;
    const q = projectSearch.toLowerCase();
    return p.name?.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q);
  });

  // Last outgoing message seen check for bottom thread indicator
  const outgoingMessages = messages.filter((m: ProjectMessage) => {
    const sId =
      typeof m.sender === 'object' && m.sender !== null
        ? (m.sender as any)._id || (m.sender as any).id
        : m.sender;
    return String(sId) === String(currentUserId);
  });
  const lastOutgoingMessage =
    outgoingMessages.length > 0 ? outgoingMessages[outgoingMessages.length - 1] : null;

  const lastSeenReaders =
    lastOutgoingMessage?.readBy?.filter((r) => {
      const rId =
        typeof r.user === 'object' && r.user !== null
          ? (r.user as any)._id || (r.user as any).id
          : r.user;
      return rId && String(rId) !== String(currentUserId);
    }) || [];
  const lastOutgoingIsSeen = lastSeenReaders.length > 0;
  const lastSeenReaderName =
    lastSeenReaders[0]?.user && typeof lastSeenReaders[0].user === 'object'
      ? (lastSeenReaders[0].user as any).name
      : 'Recipient';
  const lastSeenAt = lastSeenReaders[0]?.readAt;

  const isAnyStagedUploading = stagedAttachments.some((a) => a.uploading);
  const canSend = (content.trim().length > 0 || stagedAttachments.some((a) => a.uploadedUrl)) && !isAnyStagedUploading;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative h-[calc(100vh-5.5rem)] flex flex-col md:flex-row bg-white rounded-3xl border border-slate-200/90 shadow-card overflow-hidden"
    >
      {/* DRAG AND DROP OVERLAY */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-navy-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
          <div className="w-20 h-20 rounded-3xl bg-amber-500/20 border-2 border-dashed border-amber-400 text-amber-400 flex items-center justify-center mb-4 animate-bounce">
            <UploadCloud className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-black text-white mb-2">Drop Media Files Here</h3>
          <p className="text-sm text-slate-300 max-w-md">
            Drag & drop images (JPEG, PNG, WebP up to 10MB) or walkthrough videos (MP4, WebM up to 100MB) directly into the project channel.
          </p>
        </div>
      )}

      {/* HIDDEN FILE INPUTS */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,application/pdf"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFilesSelected(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,application/pdf"
        onChange={handleReplaceFile}
      />

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
                  <div className="relative flex-shrink-0">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                        isSelected ? 'bg-navy-900 text-amber-400' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {p.code?.substring(0, 3) || 'PRJ'}
                    </div>
                    {isSelected && isOtherPartyOnline && (
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white animate-pulse" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`text-xs truncate ${
                          isSelected ? 'font-black text-navy-950' : 'font-bold text-slate-800'
                        }`}
                      >
                        {p.name}
                      </span>
                      {isSelected && isOtherPartyOnline && (
                        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded-full flex-shrink-0">
                          Active
                        </span>
                      )}
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
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {/* Chat Header with ONLINE presence */}
        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between bg-white flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-xl bg-navy-900 text-amber-500 flex items-center justify-center font-bold text-xs shadow-xs">
                {activeProject?.code?.substring(0, 3) || 'PRJ'}
              </div>
              {/* Online Green Pulsing Indicator Dot */}
              {isOtherPartyOnline ? (
                <span
                  className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white animate-pulse"
                  title="Team members currently active"
                />
              ) : (
                <span
                  className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-slate-300 rounded-full border-2 border-white"
                  title="Offline"
                />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-navy-950 truncate">
                  {activeProject?.name || 'Select a project channel'}
                </h3>

                {/* ONLINE / OFFLINE Status Badge */}
                {isOtherPartyOnline ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 animate-in fade-in">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                    <span>Online</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    <span>Offline</span>
                  </span>
                )}
              </div>

              {/* Subtitle: Linked Accounts status */}
              <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
                {presenceData?.linkedMD && (
                  <span className="font-medium text-slate-700">
                    MD: <strong className="text-navy-950">{presenceData.linkedMD.name}</strong>
                  </span>
                )}
                <span className="text-slate-300">•</span>
                {presenceData?.hasAssignedInCharge && presenceData.linkedInCharges && presenceData.linkedInCharges.length > 0 ? (
                  <span className="font-medium text-slate-700">
                    In-Charge:{' '}
                    <strong className="text-navy-950">
                      {presenceData.linkedInCharges.map((ic) => ic.name).join(', ')}
                    </strong>
                    {isOtherPartyOnline ? (
                      <span className="ml-1 text-emerald-600 font-bold">
                        ({otherOnlineParticipants.map((p) => p.name).join(', ')} is online)
                      </span>
                    ) : (
                      <span className="ml-1 text-slate-400 font-normal">(Offline)</span>
                    )}
                  </span>
                ) : (
                  <span className="text-amber-700 font-semibold flex items-center gap-1">
                    <span>⚠️ No Site In-Charge assigned yet</span>
                    {(user?.role === 'MD' || user?.role === 'OWNER') && (
                      <button
                        onClick={() => navigate(`/projects/${selectedProjectId}`)}
                        className="text-amber-800 underline font-bold hover:text-amber-950 ml-1 cursor-pointer"
                      >
                        Assign now
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Header: Strictly Linked Accounts Chips (MD and their linked In-Charges) */}
          <div className="hidden sm:flex items-center gap-2">
            {/* Linked MD */}
            {presenceData?.linkedMD && (
              <div
                key={presenceData.linkedMD.userId}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all ${
                  presenceData.linkedMD.isOnline
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}
                title={`${presenceData.linkedMD.name} (Managing Director) - ${
                  presenceData.linkedMD.isOnline ? 'Active on SiteTrack' : 'Offline'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    presenceData.linkedMD.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                  }`}
                />
                <span className="truncate max-w-[120px]">
                  {presenceData.linkedMD.name}
                  {presenceData.linkedMD.userId === currentUserId && ' (You)'}
                </span>
                <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 uppercase">
                  MD
                </span>
              </div>
            )}

            {/* Linked In-Charges (strictly for this project) */}
            {presenceData?.hasAssignedInCharge && presenceData.linkedInCharges && presenceData.linkedInCharges.length > 0 ? (
              presenceData.linkedInCharges.map((ic) => {
                const isCurrentUser = ic.userId === currentUserId;
                return (
                  <div
                    key={ic.userId}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all ${
                      ic.isOnline
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950 shadow-2xs'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                    title={`${ic.name} (Site In-Charge) - ${ic.isOnline ? 'Active on SiteTrack' : 'Offline'}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        ic.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                      }`}
                    />
                    <span className="truncate max-w-[120px]">
                      {ic.name}
                      {isCurrentUser && ' (You)'}
                    </span>
                    <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-navy-100 text-navy-900 border border-navy-200 uppercase">
                      In-Charge
                    </span>
                  </div>
                );
              })
            ) : (
              <button
                onClick={() => {
                  if (user?.role === 'MD' || user?.role === 'OWNER') {
                    navigate(`/projects/${selectedProjectId}`);
                  }
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-amber-50 border border-amber-300 text-amber-900 shadow-2xs hover:bg-amber-100 transition-colors cursor-pointer"
                title="No Site In-Charge is assigned to this project yet."
              >
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                <span className="font-bold">⚠️ No In-Charge Assigned</span>
                {(user?.role === 'MD' || user?.role === 'OWNER') && (
                  <span className="text-[10px] font-extrabold text-amber-800 underline ml-0.5">
                    Assign
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Messages Feed */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50/30">
          {/* Informational banner when project has no assigned in-charge */}
          {presenceData && !presenceData.hasAssignedInCharge && activeProject && (
            <div className="bg-amber-50 border border-amber-200/90 rounded-2xl p-3 mb-2 flex items-center justify-between gap-3 text-xs shadow-2xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold flex-shrink-0 shadow-xs">
                  ⚠️
                </div>
                <div>
                  <p className="font-bold text-navy-950">
                    No Site In-Charge Assigned to {activeProject.name}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    SiteTrack channels only show linked accounts (the MD and assigned Site In-Charges). Assign an engineer to enable direct two-way messaging.
                  </p>
                </div>
              </div>
              {(user?.role === 'MD' || user?.role === 'OWNER') && (
                <button
                  onClick={() => navigate(`/projects/${selectedProjectId}`)}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-navy-950 font-bold text-xs rounded-xl flex-shrink-0 transition-colors shadow-2xs cursor-pointer"
                >
                  Assign In-Charge
                </button>
              )}
            </div>
          )}

          {isLoadingMessages ? (
            <LoadingSkeleton rows={5} height="h-16" />
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shadow-xs">
                <MessageSquare className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-bold text-navy-950">
                {!presenceData?.hasAssignedInCharge
                  ? 'No Site In-Charge Assigned Yet'
                  : 'Start the conversation'}
              </h4>
              <p className="text-xs text-slate-400 max-w-sm">
                {!presenceData?.hasAssignedInCharge
                  ? 'Assign an In-Charge to this project to share photos, walkthrough videos, payment requests, and daily report discussions.'
                  : `Coordinate operations between MD (${presenceData?.linkedMD?.name || 'Managing Director'}) and Site In-Charge (${presenceData?.linkedInCharges?.map((i) => i.name).join(', ')}).`}
              </p>
              <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500 bg-slate-100/80 px-3 py-1.5 rounded-xl border border-slate-200">
                <UploadCloud className="w-4 h-4 text-amber-500" />
                <span>Drag & drop photos or videos anywhere to upload</span>
              </div>
            </div>
          ) : (
            messages.map((m: ProjectMessage) => {
              const id = m._id || m.id;
              const isMine =
                (typeof m.sender === 'object' && m.sender !== null
                  ? (m.sender as any)._id || (m.sender as any).id
                  : m.sender) === currentUserId || m.sender?.email === user?.email;

              const isSenderOwner =
                m.sender?.role === 'MD' || m.sender?.role === 'OWNER';

              // Seen calculation
              const otherReaders =
                m.readBy?.filter((r) => {
                  const rId =
                    typeof r.user === 'object' && r.user !== null
                      ? (r.user as any)._id || (r.user as any).id
                      : r.user;
                  return rId && String(rId) !== String(currentUserId);
                }) || [];

              const isSeen = otherReaders.length > 0;
              const firstReader = otherReaders[0];
              const seenReaderName =
                typeof firstReader?.user === 'object' && firstReader?.user !== null
                  ? (firstReader.user as any).name
                  : isSenderOwner
                  ? 'Site In-Charge'
                  : 'Managing Director';
              const seenAt = firstReader?.readAt;

              const hasAttachments = m.attachments && m.attachments.length > 0;

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
                    className={`max-w-xl rounded-2xl p-3.5 shadow-xs space-y-2 ${
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

                    {/* MEDIA ATTACHMENTS (Images, Videos, PDFs) */}
                    {hasAttachments && (
                      <div className="space-y-2 pt-0.5">
                        {/* 1. IMAGES GRID */}
                        {(() => {
                          const imageAtts = m.attachments.filter(
                            (a) => a.type === 'image' || a.mimeType?.startsWith('image/')
                          );
                          if (imageAtts.length === 0) return null;

                          return (
                            <div
                              className={`grid gap-2 ${
                                imageAtts.length === 1
                                  ? 'grid-cols-1'
                                  : imageAtts.length === 2
                                  ? 'grid-cols-2'
                                  : 'grid-cols-2 sm:grid-cols-3'
                              }`}
                            >
                              {imageAtts.map((att, idx) => {
                                const mediaUrl = getAuthenticatedMediaUrl(att.url);
                                return (
                                  <div
                                    key={idx}
                                    onClick={() => openLightbox(att.url, att.name, 'image')}
                                    className="group relative rounded-xl overflow-hidden bg-black/10 border border-slate-200/50 cursor-pointer aspect-video sm:aspect-square flex items-center justify-center"
                                  >
                                    <img
                                      src={mediaUrl}
                                      alt={att.name || 'Project photo'}
                                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                      loading="lazy"
                                    />
                                    {/* Overlay on hover */}
                                    <div className="absolute inset-0 bg-navy-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2">
                                      <span className="p-1.5 rounded-lg bg-white/20 backdrop-blur-md text-white hover:bg-white/40">
                                        <Maximize2 className="w-4 h-4" />
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => handleDownload(e, att.url, att.name)}
                                        className="p-1.5 rounded-lg bg-white/20 backdrop-blur-md text-white hover:bg-white/40"
                                        title="Download photo"
                                      >
                                        <Download className="w-4 h-4" />
                                      </button>
                                    </div>
                                    {att.size && (
                                      <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-navy-950/70 text-white backdrop-blur-xs">
                                        {formatFileSize(att.size)}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* 2. VIDEOS PLAYER */}
                        {(() => {
                          const videoAtts = m.attachments.filter(
                            (a) => a.type === 'video' || a.mimeType?.startsWith('video/')
                          );
                          if (videoAtts.length === 0) return null;

                          return (
                            <div className="space-y-2">
                              {videoAtts.map((att, idx) => {
                                const mediaUrl = getAuthenticatedMediaUrl(att.url);
                                return (
                                  <div
                                    key={idx}
                                    className="rounded-xl overflow-hidden bg-black border border-slate-700/50 shadow-md"
                                  >
                                    <video
                                      controls
                                      preload="metadata"
                                      className="w-full max-h-72 object-contain bg-black"
                                      src={mediaUrl}
                                      controlsList="nodownload"
                                    >
                                      Your browser does not support the video tag.
                                    </video>
                                    <div
                                      className={`px-3 py-1.5 flex items-center justify-between text-[11px] font-medium border-t ${
                                        isMine
                                          ? 'bg-navy-900/80 border-white/10 text-slate-300'
                                          : 'bg-slate-100 border-slate-200 text-slate-700'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5 truncate">
                                        <Film className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                                        <span className="truncate">{att.name}</span>
                                        {att.size && (
                                          <span className="text-[10px] text-slate-400 font-mono">
                                            ({formatFileSize(att.size)})
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={(e) => handleDownload(e, att.url, att.name)}
                                        className="flex items-center gap-1 text-[10px] font-bold text-amber-400 hover:text-amber-300 transition-colors ml-2 flex-shrink-0"
                                      >
                                        <Download className="w-3 h-3" />
                                        <span>Download</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* 3. DOCUMENTS / PDFS */}
                        {(() => {
                          const docAtts = m.attachments.filter(
                            (a) =>
                              a.type === 'document' ||
                              a.type === 'pdf' ||
                              a.mimeType === 'application/pdf'
                          );
                          if (docAtts.length === 0) return null;

                          return (
                            <div className="space-y-1.5">
                              {docAtts.map((att, idx) => (
                                <div
                                  key={idx}
                                  className={`flex items-center justify-between p-2.5 rounded-xl text-xs border transition-colors ${
                                    isMine
                                      ? 'bg-white/10 border-white/20 text-white'
                                      : 'bg-slate-50 border-slate-200 text-navy-950'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 truncate min-w-0">
                                    <FileText className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                    <div className="truncate">
                                      <p className="font-bold truncate text-[11px]">{att.name}</p>
                                      {att.size && (
                                        <p className="text-[10px] text-slate-400 font-mono">
                                          {formatFileSize(att.size)}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => handleDownload(e, att.url, att.name)}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-amber-400 hover:text-amber-300 ml-2"
                                    title="Download document"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Content text */}
                    {m.content && (
                      <p className="text-xs leading-relaxed whitespace-pre-wrap">{m.content}</p>
                    )}

                    {/* MESSAGE FOOTER: TIME + SEEN STATUS */}
                    <div className="flex items-center justify-end gap-1 pt-1 text-[10px]">
                      <span className="text-slate-400">
                        {formatDate(m.createdAt, 'hh:mm a')}
                      </span>

                      {/* Outgoing Read Receipts */}
                      {isMine && (
                        <span
                          className="inline-flex items-center gap-0.5 ml-1 font-bold select-none cursor-default"
                          title={
                            isSeen
                              ? `Seen by ${seenReaderName} at ${seenAt ? formatDate(seenAt, 'hh:mm a') : 'recently'}`
                              : isOtherPartyOnline
                              ? 'Delivered to online participant'
                              : 'Sent'
                          }
                        >
                          {isSeen ? (
                            <>
                              <CheckCheck className="w-3.5 h-3.5 text-sky-400 stroke-[2.5]" />
                              <span className="text-[10px] text-sky-400 font-extrabold">Seen</span>
                            </>
                          ) : isOtherPartyOnline ? (
                            <>
                              <CheckCheck className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-[10px] text-slate-400">Delivered</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-[10px] text-slate-400">Sent</span>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Real-time "Seen by" receipt tag at bottom of thread */}
          {lastOutgoingMessage && lastOutgoingIsSeen && (
            <div className="flex items-center justify-end gap-1.5 px-2 text-[11px] text-sky-600 font-medium animate-in fade-in">
              <CheckCheck className="w-3.5 h-3.5 text-sky-500" />
              <span>
                Seen by {lastSeenReaderName} at{' '}
                {lastSeenAt ? formatDate(lastSeenAt, 'hh:mm a') : 'recently'}
              </span>
            </div>
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
              className="p-1 text-amber-700 hover:text-amber-900 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* STAGED ATTACHMENTS PREVIEW TRAY */}
        {stagedAttachments.length > 0 && (
          <div className="px-6 py-3 bg-slate-100/90 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-amber-500" />
                <span>
                  Attachments ({stagedAttachments.length})
                  {isAnyStagedUploading && ' • Uploading...'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  stagedAttachments.forEach((a) => {
                    if (a.previewUrl.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl);
                  });
                  setStagedAttachments([]);
                }}
                className="text-[10px] text-rose-600 font-bold hover:underline cursor-pointer"
              >
                Clear all
              </button>
            </div>

            <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
              {stagedAttachments.map((att) => (
                <div
                  key={att.id}
                  className={`relative flex items-center gap-2.5 p-2 rounded-xl border shadow-xs flex-shrink-0 transition-all ${
                    att.error
                      ? 'bg-rose-50 border-rose-300 text-rose-900'
                      : att.uploading
                      ? 'bg-white border-amber-300 text-navy-950'
                      : 'bg-white border-slate-200 text-navy-950'
                  }`}
                >
                  {/* Thumbnail Preview */}
                  <div className="relative w-12 h-12 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center flex-shrink-0 border border-slate-200">
                    {att.type === 'image' ? (
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="w-full h-full object-cover"
                      />
                    ) : att.type === 'video' ? (
                      <div className="w-full h-full bg-navy-950 flex items-center justify-center text-amber-400">
                        <Film className="w-5 h-5" />
                      </div>
                    ) : (
                      <div className="w-full h-full bg-sky-50 flex items-center justify-center text-sky-600">
                        <FileText className="w-5 h-5" />
                      </div>
                    )}

                    {att.uploading && (
                      <div className="absolute inset-0 bg-navy-950/60 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                      </div>
                    )}
                  </div>

                  {/* Metadata */}
                  <div className="min-w-0 pr-6">
                    <p className="font-bold text-xs truncate max-w-[130px]" title={att.name}>
                      {att.name}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {formatFileSize(att.size)} •{' '}
                      {att.error ? (
                        <span className="text-rose-600 font-bold">Failed</span>
                      ) : att.uploading ? (
                        <span className="text-amber-600 font-bold">Uploading</span>
                      ) : (
                        <span className="text-emerald-600 font-bold">Ready</span>
                      )}
                    </p>
                    {/* Controls: Replace / Remove */}
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => handleTriggerReplace(att.id)}
                        className="text-[10px] font-semibold text-slate-500 hover:text-amber-600 flex items-center gap-0.5 cursor-pointer"
                        title="Replace file"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        <span>Replace</span>
                      </button>
                    </div>
                  </div>

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => handleRemoveStaged(att.id)}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message Input Box */}
        <div className="p-4 border-t border-slate-200 bg-white">
          <form onSubmit={handleSend} className="flex items-end gap-2">
            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 text-slate-500 hover:text-navy-900 hover:bg-slate-100 rounded-xl cursor-pointer transition-colors flex-shrink-0"
              title="Attach photos (JPG, PNG, WebP) or walkthrough videos (MP4, WebM)"
            >
              <Paperclip className="w-5 h-5 text-slate-600 hover:text-amber-600" />
            </button>

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
              isLoading={sendMessageMutation.isPending || isAnyStagedUploading}
              disabled={!canSend}
              className="rounded-2xl"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>

      {/* FULLSCREEN LIGHTBOX MODAL */}
      {lightboxMedia && (
        <div
          onClick={closeLightbox}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4 sm:p-6 animate-in fade-in duration-200"
        >
          {/* Lightbox Header */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-5xl flex items-center justify-between text-white pb-3 border-b border-white/10"
          >
            <div className="flex items-center gap-2 truncate">
              <ImageIcon className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <span className="text-sm font-bold truncate">{lightboxMedia.name}</span>
            </div>

            <div className="flex items-center gap-2">
              {/* Zoom Controls */}
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 3))}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 0.5))}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="Rotate 90 degrees"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              {/* Download */}
              <button
                type="button"
                onClick={(e) => handleDownload(e, lightboxMedia.url, lightboxMedia.name)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-navy-950 font-bold text-xs transition-colors cursor-pointer"
                title="Download full quality media"
              >
                <Download className="w-4 h-4" />
                <span>Download</span>
              </button>

              {/* Close */}
              <button
                type="button"
                onClick={closeLightbox}
                className="p-2 rounded-xl bg-white/10 hover:bg-rose-500 text-white transition-colors cursor-pointer ml-2"
                title="Close viewer (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Lightbox Center Content */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex-1 w-full max-w-5xl flex items-center justify-center p-4 overflow-hidden"
          >
            <img
              src={getAuthenticatedMediaUrl(lightboxMedia.url)}
              alt={lightboxMedia.name}
              style={{
                transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                transition: 'transform 0.2s ease-out',
              }}
              className="max-h-[75vh] max-w-full object-contain rounded-xl select-none shadow-2xl"
            />
          </div>

          {/* Lightbox Footer Info */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] text-slate-400 text-center"
          >
            <span>Zoom: {Math.round(zoomLevel * 100)}% • Press Esc to exit</span>
          </div>
        </div>
      )}
    </div>
  );
};
