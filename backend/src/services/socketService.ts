import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { verifyUserProjectAccess, getJwtSecret } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { getProjectMDIds } from './tenantService.js';

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
  if (!u || u.socketIds.size === 0) return false;
  const pStr = String(projectId).toLowerCase();
  for (const active of u.activeProjects) {
    if (active.toLowerCase() === pStr) return true;
  }
  return false;
}

export function getProjectOnlineUsers(projectId: string): OnlineUserInfo[] {
  const list: OnlineUserInfo[] = [];
  const target = String(projectId).toLowerCase();
  activeUsers.forEach((u) => {
    if (u.socketIds.size > 0) {
      let inProject = false;
      for (const p of u.activeProjects) {
        if (p.toLowerCase() === target) {
          inProject = true;
          break;
        }
      }
      if (inProject) {
        list.push({
          userId: u.userId,
          name: u.name,
          role: u.role,
          isOnline: true,
          isInChannel: true,
          lastSeen: u.lastSeen.toISOString(),
        });
      }
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

export function initSocketService(httpServer: HttpServer, allowedOrigins?: string[] | string): SocketIOServer {
  // Resolve CORS origin for Socket.IO — must mirror the Express CORS config so
  // that the WebSocket upgrade handshake is subject to the same origin policy.
  const corsOrigin =
    !allowedOrigins || allowedOrigins === '*'
      ? '*'
      : (requestOrigin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          if (!requestOrigin) return cb(null, true);
          const list = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
          if (list.includes(requestOrigin)) return cb(null, true);
          cb(new Error(`Socket.IO CORS: origin '${requestOrigin}' is not allowed.`));
        };

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Authentication Middleware for Socket.IO
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      // Token via handshake auth payload or Authorization header only (never the URL query).
      const rawToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

      if (!rawToken) {
        return next(new Error('Authentication required for real-time connection.'));
      }

      const secret = getJwtSecret();
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
      return next(new Error('Socket authentication failed.'));
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

    // Presence is shared only through project rooms (see presence:project_users),
    // plus the user's own room — never globally across companies.
    io?.to(`user:${user.userId}`).emit('presence:change', {
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

    // Join/leave both await an access check, so a quick leave → join (channel
    // switch, React remount) could finish out of order and drop the socket from
    // the room. Each request gets a sequence number; only the latest one wins.
    let roomSeq = 0;
    const latestRoomOp = new Map<string, number>();
    const markRoomOp = (projectId: string) => {
      roomSeq += 1;
      latestRoomOp.set(String(projectId), roomSeq);
      return roomSeq;
    };
    const isLatestRoomOp = (projectId: string, seq: number) => latestRoomOp.get(String(projectId)) === seq;

    // Helper for joining a project channel
    const handleJoinProject = async (projectId: string, callback?: (res: any) => void) => {
      try {
        if (!projectId) {
          if (callback) callback({ success: false, message: 'Project ID required' });
          return;
        }

        const seq = markRoomOp(projectId);
        const access = await verifyUserProjectAccess(projectId, user.userId, user.role);
        if (!isLatestRoomOp(projectId, seq)) {
          // A later leave for this channel arrived while we were checking access
          if (callback) callback({ success: false, message: 'Superseded by a later leave.' });
          return;
        }
        if (!access.allowed) {
          if (callback) callback({ success: false, message: 'Forbidden. You are not assigned to this project.' });
          return;
        }

        const canonicalId = access.project ? access.project._id.toString() : String(projectId);
        const passedId = String(projectId);

        socket.join(`project:${canonicalId}`);
        presence?.activeProjects.add(canonicalId);

        if (canonicalId !== passedId) {
          socket.join(`project:${passedId}`);
          presence?.activeProjects.add(passedId);
        }

        // Broadcast updated project presence
        emitToProject(canonicalId, 'presence:project_users', {
          projectId: canonicalId,
          onlineUsers: getProjectOnlineUsers(canonicalId),
        });
        if (canonicalId !== passedId) {
          emitToProject(passedId, 'presence:project_users', {
            projectId: canonicalId,
            onlineUsers: getProjectOnlineUsers(canonicalId),
          });
        }

        if (callback) callback({ success: true, room: `project:${canonicalId}`, canonicalId });
      } catch (err: any) {
        if (callback) callback({ success: false, message: 'Unable to join project channel.' });
      }
    };

    // Helper for leaving a project channel
    const handleLeaveProject = async (projectId: string) => {
      const passedId = String(projectId);
      const seq = markRoomOp(passedId);
      socket.leave(`project:${passedId}`);
      presence?.activeProjects.delete(passedId);

      try {
        const access = await verifyUserProjectAccess(projectId, user.userId, user.role);
        // A newer join for this channel already re-added the socket — keep it
        if (!isLatestRoomOp(passedId, seq)) return;
        if (access.project) {
          const canonicalId = access.project._id.toString();
          socket.leave(`project:${canonicalId}`);
          presence?.activeProjects.delete(canonicalId);

          emitToProject(canonicalId, 'presence:project_users', {
            projectId: canonicalId,
            onlineUsers: getProjectOnlineUsers(canonicalId),
          });
        }
      } catch {
        // Safe leave
      }

      emitToProject(passedId, 'presence:project_users', {
        projectId: passedId,
        onlineUsers: getProjectOnlineUsers(passedId),
      });
    };

    // Listen for both naming styles
    socket.on('project:join', handleJoinProject);
    socket.on('join:project', handleJoinProject);

    socket.on('project:leave', handleLeaveProject);
    socket.on('leave:project', handleLeaveProject);

    // Client marks messages as seen
    socket.on('messages:mark_seen', (data: { projectId: string; messageIds?: string[] }) => {
      // Only relay into rooms this socket has actually joined (access-checked on join)
      if (data?.projectId && socket.rooms.has(`project:${data.projectId}`)) {
        emitToProject(data.projectId, 'messages:seen', {
          projectId: data.projectId,
          readerId: user.userId,
          readerName: user.name,
          readAt: new Date().toISOString(),
        });
      }
    });

    // Typing indicator: relayed only into rooms this socket joined (access-checked on join),
    // and never back to the typist's own devices.
    const relayTyping = (data: { projectId?: string } | undefined, isTyping: boolean) => {
      const projectId = data?.projectId ? String(data.projectId) : '';
      if (!projectId || !socket.rooms.has(`project:${projectId}`)) return;
      socket.to(`project:${projectId}`).except(`user:${user.userId}`).emit('typing:update', {
        projectId,
        userId: user.userId,
        name: user.name,
        role: user.role,
        isTyping,
      });
    };
    socket.on('typing:start', (data) => relayTyping(data, true));
    socket.on('typing:stop', (data) => relayTyping(data, false));

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

          // Notify project rooms the user was in (company-scoped)
          presence.activeProjects.forEach((projId) => io?.to(`project:${projId}`).emit('presence:change', {
            userId: user.userId,
            name: user.name,
            role: user.role,
            isOnline: false,
            lastSeen: presence!.lastSeen.toISOString(),
          }));
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

/** Drop a user's live sockets from a project room (used when an assignment is revoked). */
export function removeUserFromProjectRoom(userId: string, projectId: string): void {
  if (io) io.in(`user:${userId}`).socketsLeave(`project:${projectId}`);
}

export function emitToUser(userId: string, event: string, data: any): void {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
}

/** Emit only to the MD/Owner user rooms of one project (company-isolated). */
export async function emitToProjectMDs(projectId: string | { toString(): string }, event: string, data: any): Promise<void> {
  if (!io) return;
  const mdIds = await getProjectMDIds(String(projectId));
  mdIds.forEach((id) => io?.to(`user:${id}`).emit(event, data));
}

/**
 * Report events go to the project room, the project's MDs and the author.
 * They are never broadcast to every connected client (that leaked report
 * metadata across companies).
 */
export function broadcastReportCreated(data: {
  reportId: string;
  projectId: string;
  submittedBy: string;
  titleOfWork: string;
}): void {
  if (!io) return;
  io.to(`project:${data.projectId}`).emit('daily-report:new', data);
  io.to(`user:${data.submittedBy}`).emit('daily-report:new', data);
  void emitToProjectMDs(data.projectId, 'daily-report:new', data).catch(() => undefined);
}

export function broadcastReportViewed(data: {
  reportId: string;
  projectId: string;
  viewerId: string;
  viewerName: string;
  viewedAt: Date | string;
  authorId?: string;
}): void {
  if (!io) return;
  io.to(`project:${data.projectId}`).emit('report:viewed', data);
  io.to(`project:${data.projectId}`).emit('daily-report:viewed', data);
  if (data.authorId) {
    io.to(`user:${data.authorId}`).emit('report:viewed', data);
    io.to(`user:${data.authorId}`).emit('daily-report:viewed', data);
  }
}
