import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  ArrowRight,
  Clock,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Notification, NotificationType } from '../../types/index.js';
import { formatDate } from '../../utils/dates.js';
import { useAuth } from '../../context/AuthContext.js';

export const NotificationCenter: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isMD, isOwner } = useAuth();
  const isMDOrOwner = isMD || isOwner;

  // Track dynamic time tick for client-side window filtering
  const [clientNow, setClientNow] = useState(Date.now());

  useEffect(() => {
    // 15s interval tick to ensure boundary aging works accurately without full page reloads
    const interval = setInterval(() => {
      setClientNow(Date.now());
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Fetch recent notifications (rolling 24-hour window from server)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{
        success: boolean;
        notifications: Notification[];
        unreadCount: number;
        windowUnreadCount?: number;
        serverTime?: string;
      }>('/notifications?timeWindow=24h&limit=50'),
    refetchInterval: 20000,
  });

  const twentyFourHoursAgo = clientNow - 24 * 60 * 60 * 1000;

  // Filter list to notifications created strictly within the rolling 24 hours
  const notifications = useMemo(() => {
    const rawList = data?.notifications || [];
    return rawList.filter((n) => {
      const createdAtMs = new Date(n.createdAt).getTime();
      return createdAtMs >= twentyFourHoursAgo;
    });
  }, [data?.notifications, twentyFourHoursAgo]);

  // Dynamic unread count in rolling 24h window
  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.isRead).length;
  }, [notifications]);

  // Exact boundary timer: triggers instant recalculation the second the oldest active notification turns 24h old
  useEffect(() => {
    if (notifications.length === 0) return;

    let oldestTime = Infinity;
    for (const n of notifications) {
      const t = new Date(n.createdAt).getTime();
      if (t < oldestTime) {
        oldestTime = t;
      }
    }

    if (oldestTime !== Infinity) {
      const expiryTimestamp = oldestTime + 24 * 60 * 60 * 1000;
      const msUntilExpiry = expiryTimestamp - Date.now();

      if (msUntilExpiry > 0 && msUntilExpiry <= 24 * 60 * 60 * 1000) {
        const timer = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
        }, msUntilExpiry + 500);

        return () => clearTimeout(timer);
      }
    }
  }, [notifications, queryClient]);

  // Mark single notification as read
  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['all-notifications-page'] });
      queryClient.invalidateQueries({ queryKey: ['daily-reports-unread-summary'] });
    },
  });

  // Mark all notifications as read
  const markAllReadMutation = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['all-notifications-page'] });
      queryClient.invalidateQueries({ queryKey: ['daily-reports-unread-summary'] });
    },
  });

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const toggleDropdown = () => {
    if (!isOpen) {
      refetch();
    }
    setIsOpen(!isOpen);
  };

  const handleNotificationClick = (notification: Notification) => {
    const id = notification._id || notification.id;
    if (id && !notification.isRead && isMDOrOwner) {
      markReadMutation.mutate(id);
    }
    setIsOpen(false);

    // Navigate to related entity
    if (notification.relatedEntity === 'PAYMENT_REQUEST') {
      navigate('/payments');
    } else if (notification.relatedEntity === 'PROJECT_MESSAGE') {
      const projId = notification.project?._id || notification.project?.code || notification.relatedId;
      navigate(projId ? `/messages/${projId}` : '/messages');
    } else if (notification.relatedEntity === 'DAILY_REPORT') {
      if (notification.relatedId) {
        navigate(`/reports/${notification.relatedId}`);
      } else {
        navigate('/reports');
      }
    } else if (notification.relatedEntity === 'EXPENSE') {
      navigate('/expenses');
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

  const renderStatusBadge = (notification: Notification) => {
    if (isMDOrOwner) {
      if (!notification.isRead) {
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Unread
          </span>
        );
      }
      return null;
    }

    // Site In-Charge role: functional clear status text WITHOUT any orange unread dot or badge
    switch (notification.type) {
      case 'DAILY_REPORT_VIEWED':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
            Seen by MD
          </span>
        );
      case 'DAILY_REPORT_CHANGES_REQUESTED':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
            Changes requested
          </span>
        );
      case 'DAILY_REPORT_COMMENT':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
            MD comment
          </span>
        );
      case 'DAILY_REPORT_REJECTED':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
            Correction required
          </span>
        );
      case 'DAILY_REPORT_SUBMITTED':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
            Report submitted
          </span>
        );
      case 'PAYMENT_REQUEST_AUTHORIZED':
      case 'PAYMENT_REQUEST_PAID':
        return (
          <span className="inline-flex items-center text-[10px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
            Payment approved
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        onClick={toggleDropdown}
        className="relative p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-600 hover:text-navy-900 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        title="Notifications"
        aria-label="View notifications"
      >
        <Bell className="w-5 h-5" />

        {/* MD / Owner role: Orange unread dot and unread notification count badge */}
        {/* Site In-Charge role: strictly NO orange unread dot and NO unread badge */}
        {isMDOrOwner && unreadCount > 0 && (
          <span
            className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-black text-white bg-amber-500 rounded-full border-2 border-white animate-pulse shadow-2xs"
            title={`${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`}
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="fixed left-2 right-2 top-[calc(4.25rem+env(safe-area-inset-top,0px))] max-h-[calc(100dvh-5.5rem)] flex flex-col sm:max-h-none sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[420px] bg-white rounded-2xl shadow-2xl border border-slate-200/90 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-navy-950">Notifications</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-200/70 px-1.5 py-0.5 rounded">
                <Clock className="w-3 h-3 text-amber-600" />
                Past 24h
              </span>
              {/* Only show unread counter badge for MD/Owner */}
              {isMDOrOwner && unreadCount > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                  {unreadCount} unread
                </span>
              )}
            </div>

            {/* "Mark all as read" only where meaningful (MD/Owner) */}
            {isMDOrOwner && unreadCount > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="flex items-center gap-1 text-xs font-semibold text-navy-800 hover:text-amber-600 transition-colors"
                title="Mark all notifications as read"
              >
                <CheckCheck className="w-3.5 h-3.5 text-amber-600" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[58dvh] sm:max-h-[380px] overflow-y-auto flex-1 overscroll-contain divide-y divide-slate-100">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-slate-400">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <Bell className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-semibold text-slate-600">No notifications in the last 24 hours</p>
                <p className="text-[11px] text-slate-400">
                  New daily reports, site verifications, and approvals will appear here dynamically.
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                const id = n._id || n.id;
                const isUnreadForMD = isMDOrOwner && !n.isRead;

                return (
                  <div
                    key={id}
                    onClick={() => handleNotificationClick(n)}
                    className={`p-3.5 hover:bg-slate-50 cursor-pointer transition-colors flex items-start gap-3 group ${
                      isUnreadForMD ? 'bg-amber-50/40' : 'bg-white'
                    }`}
                  >
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/70 shadow-2xs flex-shrink-0 mt-0.5 group-hover:bg-white transition-colors">
                      {getIconForType(n.type)}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 truncate">
                          {/* Orange unread dot beside notification title for MD/Owner only */}
                          {isUnreadForMD && (
                            <span
                              className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 animate-pulse"
                              title="Unread notification"
                            />
                          )}
                          <p className={`text-xs ${isUnreadForMD ? 'font-bold text-navy-950' : 'font-semibold text-slate-800'} truncate`}>
                            {n.title}
                          </p>
                        </div>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">
                          {formatDate(n.createdAt, 'hh:mm a')}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                        {n.message}
                      </p>

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          {n.project && (
                            <span className="font-mono text-[9px] font-bold text-navy-800 bg-navy-50 border border-navy-200/80 px-1.5 py-0.5 rounded truncate">
                              {n.project.code} {n.project.name ? `• ${n.project.name}` : ''}
                            </span>
                          )}
                          {n.sender?.name && (
                            <span className="text-[10px] text-slate-400 truncate">
                              By {n.sender.name}
                            </span>
                          )}
                        </div>

                        {renderStatusBadge(n)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer with "View All Notifications" action */}
          <div className="p-2.5 bg-slate-50/90 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/notifications');
              }}
              className="w-full text-center py-1.5 px-3 rounded-lg text-xs font-bold text-navy-900 hover:text-amber-700 hover:bg-amber-50/50 transition-colors flex items-center justify-center gap-1.5"
            >
              <span>View All Historical Notifications</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
