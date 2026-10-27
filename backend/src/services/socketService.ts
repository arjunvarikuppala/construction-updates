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

let io: SocketIOServer | null = null;

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

    // Join personal user notification room
    socket.join(`user:${user.userId}`);

    // If MD, join executive room
    if (user.role === 'MD') {
      socket.join('role:MD');
    }

    // Handle joining a project conversation room
    socket.on('join:project', async (projectId: string, callback?: (res: any) => void) => {
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
        if (callback) callback({ success: true, room: `project:${projectId}` });
      } catch (err: any) {
        if (callback) callback({ success: false, message: err.message });
      }
    });

    // Handle leaving a project room
    socket.on('leave:project', (projectId: string) => {
      socket.leave(`project:${projectId}`);
    });

    socket.on('disconnect', () => {
      // Clean disconnect
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
