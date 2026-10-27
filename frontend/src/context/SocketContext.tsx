import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext.js';
import { useToast } from './ToastContext.js';
import { useQueryClient } from '@tanstack/react-query';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinProject: (projectId: string) => void;
  leaveProject: (projectId: string) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  joinProject: () => {},
  leaveProject: () => {},
});

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuth();
  const { info: toastInfo } = useToast();
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!token || !user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    // Connect to same origin host using configured Vite socket.io proxy
    const socketInstance: Socket = io({
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 15,
      reconnectionDelay: 1500,
    });

    socketInstance.on('connect', () => {
      setIsConnected(true);
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
    });

    // Real-time notification updates
    socketInstance.on('notification:new', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    });

    // Real-time project message updates
    socketInstance.on('message:new', (message) => {
      if (message?.project) {
        queryClient.invalidateQueries({ queryKey: ['project-messages', message.project] });
        queryClient.invalidateQueries({ queryKey: ['unread-messages-count'] });
      }
    });

    // Real-time message seen updates (blue checkmarks)
    socketInstance.on('messages:seen', (data) => {
      if (data?.projectId) {
        queryClient.invalidateQueries({ queryKey: ['project-messages', data.projectId] });
        queryClient.invalidateQueries({ queryKey: ['unread-messages-count'] });
      }
    });

    // Real-time presence updates (online indicators)
    socketInstance.on('presence:project_users', (data) => {
      if (data?.projectId) {
        queryClient.invalidateQueries({ queryKey: ['project-presence', data.projectId] });
      }
    });

    socketInstance.on('presence:change', () => {
      queryClient.invalidateQueries({ queryKey: ['project-presence'] });
    });

    // DYNAMIC INSTANT REPORT READ RECEIPT UPDATES
    socketInstance.on('report:viewed', (data: any) => {
      if (data?.reportId) {
        const viewedAt = data.viewedAt || new Date().toISOString();
        const viewerName = data.viewerName || 'Managing Director';

        // 1. Instantly update all daily-reports in cache with ZERO network delay
        queryClient.setQueriesData(
          { queryKey: ['daily-reports'] },
          (oldData: any) => {
            if (!oldData || !Array.isArray(oldData.reports)) return oldData;
            return {
              ...oldData,
              reports: oldData.reports.map((r: any) => {
                const rId = r._id || r.id;
                if (String(rId) === String(data.reportId)) {
                  return {
                    ...r,
                    readReceipt: {
                      status: 'SEEN_BY_MD',
                      lastViewedAt: viewedAt,
                      lastViewedByName: viewerName,
                      lastViewedById: data.viewerId,
                      isCurrentRevisionSeen: true,
                    },
                  };
                }
                return r;
              }),
            };
          }
        );

        // 2. Also update detail view in cache if currently open
        queryClient.setQueryData(
          ['daily-report-detail', data.reportId],
          (oldData: any) => {
            if (!oldData || !oldData.report) return oldData;
            return {
              ...oldData,
              report: {
                ...oldData.report,
                readReceipt: {
                  status: 'SEEN_BY_MD',
                  lastViewedAt: viewedAt,
                  lastViewedByName: viewerName,
                  lastViewedById: data.viewerId,
                  isCurrentRevisionSeen: true,
                },
              },
            };
          }
        );

        // 3. Notify Site In-Charge dynamically if they are logged in
        const isInCharge = user?.role === 'SITE_INCHARGE' || user?.role === 'IN_CHARGE';
        if (isInCharge) {
          toastInfo(`👁️ Daily report viewed by MD (${viewerName})`);
        }
      }

      // Background re-sync with server
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      queryClient.invalidateQueries({ queryKey: ['in-charge-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    });

    // Real-time payment status updates
    socketInstance.on('payment:status_changed', () => {
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['payment-stats'] });
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, [token, user?.id, toastInfo, queryClient, user?.role]);

  const joinProject = useCallback(
    (projectId: string) => {
      if (socket && isConnected && projectId) {
        socket.emit('project:join', projectId);
      }
    },
    [socket, isConnected]
  );

  const leaveProject = useCallback(
    (projectId: string) => {
      if (socket && isConnected && projectId) {
        socket.emit('project:leave', projectId);
      }
    },
    [socket, isConnected]
  );

  const value = useMemo(
    () => ({
      socket,
      isConnected,
      joinProject,
      leaveProject,
    }),
    [socket, isConnected, joinProject, leaveProject]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export const useSocket = () => useContext(SocketContext);
