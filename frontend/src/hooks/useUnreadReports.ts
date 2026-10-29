import { useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.js';
import { useSocket } from '../context/SocketContext.js';
import { api } from '../api/client.js';

export interface UnreadReportsSummaryResponse {
  success: boolean;
  totalUnread: number;
  unreadByProject: Record<string, number>;
  unreadReportIds: string[];
}

export function useUnreadReports() {
  const { user, isOwner } = useAuth();
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<UnreadReportsSummaryResponse>({
    queryKey: ['unread-daily-reports'],
    queryFn: () => api.get<UnreadReportsSummaryResponse>('/daily-reports/unread-summary'),
    enabled: Boolean(user),
    refetchInterval: 15000,
    staleTime: 5000,
  });

  // Listen for socket events to immediately invalidate and refresh unread indicators
  useEffect(() => {
    if (!socket) return;

    const handleReportEvent = () => {
      queryClient.invalidateQueries({ queryKey: ['unread-daily-reports'] });
    };

    socket.on('daily-report:new', handleReportEvent);
    socket.on('daily-report:updated', handleReportEvent);
    socket.on('daily-report:viewed', handleReportEvent);
    socket.on('report:viewed', handleReportEvent);

    return () => {
      socket.off('daily-report:new', handleReportEvent);
      socket.off('daily-report:updated', handleReportEvent);
      socket.off('daily-report:viewed', handleReportEvent);
      socket.off('report:viewed', handleReportEvent);
    };
  }, [socket, queryClient]);

  const totalUnread = data?.totalUnread || 0;
  const unreadByProject = data?.unreadByProject || {};
  const unreadReportIds = useMemo(() => new Set(data?.unreadReportIds || []), [data?.unreadReportIds]);

  const isProjectUnread = useCallback(
    (projectId?: string | null): boolean => {
      if (!projectId) return false;
      return (unreadByProject[projectId] || 0) > 0;
    },
    [unreadByProject]
  );

  const getProjectUnreadCount = useCallback(
    (projectId?: string | null): number => {
      if (!projectId) return 0;
      return unreadByProject[projectId] || 0;
    },
    [unreadByProject]
  );

  const isReportUnread = useCallback(
    (reportId?: string | null): boolean => {
      if (!reportId) return false;
      return unreadReportIds.has(reportId);
    },
    [unreadReportIds]
  );

  const markReportAsRead = useCallback(
    async (reportId: string): Promise<void> => {
      if (!reportId) return;
      try {
        await api.post(`/daily-reports/${reportId}/view`, {});
        queryClient.invalidateQueries({ queryKey: ['unread-daily-reports'] });
      } catch (err) {
        console.error('Failed to mark report as read:', err);
      }
    },
    [queryClient]
  );

  return {
    totalUnread,
    unreadByProject,
    unreadReportIds,
    isProjectUnread,
    getProjectUnreadCount,
    isReportUnread,
    markReportAsRead,
    refetchUnread: refetch,
    isLoading,
  };
}
