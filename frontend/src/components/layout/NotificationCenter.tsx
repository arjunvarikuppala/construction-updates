import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CheckCheck,
  CreditCard,
  MessageSquare,
  FileText,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Notification, NotificationType } from '../../types/index.js';
import { formatDate } from '../../utils/dates.js';

export const NotificationCenter: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch notifications
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{
        success: boolean;
        notifications: Notification[];
        unreadCount: number;
      }>('/notifications'),
    refetchInterval: 15000,
  });

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  // Mark single as read mutation
  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Mark all as read mutation
  const markAllReadMutation = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
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

  const handleNotificationClick = (notification: Notification) => {
    const id = notification._id || notification.id;
    if (id && !notification.isRead) {
      markReadMutation.mutate(id);
    }
    setIsOpen(false);

    // Navigate to related target
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
    if (type.startsWith('DAILY_REPORT_')) {
      return <FileText className="w-4 h-4 text-amber-600" />;
    }
    return <AlertCircle className="w-4 h-4 text-slate-600" />;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-xl text-slate-600 hover:text-navy-900 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        title="Notifications"
        aria-label="View notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-black text-white bg-rose-500 rounded-full border-2 border-white animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200/90 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-navy-950">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="flex items-center gap-1 text-xs font-semibold text-navy-800 hover:text-amber-600 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-slate-400">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <Bell className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-semibold text-slate-600">No notifications yet</p>
                <p className="text-[11px] text-slate-400">
                  Updates on payments, messages, and daily reports will appear here.
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                const id = n._id || n.id;
                return (
                  <div
                    key={id}
                    onClick={() => handleNotificationClick(n)}
                    className={`p-3.5 hover:bg-slate-50 cursor-pointer transition-colors flex items-start gap-3 ${
                      !n.isRead ? 'bg-amber-50/40' : ''
                    }`}
                  >
                    <div className="p-2 rounded-xl bg-white border border-slate-200/70 shadow-xs flex-shrink-0 mt-0.5">
                      {getIconForType(n.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className={`text-xs ${!n.isRead ? 'font-bold text-navy-950' : 'font-medium text-slate-700'} truncate`}>
                          {n.title}
                        </p>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                          {formatDate(n.createdAt, 'hh:mm a')}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 line-clamp-2 mt-0.5 leading-relaxed">
                        {n.message}
                      </p>
                      {n.project && (
                        <span className="inline-block mt-1 font-mono text-[9px] font-bold text-navy-800 bg-navy-50 border border-navy-200/80 px-1.5 py-0.5 rounded">
                          {n.project.code}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
