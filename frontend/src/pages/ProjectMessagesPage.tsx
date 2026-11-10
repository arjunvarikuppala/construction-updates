import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Send,
  Paperclip,
  FileText,
  CreditCard,
  Receipt,
  X,
  ExternalLink,
  Check,
  CheckCheck,
  Search,
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
  ArrowLeft,
  WifiOff,
  CornerUpLeft,
  FolderOpen,
  Mic,
  Pin,
  Ban,
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
  ProjectPresenceData,
} from '../types/index.js';
import { formatDate } from '../utils/dates.js';

import { SecureImage, SecureVideo } from '../components/common/SecureMedia.js';
import { resolveMediaUrl } from '../utils/media.js';
import {
  DocumentViewer,
  ReplyQuote,
  ReplyComposerBar,
  ShareProjectFileModal,
  ShareableFile,
  uploadWithProgress,
  formatFileSize,
  fileTypeLabel,
  isAudioAttachment,
} from '../components/chat/ChatParts.js';
import {
  DayDivider,
  dayKey,
  ReactionChips,
  MessageActions,
  PinnedBar,
  ChatSearchPanel,
  TypingIndicator,
  useTypingEmitter,
  useTypingUsers,
  VoiceRecorder,
  VoiceNotePlayer,
  EditComposerBar,
  JumpToLatest,
  isVoiceRecordingSupported,
  canStillModify,
  idOf,
} from '../components/chat/AdvancedChat.js';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_DOC_TYPES = ['application/pdf'];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_DOC_SIZE = 25 * 1024 * 1024; // 25 MB

interface StagedAttachment {
  id: string;
  file?: File; // absent for existing project files shared by reference
  shared?: boolean;
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

// Media is fetched through short-lived signed URLs (see utils/media.ts);
// the login token is never placed in a URL.

export const ProjectMessagesPage: React.FC = () => {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const [searchParams] = useSearchParams();
  const linkedPaymentId = searchParams.get('paymentId');
  const linkedReportId = searchParams.get('reportId');

  const navigate = useNavigate();
  const { user } = useAuth();
  const { socket, isConnected, joinProject, leaveProject } = useSocket();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const replacingIdRef = useRef<string | null>(null);
  const dragCounter = useRef(0);
  const isNearBottomRef = useRef(true);
  const prevProjectIdRef = useRef<string>('');

  const [mobileView, setMobileView] = useState<'channels' | 'chat'>('chat');

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

  // Reply-to, document viewer, share-from-records
  const [replyTarget, setReplyTarget] = useState<ProjectMessage | null>(null);
  const [viewerDoc, setViewerDoc] = useState<MessageAttachment | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const clientMessageIdRef = useRef<string | null>(null);

  // Advanced chat state
  const [editTarget, setEditTarget] = useState<ProjectMessage | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sendingVoice, setSendingVoice] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Fetch Projects list
  const { data: projectsData, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ success: boolean; projects: any[] }>('/projects'),
  });
  const projects = useMemo(() => projectsData?.projects || [], [projectsData]);

  // Synchronously match routeProjectId with projects list
  const matchedProject = useMemo(() => {
    if (!routeProjectId || projects.length === 0) return null;
    return (
      projects.find(
        (p: any) =>
          (p._id || p.id) === routeProjectId ||
          (p.code && p.code.toLowerCase() === routeProjectId.toLowerCase())
      ) || null
    );
  }, [projects, routeProjectId]);

  // Canonical active project ID
  const activeProjectId = useMemo(() => {
    if (matchedProject) return matchedProject._id || matchedProject.id;
    if (routeProjectId) return routeProjectId;
    if (projects.length > 0) return projects[0]._id || projects[0].id;
    return '';
  }, [matchedProject, routeProjectId, projects]);

  const activeProject = useMemo(() => {
    if (matchedProject) return matchedProject;
    if (activeProjectId && projects.length > 0) {
      return projects.find((p: any) => (p._id || p.id) === activeProjectId) || null;
    }
    return null;
  }, [matchedProject, activeProjectId, projects]);

  // If no routeProjectId was provided in URL, redirect synchronously once projects load
  useEffect(() => {
    if (!routeProjectId && projects.length > 0) {
      const defaultId = projects[0]._id || projects[0].id;
      navigate(`/messages/${defaultId}`, { replace: true });
    }
  }, [routeProjectId, projects, navigate]);

  // Handle channel selection cleanly without state conflicts
  const handleSelectProject = useCallback(
    (targetProjectId: string) => {
      if (targetProjectId === activeProjectId) {
        setMobileView('chat');
        return;
      }

      // Clean up staged attachments from previous channel so media doesn't leak into new project
      setStagedAttachments((prev) => {
        prev.forEach((a) => {
          if (a.previewUrl && a.previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(a.previewUrl);
          }
        });
        return [];
      });

      // Reset linked context if it was general or linked to another context
      if (contextType !== 'GENERAL' && !linkedPaymentId && !linkedReportId) {
        setContextType('GENERAL');
        setContextId('');
        setContextSummary('');
      }

      setReplyTarget(null);
      setEditTarget(null);
      setSearchOpen(false);
      setRecording(false);
      setContent('');
      clientMessageIdRef.current = null;
      setMobileView('chat');
      navigate(`/messages/${targetProjectId}`);
    },
    [activeProjectId, contextType, linkedPaymentId, linkedReportId, navigate]
  );

  // Socket room join / leave lifecycle & mark seen
  useEffect(() => {
    if (!activeProjectId) return;

    joinProject(activeProjectId);

    // Tell backend & peers that messages are read
    api
      .put(`/projects/${activeProjectId}/messages/read`)
      .then(() => {
        socket?.emit('messages:mark_seen', { projectId: activeProjectId });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
        queryClient.invalidateQueries({ queryKey: ['unread-messages-count'] });
      })
      .catch(() => {});

    return () => {
      leaveProject(activeProjectId);
    };
  }, [activeProjectId, joinProject, leaveProject, socket, queryClient]);

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

  // Fetch Presence & Online participants for active project (with request cancellation)
  const { data: presenceData, isLoading: isLoadingPresence } = useQuery({
    queryKey: ['project-presence', activeProjectId],
    queryFn: ({ signal }) =>
      api.get<ProjectPresenceData>(`/projects/${activeProjectId}/messages/presence`, { signal }),
    enabled: Boolean(activeProjectId),
    refetchInterval: 5000,
  });

  const participants = presenceData?.participants || [];
  const currentUserId = user?.id || (user as any)?._id;
  const typingNames = useTypingUsers(socket, activeProjectId, String(currentUserId || ''));
  const typingEmitter = useTypingEmitter(socket, activeProjectId);

  const otherParticipants = participants.filter((p) => p.userId !== currentUserId);
  const otherOnlineParticipants = otherParticipants.filter((p) => p.isOnline);
  const isOtherPartyOnline = otherOnlineParticipants.length > 0;

  // Fetch Messages for active project (with request cancellation via AbortSignal)
  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    isFetching: isFetchingMessages,
    isError: isMessagesError,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ['project-messages', activeProjectId],
    queryFn: ({ signal }) =>
      api.get<{ success: boolean; messages: ProjectMessage[] }>(
        `/projects/${activeProjectId}/messages`,
        { signal }
      ),
    enabled: Boolean(activeProjectId),
    refetchInterval: 6000,
  });

  // Strict message isolation: guarantees no previous or cross-project messages ever render
  const rawMessages = messagesData?.messages || [];
  const messages = useMemo(() => {
    if (!activeProjectId) return [];
    return rawMessages.filter((m: ProjectMessage) => {
      const pId =
        typeof m.project === 'object' && m.project !== null
          ? (m.project as any)._id || (m.project as any).id
          : m.project;
      return !pId || String(pId) === String(activeProjectId);
    });
  }, [rawMessages, activeProjectId]);

  // Scroll management:
  // 1. Channel switch: immediate scroll to bottom
  useEffect(() => {
    if (activeProjectId && activeProjectId !== prevProjectIdRef.current) {
      prevProjectIdRef.current = activeProjectId;
      isNearBottomRef.current = true;
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      });
    }
  }, [activeProjectId]);

  // Track if user is near bottom
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const threshold = 120;
    const isBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    isNearBottomRef.current = isBottom;
    setShowJump(!isBottom);
    if (isBottom) setNewBelow(0);
  }, []);

  // The feed also changes size when bars above/below it appear (edit, reply, typing)
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => handleScroll());
    ro.observe(el);
    return () => ro.disconnect();
  }, [handleScroll, activeProjectId]);

  const scrollToLatest = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setNewBelow(0);
  }, []);

  // 2. Incoming or updated messages: smooth scroll ONLY if user is near bottom or sent own message
  const prevMessagesCountRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      const sId =
        typeof lastMsg?.sender === 'object' && lastMsg?.sender !== null
          ? (lastMsg?.sender as any)._id || (lastMsg?.sender as any).id
          : lastMsg?.sender;
      const isMine = String(sId) === String(currentUserId);

      if (isMine || isNearBottomRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        const added = messages.length - prevMessagesCountRef.current;
        setNewBelow((n) => n + added);
      }
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages, currentUserId]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: (data: any) =>
      api.post(`/projects/${activeProjectId}/messages`, data),
    onSuccess: (res: any) => {
      setContent('');
      setReplyTarget(null);
      clientMessageIdRef.current = null;
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

      // If backend returned the created message, add to cache immediately if not already present
      const createdMsg = res?.data?._id ? res.data : res?.message?._id ? res.message : null;
      if (createdMsg) {
        queryClient.setQueriesData<any>(
          { queryKey: ['project-messages', activeProjectId] },
          (old: any) => {
            if (!old || !Array.isArray(old.messages)) return old;
            const exists = old.messages.some(
              (m: any) => String(m._id || m.id) === String(createdMsg._id || createdMsg.id)
            );
            if (exists) return old;
            return {
              ...old,
              messages: [...old.messages, createdMsg],
              count: (old.count || old.messages.length) + 1,
            };
          }
        );
      }

      queryClient.invalidateQueries({ queryKey: ['project-messages', activeProjectId] });
      queryClient.invalidateQueries({ queryKey: ['unread-messages-count'] });

      // Immediate scroll to bottom on own message
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to deliver message', 'error');
    },
  });

  // Replace one message in the cache (edit / delete / reaction / pin results)
  const applyUpdatedMessage = useCallback(
    (updated: any) => {
      if (!updated?._id) return;
      queryClient.setQueriesData<any>({ queryKey: ['project-messages', activeProjectId] }, (old: any) => {
        if (!old || !Array.isArray(old.messages)) return old;
        return { ...old, messages: old.messages.map((m: any) => (idOf(m) === String(updated._id) ? updated : m)) };
      });
    },
    [queryClient, activeProjectId]
  );

  const editMutation = useMutation({
    mutationFn: ({ id, content: text }: { id: string; content: string }) =>
      api.patch<{ data: ProjectMessage }>(`/projects/${activeProjectId}/messages/${id}`, { content: text }),
    onSuccess: (res) => {
      applyUpdatedMessage(res.data);
      setEditTarget(null);
      setContent('');
      queryClient.invalidateQueries({ queryKey: ['project-pinned', activeProjectId] });
    },
    onError: (err: any) => showToast(err.message || 'Could not edit the message', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<{ data: ProjectMessage }>(`/projects/${activeProjectId}/messages/${id}`),
    onSuccess: (res) => {
      applyUpdatedMessage(res.data);
      queryClient.invalidateQueries({ queryKey: ['project-pinned', activeProjectId] });
    },
    onError: (err: any) => showToast(err.message || 'Could not delete the message', 'error'),
  });

  const reactMutation = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) =>
      api.post<{ data: ProjectMessage }>(`/projects/${activeProjectId}/messages/${id}/reactions`, { emoji }),
    onSuccess: (res) => applyUpdatedMessage(res.data),
    onError: (err: any) => showToast(err.message || 'Could not add reaction', 'error'),
  });

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      api.put<{ data: ProjectMessage }>(`/projects/${activeProjectId}/messages/${id}/pin`, { pinned }),
    onSuccess: (res, vars) => {
      applyUpdatedMessage(res.data);
      queryClient.invalidateQueries({ queryKey: ['project-pinned', activeProjectId] });
      showToast(vars.pinned ? 'Message pinned for everyone in this channel' : 'Message unpinned', 'success');
    },
    onError: (err: any) => showToast(err.message || 'Could not update pin', 'error'),
  });

  const startEdit = (m: ProjectMessage) => {
    setReplyTarget(null);
    setEditTarget(m);
    setContent(m.content || '');
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const cancelEdit = () => {
    setEditTarget(null);
    setContent('');
  };

  const startReply = (m: ProjectMessage) => {
    setEditTarget(null);
    setReplyTarget(m);
    textareaRef.current?.focus();
  };

  const confirmDelete = (m: ProjectMessage) => {
    if (window.confirm('Delete this message for everyone? This cannot be undone.')) {
      deleteMutation.mutate(idOf(m));
    }
  };

  const copyText = async (m: ProjectMessage) => {
    try {
      await navigator.clipboard.writeText(m.content || '');
      showToast('Message copied', 'success');
    } catch {
      showToast('Copy is not available in this browser', 'error');
    }
  };

  // Voice note: upload the clip, then post it as its own message
  const sendVoiceNote = async (file: File, durationSeconds: number) => {
    setRecording(false);
    if (!activeProjectId) return;
    const channelId = activeProjectId;
    setSendingVoice(true);
    try {
      const form = new FormData();
      form.append('files', file);
      const up = await uploadWithProgress<{ success: boolean; message?: string; attachments: MessageAttachment[] }>(
        `/projects/${channelId}/messages/upload`,
        form,
        () => undefined
      );
      const att = up.attachments?.[0];
      if (!up.success || !att) throw new Error(up.message || 'Upload failed');
      const res: any = await api.post(`/projects/${channelId}/messages`, {
        attachments: [{ ...att, duration: durationSeconds }],
        replyToMessageId: replyTarget ? idOf(replyTarget) : undefined,
        clientMessageId: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      });
      setReplyTarget(null);
      if (res?.data?._id) {
        queryClient.setQueriesData<any>({ queryKey: ['project-messages', channelId] }, (old: any) => {
          if (!old || !Array.isArray(old.messages)) return old;
          if (old.messages.some((m: any) => idOf(m) === String(res.data._id))) return old;
          return { ...old, messages: [...old.messages, res.data] };
        });
      }
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (err: any) {
      showToast(`Voice note not sent: ${err.message || 'network error'}`, 'error');
    } finally {
      setSendingVoice(false);
    }
  };

  // Upload files to backend
  const uploadFiles = async (filesToUpload: File[]) => {
    if (!activeProjectId) {
      showToast('Please select a project channel first', 'error');
      return;
    }

    const currentChannelId = activeProjectId;
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
      } else if (
        ALLOWED_VIDEO_TYPES.includes(mime) ||
        file.name.endsWith('.mp4') ||
        file.name.endsWith('.webm') ||
        file.name.endsWith('.mov')
      ) {
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
        showToast(
          `"${file.name}" has an unsupported format. Allowed: JPG, PNG, WEBP, MP4, WEBM, PDF`,
          'error'
        );
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
        mimeType:
          mime ||
          (mediaType === 'image'
            ? 'image/jpeg'
            : mediaType === 'video'
            ? 'video/mp4'
            : 'application/pdf'),
        uploading: true,
        progress: 10,
      });
    }

    if (newStaged.length === 0) return;

    setStagedAttachments((prev) => [...prev, ...newStaged]);

    for (const staged of newStaged) {
      await uploadStaged(staged, currentChannelId);
    }
  };

  const patchStaged = (id: string, patch: Partial<StagedAttachment>) =>
    setStagedAttachments((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  // Upload one staged file with progress; also used for retry after a failure
  const uploadStaged = async (staged: StagedAttachment, channelId: string) => {
    if (!staged.file) return;
    patchStaged(staged.id, { uploading: true, error: undefined, progress: 0 });
    try {
      const formData = new FormData();
      formData.append('files', staged.file);
      const res = await uploadWithProgress<{ success: boolean; message?: string; attachments: MessageAttachment[] }>(
        `/projects/${channelId}/messages/upload`,
        formData,
        (pct) => patchStaged(staged.id, { progress: pct })
      );
      const uploaded = res.attachments?.[0];
      if (!res.success || !uploaded) throw new Error(res.message || 'Server rejected media upload');
      patchStaged(staged.id, {
        uploading: false,
        progress: 100,
        uploadedUrl: uploaded.url,
        storageKey: uploaded.storageKey,
        type: (uploaded.type as any) || staged.type,
        mimeType: uploaded.mimeType || staged.mimeType,
        size: uploaded.size || staged.size,
      });
    } catch (err: any) {
      patchStaged(staged.id, { uploading: false, error: err.message || 'Upload failed' });
      showToast(`Failed to upload "${staged.name}": ${err.message || 'Network error'}`, 'error');
    }
  };

  const handleRetryStaged = (id: string) => {
    const item = stagedAttachments.find((a) => a.id === id);
    if (item && activeProjectId) void uploadStaged(item, activeProjectId);
  };

  // Share an existing receipt / invoice / report photo by reference (no re-upload)
  const handleShareFile = (f: ShareableFile) => {
    const isPdf = /\.pdf($|\?)/i.test(f.url);
    setStagedAttachments((prev) =>
      prev.some((a) => a.uploadedUrl === f.url)
        ? prev
        : [
            ...prev,
            {
              id: `shared-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              shared: true,
              previewUrl: '',
              name: f.name,
              size: 0,
              type: isPdf ? 'document' : 'image',
              mimeType: isPdf ? 'application/pdf' : 'image/jpeg',
              uploading: false,
              progress: 100,
              uploadedUrl: f.url,
            },
          ]
    );
    setShareOpen(false);
  };

  // Scroll to a quoted message and flash it
  const jumpToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) {
      showToast('The original message is older than the loaded conversation history.', 'info');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 2000);
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
    typingEmitter.stop();

    if (editTarget) {
      const text = content.trim();
      if (!text && (editTarget.attachments?.length || 0) === 0) {
        showToast('Message text cannot be empty', 'info');
        return;
      }
      editMutation.mutate({ id: idOf(editTarget), content: text });
      return;
    }

    const isUploadingAny = stagedAttachments.some((a) => a.uploading);
    if (isUploadingAny) {
      showToast('Please wait for media uploads to finish before sending', 'info');
      return;
    }

    const readyAttachments = stagedAttachments
      .filter((a) => a.uploadedUrl && !a.error)
      .map((a) => ({
        url: a.uploadedUrl!,
        name: a.name,
        type: a.type,
        size: a.size || undefined,
        mimeType: a.mimeType,
        storageKey: a.storageKey,
      }));

    if (!content.trim() && readyAttachments.length === 0) {
      showToast('Please enter a message or attach an image or video', 'info');
      return;
    }

    if (!clientMessageIdRef.current) {
      clientMessageIdRef.current = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    }

    sendMessageMutation.mutate({
      content: content.trim(),
      attachments: readyAttachments,
      replyToMessageId: replyTarget ? replyTarget._id || replyTarget.id : undefined,
      clientMessageId: clientMessageIdRef.current,
      contextType: contextType !== 'GENERAL' ? contextType : undefined,
      contextId: contextId || undefined,
      contextSummary: contextSummary || undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape' && editTarget) {
      cancelEdit();
    } else if (e.key === 'ArrowUp' && !content && !editTarget) {
      // Quick-edit your last message, like desktop chat apps
      const last = [...outgoingMessages].reverse().find((m) => canStillModify(m) && m.content);
      if (last) {
        e.preventDefault();
        startEdit(last);
      }
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
    void resolveMediaUrl(url).then((authUrl) => {
    if (!authUrl) return;
    const downloadUrl = authUrl.includes('?') ? `${authUrl}&download=true` : `${authUrl}?download=true`;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename || 'download';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    });
  };

  const filteredProjects = useMemo(() => {
    return projects.filter((p: any) => {
      if (!projectSearch) return true;
      const q = projectSearch.toLowerCase();
      return p.name?.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q);
    });
  }, [projects, projectSearch]);

  // Fallbacks to eliminate flickering "No Site In-Charge assigned yet" warning when switching
  const hasAssignedInCharge = useMemo(() => {
    if (presenceData && typeof presenceData.hasAssignedInCharge === 'boolean') {
      return presenceData.hasAssignedInCharge;
    }
    if (activeProject) {
      if (Array.isArray(activeProject.assignedInCharges) && activeProject.assignedInCharges.length > 0) {
        return true;
      }
      if (activeProject.assignedInCharge) return true;
    }
    return false;
  }, [presenceData, activeProject]);

  const assignedInChargeNames = useMemo(() => {
    if (presenceData?.linkedInCharges && presenceData.linkedInCharges.length > 0) {
      return presenceData.linkedInCharges.map((ic) => ic.name).join(', ');
    }
    if (activeProject?.assignedInCharge) {
      if (typeof activeProject.assignedInCharge === 'object' && activeProject.assignedInCharge.name) {
        return activeProject.assignedInCharge.name;
      }
    }
    return '';
  }, [presenceData, activeProject]);

  const mdName = useMemo(() => {
    if (presenceData?.linkedMD?.name) return presenceData.linkedMD.name;
    if (activeProject?.owner && typeof activeProject.owner === 'object' && activeProject.owner.name) {
      return activeProject.owner.name;
    }
    if (activeProject?.createdBy && typeof activeProject.createdBy === 'object' && activeProject.createdBy.name) {
      return activeProject.createdBy.name;
    }
    return 'Managing Director';
  }, [presenceData, activeProject]);

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
  const canSend = editTarget
    ? content.trim().length > 0 || (editTarget.attachments?.length || 0) > 0
    : (content.trim().length > 0 || stagedAttachments.some((a) => a.uploadedUrl)) && !isAnyStagedUploading;
  const showMic = !editTarget && !content.trim() && stagedAttachments.length === 0 && isVoiceRecordingSupported();

  // Determine error status
  const errorStatus = (messagesError as any)?.status;
  const isForbidden = errorStatus === 403 || String((messagesError as any)?.message || '').includes('Forbidden');

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative h-full flex-1 flex flex-col md:flex-row bg-white rounded-2xl sm:rounded-3xl border border-slate-200/90 shadow-card overflow-hidden min-h-0"
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
      <div
        className={`w-full md:w-80 border-r border-slate-200/90 flex flex-col bg-slate-50/50 ${
          mobileView === 'chat' ? 'hidden md:flex' : 'flex flex-1'
        }`}
      >
        <div className="p-4 border-b border-slate-200/90 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-navy-900 text-amber-500 flex items-center justify-center font-bold">
                <MessageSquare className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-black text-navy-950">Project Channels</h2>
            </div>
            <div className="flex items-center gap-1.5">
              {!isConnected && (
                <span
                  title="Reconnecting to real-time chat..."
                  className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"
                />
              )}
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {projects.length}
              </span>
            </div>
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
              const isSelected = id === activeProjectId;
              return (
                <button
                  key={id}
                  onClick={() => handleSelectProject(id)}
                  className={`w-full text-left p-3.5 transition-colors flex items-start gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500/10 border-l-4 border-amber-500'
                      : 'hover:bg-slate-100/70 border-l-4 border-transparent'
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
      <div
        className={`flex-1 flex flex-col h-full overflow-hidden bg-white min-h-0 min-w-0 ${
          mobileView === 'channels' ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Connection status banner if socket is disconnected */}
        {!isConnected && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center justify-between text-[11px] text-amber-800 animate-in fade-in">
            <div className="flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
              <span>Real-time updates paused. Reconnecting to BKR INFRA server...</span>
            </div>
            <button
              onClick={() => {
                socket?.connect();
                refetchMessages();
              }}
              className="text-amber-900 font-bold underline hover:text-amber-950 cursor-pointer"
            >
              Reconnect
            </button>
          </div>
        )}

        {/* Chat Header with ONLINE presence */}
        <div className="h-16 px-3 sm:px-6 border-b border-slate-200 flex items-center justify-between gap-2 sm:gap-4 bg-white shrink-0 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Back to Channels button on mobile */}
            <button
              type="button"
              onClick={() => setMobileView('channels')}
              className="md:hidden p-2 -ml-1 text-slate-500 hover:text-navy-950 rounded-xl hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center shrink-0 cursor-pointer"
              aria-label="Back to channels"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
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
                  {activeProject?.name || (activeProjectId ? `Project #${activeProjectId.substring(0, 8)}` : 'Select a project channel')}
                </h3>

                {/* ONLINE / OFFLINE Status Badge */}
                {isOtherPartyOnline ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 animate-in fade-in">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                    <span>Online</span>
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    <span>Offline</span>
                  </span>
                )}
              </div>

              {/* Subtitle: Linked Accounts status */}
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5 min-w-0">
                <span className="font-medium text-slate-700 truncate max-w-[45%] shrink-0">
                  MD: <strong className="text-navy-950">{mdName}</strong>
                </span>
                <span className="text-slate-300 shrink-0">•</span>
                {hasAssignedInCharge ? (
                  <span className="font-medium text-slate-700 truncate min-w-0">
                    In-Charge:{' '}
                    <strong className="text-navy-950">
                      {assignedInChargeNames || 'Assigned Site Engineer'}
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
                        onClick={() => navigate(`/projects/${activeProjectId}`)}
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

          {/* Right Header: search + linked accounts chips (MD and their linked In-Charges) */}
          <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className={`p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl cursor-pointer transition-colors ${
              searchOpen ? 'bg-amber-100 text-amber-800' : 'text-slate-500 hover:text-navy-950 hover:bg-slate-100'
            }`}
            aria-label="Search messages"
            aria-pressed={searchOpen}
            title="Search messages, photos, documents and voice notes"
          >
            <Search className="w-[18px] h-[18px]" />
          </button>
          <div className="hidden 2xl:flex items-center gap-2">
            {/* Linked MD */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all ${
                presenceData?.linkedMD?.isOnline
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950 shadow-2xs'
                  : 'bg-slate-50 border-slate-200 text-slate-500'
              }`}
              title={`${mdName} (Managing Director) - ${
                presenceData?.linkedMD?.isOnline ? 'Active on BKR INFRA' : 'Offline'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  presenceData?.linkedMD?.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                }`}
              />
              <span className="truncate max-w-[120px]">
                {mdName}
                {presenceData?.linkedMD?.userId === currentUserId && ' (You)'}
              </span>
              <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 uppercase">
                MD
              </span>
            </div>

            {/* Linked In-Charges (strictly for this project) */}
            {hasAssignedInCharge ? (
              presenceData?.linkedInCharges && presenceData.linkedInCharges.length > 0 ? (
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
                      title={`${ic.name} (Site In-Charge) - ${ic.isOnline ? 'Active on BKR INFRA' : 'Offline'}`}
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
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-600"
                >
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                  <span className="truncate max-w-[120px]">
                    {assignedInChargeNames || 'In-Charge'}
                  </span>
                  <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-navy-100 text-navy-900 border border-navy-200 uppercase">
                    In-Charge
                  </span>
                </div>
              )
            ) : (
              <button
                onClick={() => {
                  if (user?.role === 'MD' || user?.role === 'OWNER') {
                    navigate(`/projects/${activeProjectId}`);
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
        </div>

        {searchOpen && activeProjectId && (
          <ChatSearchPanel
            projectId={activeProjectId}
            onClose={() => setSearchOpen(false)}
            onJump={(id) => jumpToMessage(id)}
          />
        )}
        {activeProjectId && (
          <PinnedBar
            projectId={activeProjectId}
            onJump={(id) => jumpToMessage(id)}
            onUnpin={(id) => pinMutation.mutate({ id, pinned: false })}
          />
        )}

        {/* Messages Feed */}
        <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 p-3 sm:p-6 overflow-y-auto space-y-4 bg-slate-50/30"
        >
          {/* Informational banner when project has no assigned in-charge */}
          {!hasAssignedInCharge && activeProject && (
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
                    BKR INFRA channels only show linked accounts (the MD and assigned Site In-Charges). Assign an engineer to enable direct two-way messaging.
                  </p>
                </div>
              </div>
              {(user?.role === 'MD' || user?.role === 'OWNER') && (
                <button
                  onClick={() => navigate(`/projects/${activeProjectId}`)}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-navy-950 font-bold text-xs rounded-xl flex-shrink-0 transition-colors shadow-2xs cursor-pointer"
                >
                  Assign In-Charge
                </button>
              )}
            </div>
          )}

          {/* Conditional message content / loading / error states */}
          {isLoadingMessages || (isFetchingMessages && !messagesData) ? (
            <LoadingSkeleton rows={5} height="h-16" />
          ) : isForbidden ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 animate-in fade-in">
              <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200 shadow-xs">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div className="max-w-md space-y-1">
                <h4 className="text-base font-extrabold text-navy-950">Access Denied (403 Forbidden)</h4>
                <p className="text-xs text-slate-500">
                  You do not have authorization to view this project channel. Access is restricted to the assigned Site In-Charge and Managing Director.
                </p>
              </div>
              {projects.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectProject(projects[0]._id || projects[0].id)}
                  className="rounded-xl cursor-pointer"
                >
                  Go to Authorized Channel
                </Button>
              )}
            </div>
          ) : isMessagesError ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 animate-in fade-in">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200 shadow-xs">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div className="max-w-md space-y-1">
                <h4 className="text-base font-extrabold text-navy-950">Failed to load conversation</h4>
                <p className="text-xs text-slate-500">
                  {(messagesError as any)?.message || 'A network error occurred while loading project messages.'}
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => refetchMessages()}
                className="flex items-center gap-1.5 rounded-xl cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shadow-xs">
                <MessageSquare className="w-7 h-7" />
              </div>
              <h4 className="text-sm font-bold text-navy-950">
                {!hasAssignedInCharge
                  ? 'No Site In-Charge Assigned Yet'
                  : 'Start the conversation'}
              </h4>
              <p className="text-xs text-slate-400 max-w-sm">
                {!hasAssignedInCharge
                  ? 'Assign an In-Charge to this project to share photos, walkthrough videos, payment requests, and daily report discussions.'
                  : `Coordinate operations between MD (${mdName}) and Site In-Charge (${assignedInChargeNames || 'Assigned In-Charge'}).`}
              </p>
              <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500 bg-slate-100/80 px-3 py-1.5 rounded-xl border border-slate-200">
                <UploadCloud className="w-4 h-4 text-amber-500" />
                <span className="hidden md:inline">Drag & drop photos, videos or PDFs anywhere to share</span>
                <span className="md:hidden">Tap the clip to share photos, videos or PDFs</span>
              </div>
            </div>
          ) : (
            messages.map((m: ProjectMessage, index: number) => {
              const id = (m._id || m.id) as string;
              const showDay = index === 0 || dayKey(messages[index - 1].createdAt) !== dayKey(m.createdAt);
              const isDeleted = Boolean(m.deletedAt);
              const isPinned = Boolean(m.pinnedAt);
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

              const modifiable = isMine && canStillModify(m);
              return (
                <React.Fragment key={id}>
                {showDay && <DayDivider iso={m.createdAt} />}
                <div
                  id={`msg-${id}`}
                  className={`group flex flex-col ${isMine ? 'items-end' : 'items-start'} space-y-1 scroll-mt-24`}
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
                    {isPinned && !isDeleted && (
                      <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold" title="Pinned message">
                        <Pin className="w-3 h-3" />
                        <span className="hidden sm:inline">Pinned</span>
                      </span>
                    )}
                    {!isDeleted && (
                      <>
                        <button
                          type="button"
                          onClick={() => startReply(m)}
                          className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md font-semibold text-slate-500 hover:text-amber-600 hover:bg-amber-50 cursor-pointer"
                          aria-label={`Reply to ${m.sender?.name || 'message'}`}
                        >
                          <CornerUpLeft className="w-3 h-3" />
                          <span>Reply</span>
                        </button>
                        <MessageActions
                          isMine={isMine}
                          isPinned={isPinned}
                          open={menuOpenId === id}
                          onOpenChange={(open) => setMenuOpenId(open ? id : null)}
                          onReply={() => startReply(m)}
                          onReact={(emoji) => reactMutation.mutate({ id, emoji })}
                          onCopy={m.content ? () => void copyText(m) : undefined}
                          onEdit={modifiable && m.content ? () => startEdit(m) : undefined}
                          onTogglePin={() => pinMutation.mutate({ id, pinned: !isPinned })}
                          onDelete={modifiable ? () => confirmDelete(m) : undefined}
                        />
                      </>
                    )}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`max-w-[85%] sm:max-w-xl min-w-0 rounded-2xl p-3 sm:p-3.5 shadow-xs space-y-2 break-words overflow-hidden transition-shadow ${
                      highlightId === id ? 'ring-4 ring-amber-400' : ''
                    } ${
                      isMine
                        ? 'bg-navy-950 text-white rounded-tr-none'
                        : 'bg-white text-navy-950 border border-slate-200/90 rounded-tl-none'
                    }`}
                  >
                    {isDeleted && (
                      <p className={`text-xs sm:text-sm italic flex items-center gap-1.5 ${isMine ? 'text-slate-300' : 'text-slate-400'}`}>
                        <Ban className="w-3.5 h-3.5" />
                        {isMine ? 'You deleted this message' : 'This message was deleted'}
                      </p>
                    )}

                    {/* Quoted original (reply-to) */}
                    {!isDeleted && m.replyTo && (
                      <ReplyQuote
                        original={typeof m.replyTo === 'object' ? m.replyTo : null}
                        dark={isMine}
                        onClick={() =>
                          jumpToMessage(
                            String(typeof m.replyTo === 'object' ? (m.replyTo as any)?._id : m.replyTo)
                          )
                        }
                      />
                    )}

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
                              if (m.contextType === 'PAYMENT_REQUEST') navigate(`/payments?id=${m.contextId}`);
                              if (m.contextType === 'DAILY_REPORT') navigate(`/reports/${m.contextId}`);
                              if (m.contextType === 'EXPENSE') navigate('/expenses');
                            }}
                            className="flex items-center gap-1 text-[10px] font-bold hover:underline flex-shrink-0 cursor-pointer"
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
                        {/* 0. VOICE NOTES */}
                        {m.attachments.filter(isAudioAttachment).map((att, idx) => (
                          <VoiceNotePlayer key={`a-${idx}`} attachment={att} dark={isMine} />
                        ))}
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
                                const mediaUrl = att.url;
                                return (
                                  <div
                                    key={idx}
                                    onClick={() => openLightbox(att.url, att.name, 'image')}
                                    className="group relative rounded-xl overflow-hidden bg-black/10 border border-slate-200/50 cursor-pointer aspect-video sm:aspect-square flex items-center justify-center"
                                  >
                                    <SecureImage
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
                                    {!!att.size && (
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
                                const mediaUrl = att.url;
                                return (
                                  <div
                                    key={idx}
                                    className="rounded-xl overflow-hidden bg-black border border-slate-700/50 shadow-md"
                                  >
                                    <SecureVideo
                                      controls
                                      preload="metadata"
                                      className="w-full max-h-72 object-contain bg-black"
                                      src={mediaUrl}
                                      controlsList="nodownload"
                                    >
                                      Your browser does not support the video tag.
                                    </SecureVideo>
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
                                        {!!att.size && (
                                          <span className="text-[10px] text-slate-400 font-mono">
                                            ({formatFileSize(att.size)})
                                          </span>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={(e) => handleDownload(e, att.url, att.name)}
                                        className="flex items-center gap-1 text-[10px] font-bold text-amber-400 hover:text-amber-300 transition-colors ml-2 flex-shrink-0 cursor-pointer"
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
                                  <button
                                    type="button"
                                    onClick={() => setViewerDoc(att)}
                                    className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                                    title="Preview document"
                                  >
                                    <span className="w-9 h-10 rounded-md bg-rose-50 text-rose-600 border border-rose-200 flex flex-col items-center justify-center shrink-0">
                                      <FileText className="w-4 h-4" />
                                      <span className="text-[8px] font-black">{fileTypeLabel(att)}</span>
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block font-bold truncate text-[11px]">{att.name}</span>
                                      <span className="block text-[10px] text-slate-400 font-mono truncate">
                                        {[fileTypeLabel(att), formatFileSize(att.size), formatDate(m.createdAt, 'dd MMM, hh:mm a')]
                                          .filter(Boolean)
                                          .join(' • ')}
                                      </span>
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => handleDownload(e, att.url, att.name)}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-amber-400 hover:text-amber-300 ml-2 cursor-pointer"
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
                      <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words">{m.content}</p>
                    )}

                    {/* MESSAGE FOOTER: TIME + SEEN STATUS */}
                    <div className="flex items-center justify-end gap-1 pt-1 text-[10px]">
                      {m.editedAt && !isDeleted && (
                        <span className="text-slate-400 italic" title={`Edited ${formatDate(m.editedAt, 'dd MMM, hh:mm a')}`}>
                          edited •
                        </span>
                      )}
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
                  {!isDeleted && (
                    <ReactionChips
                      message={m}
                      currentUserId={String(currentUserId || '')}
                      onToggle={(emoji) => reactMutation.mutate({ id, emoji })}
                    />
                  )}
                </div>
                </React.Fragment>
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
        {showJump && messages.length > 0 && <JumpToLatest count={newBelow} onClick={scrollToLatest} />}
        </div>

        <TypingIndicator names={typingNames} />
        {editTarget && <EditComposerBar target={editTarget} onCancel={cancelEdit} />}

        {replyTarget && <ReplyComposerBar target={replyTarget} onCancel={() => setReplyTarget(null)} />}

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
                    {att.type === 'image' && att.shared ? (
                      <SecureImage src={att.uploadedUrl} alt={att.name} className="w-full h-full object-cover" />
                    ) : att.type === 'image' ? (
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
                      {att.shared ? 'Project file' : formatFileSize(att.size)} •{' '}
                      {att.error ? (
                        <span className="text-rose-600 font-bold">Failed</span>
                      ) : att.uploading ? (
                        <span className="text-amber-600 font-bold">Uploading {att.progress}%</span>
                      ) : (
                        <span className="text-emerald-600 font-bold">Ready</span>
                      )}
                    </p>
                    {att.uploading && (
                      <div className="mt-1 h-1 w-full max-w-[130px] rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full bg-amber-500 transition-all" style={{ width: `${att.progress}%` }} />
                      </div>
                    )}
                    {/* Controls: Retry / Replace / Remove */}
                    <div className="flex items-center gap-2 mt-1">
                      {att.error && att.file && (
                        <button
                          type="button"
                          onClick={() => handleRetryStaged(att.id)}
                          className="text-[10px] font-bold text-rose-600 hover:text-rose-800 flex items-center gap-0.5 cursor-pointer"
                          title="Retry upload"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          <span>Retry</span>
                        </button>
                      )}
                      {att.file && (
                      <button
                        type="button"
                        onClick={() => handleTriggerReplace(att.id)}
                        className="text-[10px] font-semibold text-slate-500 hover:text-amber-600 flex items-center gap-0.5 cursor-pointer"
                        title="Replace file"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        <span>Replace</span>
                      </button>
                      )}
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
        <div className="p-3 sm:p-4 border-t border-slate-200 bg-white shrink-0">
          {recording ? (
            <VoiceRecorder
              onSend={(file, secs) => void sendVoiceNote(file, secs)}
              onCancel={() => setRecording(false)}
              onError={(msg) => showToast(msg, 'error')}
            />
          ) : (
          <form onSubmit={handleSend} className="flex items-end gap-2">
            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 min-w-[42px] min-h-[42px] flex items-center justify-center text-slate-500 hover:text-navy-900 hover:bg-slate-100 rounded-xl cursor-pointer transition-colors flex-shrink-0"
              title="Attach photos (JPG, PNG, WebP) or walkthrough videos (MP4, WebM)"
              aria-label="Attach media"
            >
              <Paperclip className="w-5 h-5 text-slate-600 hover:text-amber-600" />
            </button>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="p-2.5 min-w-[42px] min-h-[42px] flex items-center justify-center text-slate-500 hover:text-navy-900 hover:bg-slate-100 rounded-xl cursor-pointer transition-colors flex-shrink-0"
              title="Share a receipt, invoice or report photo from this project"
              aria-label="Share project file"
            >
              <FolderOpen className="w-5 h-5 text-slate-600" />
            </button>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              rows={1}
              aria-label={editTarget ? 'Edit message' : 'Message'}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (e.target.value) typingEmitter.ping();
                else typingEmitter.stop();
                // Auto-grow up to the max height
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
              }}
              onBlur={() => typingEmitter.stop()}
              onKeyDown={handleKeyDown}
              placeholder={editTarget ? 'Edit your message…' : sendingVoice ? 'Sending voice note…' : 'Type a message'}
              className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm text-navy-950 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none resize-none max-h-32 min-h-[42px] leading-relaxed bg-slate-50 focus:bg-white transition-colors"
            />

            {/* Send / Voice Button */}
            {showMic ? (
              <button
                type="button"
                onClick={() => setRecording(true)}
                disabled={sendingVoice || !activeProjectId}
                className="rounded-xl min-w-[44px] min-h-[42px] flex items-center justify-center bg-navy-950 hover:bg-navy-900 disabled:opacity-50 cursor-pointer"
                title="Record a voice note"
                aria-label="Record voice note"
              >
                {sendingVoice ? <Loader2 className="w-4 h-4 text-amber-400 animate-spin" /> : <Mic className="w-4 h-4 text-amber-400" />}
              </button>
            ) : (
            <Button
              size="md"
              variant="primary"
              type="submit"
              isLoading={sendMessageMutation.isPending || editMutation.isPending || isAnyStagedUploading}
              disabled={!canSend}
              className="rounded-xl min-w-[44px] min-h-[42px] cursor-pointer"
              title={editTarget ? 'Save edit' : 'Send message'}
              aria-label={editTarget ? 'Save edit' : 'Send message'}
            >
              {editTarget ? <Check className="w-4 h-4 text-amber-400" /> : <Send className="w-4 h-4 text-amber-400" />}
            </Button>
            )}
          </form>
          )}
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
            <SecureImage
              src={lightboxMedia.url}
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
      <DocumentViewer attachment={viewerDoc} onClose={() => setViewerDoc(null)} />
      <ShareProjectFileModal
        projectId={activeProjectId}
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        onPick={handleShareFile}
      />
    </div>
  );
};
