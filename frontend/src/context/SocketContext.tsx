import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
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
  const activeProjectIdRef = useRef<string>('');

  useEffect(() => {
    if (!token || !user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    // ---------------------------------------------------------------------------
    // Socket.IO connection target resolution
    //
    // Development (Vite dev server):
    //   Neither VITE_SOCKET_URL nor VITE_API_URL is set → socketTarget = undefined
    //   socket.io-client connects to the same origin, which Vite proxies via
    //   the /socket.io proxy entry in vite.config.ts (ws: true).
    //
    // Production (Vercel + Render):
    //   VITE_SOCKET_URL (preferred) or VITE_API_URL must be set to the full
    //   Render backend URL, e.g. 'https://sitetrack-api.onrender.com'
    //   Vercel cannot proxy WebSocket upgrade requests, so the client MUST
    //   connect directly to the Render backend.
    // ---------------------------------------------------------------------------
    const socketTarget =
      (import.meta.env.VITE_SOCKET_URL as string | undefined)?.replace(/\/$/, '') ||
      (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
      undefined;

    // Connect to same origin host using configured Vite socket.io proxy
    const socketInstance: Socket = io(socketTarget as any, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
      reconnectionDelay: 1200,
    });

    socketInstance.on('connect', () => {
      setIsConnected(true);
      // Auto-rejoin active project channel on reconnect
      if (activeProjectIdRef.current) {
        socketInstance.emit('project:join', activeProjectIdRef.current);
        queryClient.invalidateQueries({ queryKey: ['project-messages', activeProjectIdRef.current] });
        queryClient.invalidateQueries({ queryKey: ['project-presence', activeProjectIdRef.current] });
      }
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
    });

    // Real-time notification updates
    socketInstance.on('notification:new', (notification) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      // Popup + sound while the website is open (see LiveNotifications)
      window.dispatchEvent(new CustomEvent('bkr:notification', { detail: notification }));
    });

    // Real-time project message updates (with message deduplication)
    socketInstance.on('message:new', (message) => {
      if (message?.project) {
        const projId =
          typeof message.project === 'object' && message.project !== null
            ? String((message.project as any)._id || (message.project as any).id)
            : String(message.project);

        queryClient.setQueriesData(
          { queryKey: ['project-messages', projId] },
          (old: any) => {
            if (!old || !Array.isArray(old.messages)) return old;
            const msgId = String(message._id || message.id);
            const exists = old.messages.some((m: any) => String(m._id || m.id) === msgId);
            if (exists) return old;
            return {
              ...old,
              messages: [...old.messages, message],
              count: (old.count || old.messages.length) + 1,
            };
          }
        );

        queryClient.invalidateQueries({ queryKey: ['unread-messages-count'] });
      }
    });

    // Real-time message seen updates (blue checkmarks)
    socketInstance.on('messages:seen', (data) => {
      if (data?.projectId) {
        const pId = String(data.projectId);
        queryClient.invalidateQueries({ queryKey: ['project-messages', pId] });
        queryClient.invalidateQueries({ queryKey: ['unread-messages-count'] });
      }
    });

    // Real-time presence updates (online indicators)
    socketInstance.on('presence:project_users', (data) => {
      if (data?.projectId) {
        const pId = String(data.projectId);
        queryClient.invalidateQueries({ queryKey: ['project-presence', pId] });
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
      queryClient.invalidateQueries({ queryKey: ['daily-reports-unread-summary'] });
    });

    socketInstance.on('daily-report:new', () => {
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      queryClient.invalidateQueries({ queryKey: ['daily-reports-unread-summary'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    });

    socketInstance.on('daily-report:updated', () => {
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      queryClient.invalidateQueries({ queryKey: ['daily-reports-unread-summary'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    });

    socketInstance.on('daily-report:viewed', () => {
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      queryClient.invalidateQueries({ queryKey: ['daily-reports-unread-summary'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    });

    // Real-time payment status updates
    const refreshPayments = (data?: { paymentId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      queryClient.invalidateQueries({ queryKey: ['payment-summary'] });
      if (data?.paymentId) queryClient.invalidateQueries({ queryKey: ['payment-request', String(data.paymentId)] });
    };
    socketInstance.on('payment:status_changed', refreshPayments);
    socketInstance.on('payment:updated', refreshPayments);
    socketInstance.on('payment:new', refreshPayments);

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, [token, user?.id, toastInfo, queryClient, user?.role]);

  const joinProject = useCallback(
    (projectId: string) => {
      activeProjectIdRef.current = projectId;
      if (socket && isConnected && projectId) {
        socket.emit('project:join', projectId);
      }
    },
    [socket, isConnected]
  );

  const leaveProject = useCallback(
    (projectId: string) => {
      if (activeProjectIdRef.current === projectId) {
        activeProjectIdRef.current = '';
      }
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
