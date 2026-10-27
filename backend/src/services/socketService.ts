import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { User } from '../models/User.js';

interface AuthenticatedSocket extends Socket {
  user?: {
    userId: string;
    role: string;
    email: string;
    name: string;
  };
}

export interface OnlineUserInfo {
  userId: string;
  name: string;
  role: string;
  isOnline: boolean;
  isInChannel: boolean;
  lastSeen?: string;
}

let io: SocketIOServer | null = null;

// Map: userId -> presence tracking
const activeUsers = new Map<
  string,
  {
    userId: string;
    name: string;
    role: string;
    activeProjects: Set<string>;
    socketIds: Set<string>;
    lastSeen: Date;
  }
>();

export function isUserOnline(userId: string): boolean {
  const u = activeUsers.get(String(userId));
  return Boolean(u && u.socketIds.size > 0);
}

export function isUserInProject(userId: string, projectId: string): boolean {
  const u = activeUsers.get(String(userId));
  return Boolean(u && u.socketIds.size > 0 && u.activeProjects.has(String(projectId)));
}

export function getProjectOnlineUsers(projectId: string): OnlineUserInfo[] {
  const list: OnlineUserInfo[] = [];
  activeUsers.forEach((u) => {
    if (u.socketIds.size > 0) {
      list.push({
        userId: u.userId,
        name: u.name,
        role: u.role,
        isOnline: true,
        isInChannel: u.activeProjects.has(String(projectId)),
        lastSeen: u.lastSeen.toISOString(),
      });
    }
  });
  return list;
}

export function getAllOnlineUserIds(): string[] {
  const ids: string[] = [];
  activeUsers.forEach((u, id) => {
    if (u.socketIds.size > 0) ids.push(id);
  });
  return ids;
}

export function initSocketService(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Authentication Middleware for Socket.IO
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const rawToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
        (socket.handshake.query?.token as string);

      if (!rawToken) {
        return next(new Error('Authentication required for real-time connection.'));
      }

      const secret = process.env.JWT_SECRET || 'sitetrack_jwt_secret_key_2026';
      const decoded = jwt.verify(rawToken, secret) as any;

      const user = await User.findById(decoded.userId).select('name email role isActive');
      if (!user || !user.isActive) {
        return next(new Error('User not found or inactive.'));
      }

      socket.user = {
        userId: user._id.toString(),
        role: user.role,
        email: user.email,
        name: user.name,
      };

      next();
    } catch (err: any) {
      return next(new Error(`Socket authentication failed: ${err.message}`));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user;
    if (!user) return;

    // Track active connection
    let presence = activeUsers.get(user.userId);
    if (!presence) {
      presence = {
        userId: user.userId,
        name: user.name,
        role: user.role,
        activeProjects: new Set<string>(),
        socketIds: new Set<string>(),
        lastSeen: new Date(),
      };
      activeUsers.set(user.userId, presence);
    }
    presence.socketIds.add(socket.id);
    presence.lastSeen = new Date();

    // Broadcast user online to all connected clients
    io?.emit('presence:change', {
      userId: user.userId,
      name: user.name,
      role: user.role,
      isOnline: true,
    });

    // Join personal user notification room
    socket.join(`user:${user.userId}`);

    // If MD, join executive room
    if (user.role === 'MD' || user.role === 'OWNER') {
      socket.join('role:MD');
    }

    // Helper for joining a project channel
    const handleJoinProject = async (projectId: string, callback?: (res: any) => void) => {
      try {
        if (!projectId) {
          if (callback) callback({ success: false, message: 'Project ID required' });
          return;
        }

        const access = await verifyUserProjectAccess(projectId, user.userId, user.role);
        if (!access.allowed) {
          if (callback) callback({ success: false, message: 'Forbidden. You are not assigned to this project.' });
          return;
        }

        socket.join(`project:${projectId}`);
        presence?.activeProjects.add(projectId);

        // Broadcast updated project presence
        emitToProject(projectId, 'presence:project_users', {
          projectId,
          onlineUsers: getProjectOnlineUsers(projectId),
        });

        if (callback) callback({ success: true, room: `project:${projectId}` });
      } catch (err: any) {
        if (callback) callback({ success: false, message: err.message });
      }
    };

    // Helper for leaving a project channel
    const handleLeaveProject = (projectId: string) => {
      socket.leave(`project:${projectId}`);
      presence?.activeProjects.delete(projectId);

      emitToProject(projectId, 'presence:project_users', {
        projectId,
        onlineUsers: getProjectOnlineUsers(projectId),
      });
    };

    // Listen for both naming styles
    socket.on('project:join', handleJoinProject);
    socket.on('join:project', handleJoinProject);

    socket.on('project:leave', handleLeaveProject);
    socket.on('leave:project', handleLeaveProject);

    // Client marks messages as seen
    socket.on('messages:mark_seen', (data: { projectId: string; messageIds?: string[] }) => {
      if (data?.projectId) {
        emitToProject(data.projectId, 'messages:seen', {
          projectId: data.projectId,
          readerId: user.userId,
          readerName: user.name,
          readAt: new Date().toISOString(),
        });
      }
    });

    socket.on('disconnect', () => {
      if (presence) {
        presence.socketIds.delete(socket.id);
        presence.lastSeen = new Date();

        if (presence.socketIds.size === 0) {
          // Notify project rooms
          presence.activeProjects.forEach((projId) => {
            emitToProject(projId, 'presence:project_users', {
              projectId: projId,
              onlineUsers: getProjectOnlineUsers(projId),
            });
          });

          // Broadcast user offline
          io?.emit('presence:change', {
            userId: user.userId,
            name: user.name,
            role: user.role,
            isOnline: false,
            lastSeen: presence.lastSeen.toISOString(),
          });
        }
      }
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function emitToProject(projectId: string, event: string, data: any): void {
  if (io) {
    io.to(`project:${projectId}`).emit(event, data);
  }
}

export function emitToUser(userId: string, event: string, data: any): void {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
}

export function emitToMDs(event: string, data: any): void {
  if (io) {
    io.to('role:MD').emit(event, data);
  }
}
