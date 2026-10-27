import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext.js';
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

    // Connect to same origin host
    const socketInstance: Socket = io({
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socketInstance.on('connect', () => {
      setIsConnected(true);
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
    });

    // Real-time notification updates
    socketInstance.on('notification:new', (notification) => {
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

    // Real-time report read receipt updates
    socketInstance.on('report:viewed', (data) => {
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      if (data?.reportId) {
        queryClient.invalidateQueries({ queryKey: ['daily-report-detail', data.reportId] });
      }
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
  }, [token, user?.id]);

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
