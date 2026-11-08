import React, { useState, useMemo } from 'react';
import { PushSettingsCard } from '../components/common/PushSettingsCard.js';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CheckCheck,
  CreditCard,
  MessageSquare,
  FileText,
  AlertCircle,
  Eye,
  MessageCircle,
  AlertTriangle,
  Search,
  Filter,
  ArrowRight,
  Clock,
  Calendar,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api/client.js';
import { Notification, NotificationType } from '../types/index.js';
import { formatDate } from '../utils/dates.js';
import { useAuth } from '../context/AuthContext.js';

export const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isMD, isOwner } = useAuth();
  const isMDOrOwner = isMD || isOwner;

  const [activeTab, setActiveTab] = useState<'ALL' | '24H' | 'UNREAD' | 'REPORTS' | 'PAYMENTS' | 'MESSAGES'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch full historical notifications
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['all-notifications-page'],
    queryFn: () =>
      api.get<{
        success: boolean;
        notifications: Notification[];
        unreadCount: number;
        totalHistoricalCount: number;
        totalHistoricalUnreadCount: number;
        serverTime: string;
      }>('/notifications?history=true&limit=150'),
    refetchInterval: 30000,
  });

  const notifications = data?.notifications || [];
  const serverTime = data?.serverTime ? new Date(data.serverTime).getTime() : Date.now();
  const twentyFourHoursAgo = serverTime - 24 * 60 * 60 * 1000;

  // Single mark read mutation
  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['all-notifications-page'] });
      queryClient.invalidateQueries({ queryKey: ['daily-reports-unread-summary'] });
    },
  });

  // Mark all read mutation
  const markAllReadMutation = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['all-notifications-page'] });
      queryClient.invalidateQueries({ queryKey: ['daily-reports-unread-summary'] });
    },
  });

  const handleNotificationClick = (n: Notification) => {
    const id = n._id || n.id;
    if (id && !n.isRead && isMDOrOwner) {
      markReadMutation.mutate(id);
    }

    if (n.relatedEntity === 'PAYMENT_REQUEST') {
      navigate(n.relatedId ? `/payments?id=${n.relatedId}` : '/payments');
    } else if (n.relatedEntity === 'PROJECT_MESSAGE') {
      const projId = n.project?._id || n.project?.code || n.relatedId;
      navigate(projId ? `/messages/${projId}` : '/messages');
    } else if (n.relatedEntity === 'DAILY_REPORT') {
      if (n.relatedId) {
        navigate(`/reports/${n.relatedId}`);
      } else {
        navigate('/reports');
      }
    } else if (n.relatedEntity === 'EXPENSE') {
      navigate(n.type === 'EXPENSE_SUBMITTED' ? '/approvals' : '/expenses');
    }
  };

  const getIconForType = (type: NotificationType) => {
    if (type.startsWith('PAYMENT_')) {
      return <CreditCard className="w-4 h-4 text-emerald-600" />;
    }
    if (type === 'PROJECT_MESSAGE') {
      return <MessageSquare className="w-4 h-4 text-sky-600" />;
    }
    if (type === 'DAILY_REPORT_VIEWED') {
      return <Eye className="w-4 h-4 text-sky-600" />;
    }
    if (type === 'DAILY_REPORT_CHANGES_REQUESTED' || type === 'DAILY_REPORT_REJECTED') {
      return <AlertTriangle className="w-4 h-4 text-amber-600" />;
    }
    if (type === 'DAILY_REPORT_COMMENT') {
      return <MessageCircle className="w-4 h-4 text-navy-700" />;
    }
    if (type.startsWith('DAILY_REPORT_')) {
      return <FileText className="w-4 h-4 text-amber-600" />;
    }
    return <AlertCircle className="w-4 h-4 text-slate-600" />;
  };

  const renderStatusBadge = (n: Notification) => {
    if (isMDOrOwner) {
      if (!n.isRead) {
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Unread
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          Read
        </span>
      );
    }

    // Site In-Charge role: descriptive status badge strictly WITHOUT orange dot or unread badge
    switch (n.type) {
      case 'DAILY_REPORT_VIEWED':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-md">
            Seen by MD
          </span>
        );
      case 'DAILY_REPORT_CHANGES_REQUESTED':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
            Changes requested
          </span>
        );
      case 'DAILY_REPORT_COMMENT':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-navy-800 bg-navy-50 border border-navy-200 px-2 py-0.5 rounded-md">
            MD comment
          </span>
        );
      case 'DAILY_REPORT_REJECTED':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
            Correction required
          </span>
        );
      case 'DAILY_REPORT_SUBMITTED':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
            Report submitted
          </span>
        );
      case 'PAYMENT_REQUEST_PAID':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
            Paid
          </span>
        );
      case 'PAYMENT_REQUEST_AUTHORIZED':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-md">
            Payment approved
          </span>
        );
      default:
        return null;
    }
  };

  // Filter list by selected tab & search keyword
  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      // Tab filter
      if (activeTab === '24H') {
        const notifTime = new Date(n.createdAt).getTime();
        if (notifTime < twentyFourHoursAgo) return false;
      } else if (activeTab === 'UNREAD') {
        if (n.isRead) return false;
      } else if (activeTab === 'REPORTS') {
        if (!n.type.startsWith('DAILY_REPORT_')) return false;
      } else if (activeTab === 'PAYMENTS') {
        if (!n.type.startsWith('PAYMENT_')) return false;
      } else if (activeTab === 'MESSAGES') {
        if (n.type !== 'PROJECT_MESSAGE') return false;
      }

      // Keyword search
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchesTitle = n.title?.toLowerCase().includes(term);
        const matchesMessage = n.message?.toLowerCase().includes(term);
        const matchesProject =
          n.project?.name?.toLowerCase().includes(term) ||
          n.project?.code?.toLowerCase().includes(term);
        const matchesSender = n.sender?.name?.toLowerCase().includes(term);
        if (!matchesTitle && !matchesMessage && !matchesProject && !matchesSender) {
          return false;
        }
      }

      return true;
    });
  }, [notifications, activeTab, searchTerm, twentyFourHoursAgo]);

  // Rolling 24-hour count & unread counts
  const recent24hCount = useMemo(() => {
    return notifications.filter((n) => new Date(n.createdAt).getTime() >= twentyFourHoursAgo).length;
  }, [notifications, twentyFourHoursAgo]);

  const unreadTotal = data?.totalHistoricalUnreadCount || 0;
  const recentUnread = data?.unreadCount || 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PushSettingsCard />

      {/* Page Header */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-navy-900 text-amber-500 flex items-center justify-center shadow-xs">
              <Bell className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-xl font-black text-navy-950">Notifications History</h1>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {notifications.length} total
                </span>
                {isMDOrOwner && recentUnread > 0 && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                    {recentUnread} new (24h)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isMDOrOwner
                  ? 'All site reports, verifications, and financial approval activities across your projects.'
                  : 'All notifications for your assigned projects, submitted reports, and MD review status.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              title="Refresh notifications"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isRefetching ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {isMDOrOwner && unreadTotal > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="px-3.5 py-2 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-navy-950 transition-colors shadow-2xs flex items-center gap-1.5"
              >
                <CheckCheck className="w-4 h-4" />
                <span>Mark all as read</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="-mx-3 px-3 sm:mx-0 sm:px-0 flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none scroll-smooth">
            <button
              onClick={() => setActiveTab('ALL')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
                activeTab === 'ALL'
                  ? 'bg-navy-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-navy-950'
              }`}
            >
              All Records ({notifications.length})
            </button>

            <button
              onClick={() => setActiveTab('24H')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap flex items-center gap-1 transition-colors ${
                activeTab === '24H'
                  ? 'bg-navy-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-navy-950'
              }`}
            >
              <Clock className="w-3 h-3 text-amber-500" />
              <span>Past 24 Hours ({recent24hCount})</span>
            </button>

            {isMDOrOwner && (
              <button
                onClick={() => setActiveTab('UNREAD')}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap flex items-center gap-1 transition-colors ${
                  activeTab === 'UNREAD'
                    ? 'bg-amber-500 text-navy-950'
                    : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                <span>Unread ({unreadTotal})</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('REPORTS')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
                activeTab === 'REPORTS'
                  ? 'bg-navy-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-navy-950'
              }`}
            >
              Daily Reports
            </button>

            <button
              onClick={() => setActiveTab('PAYMENTS')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
                activeTab === 'PAYMENTS'
                  ? 'bg-navy-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-navy-950'
              }`}
            >
              Payments
            </button>

            <button
              onClick={() => setActiveTab('MESSAGES')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
                activeTab === 'MESSAGES'
                  ? 'bg-navy-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-navy-950'
              }`}
            >
              Messages
            </button>
          </div>

          {/* Search Input */}
          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search notifications..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center text-xs text-slate-400">Loading notifications...</div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-16 text-center space-y-2">
            <Bell className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-700">No matching notifications</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchTerm
                ? 'Try adjusting your search terms or selecting another category filter.'
                : 'No notifications match this filter.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredNotifications.map((n) => {
              const id = n._id || n.id;
              const notifTime = new Date(n.createdAt).getTime();
              const isRecent24h = notifTime >= twentyFourHoursAgo;
              const isUnreadForMD = isMDOrOwner && !n.isRead;

              return (
                <div
                  key={id}
                  onClick={() => handleNotificationClick(n)}
                  className={`p-4 hover:bg-slate-50 cursor-pointer transition-colors flex items-start gap-4 ${
                    isUnreadForMD ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 shadow-2xs flex-shrink-0 mt-0.5">
                    {getIconForType(n.type)}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate">
                        {/* MD/Owner orange unread dot */}
                        {isUnreadForMD && (
                          <span
                            className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 animate-pulse"
                            title="Unread notification"
                          />
                        )}
                        <h2 className={`text-sm ${isUnreadForMD ? 'font-bold text-navy-950' : 'font-semibold text-slate-800'} truncate`}>
                          {n.title}
                        </h2>
                        {isRecent24h && (
                          <span className="hidden sm:inline-flex items-center text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            Recent 24h
                          </span>
                        )}
                      </div>

                      <span className="text-[11px] text-slate-400 whitespace-nowrap flex-shrink-0">
                        {formatDate(n.createdAt, 'MMM d, yyyy • h:mm a')}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>

                    <div className="flex items-center justify-between gap-3 pt-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {n.project && (
                          <span className="font-mono text-[10px] font-bold text-navy-800 bg-navy-50 border border-navy-200 px-2 py-0.5 rounded">
                            {n.project.code} {n.project.name ? `• ${n.project.name}` : ''}
                          </span>
                        )}
                        {n.sender?.name && (
                          <span className="text-xs text-slate-500">
                            By <span className="font-medium text-slate-700">{n.sender.name}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {renderStatusBadge(n)}
                        <span className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1 group">
                          View details <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
