import mongoose from 'mongoose';
import { ProjectMessage } from '../models/ProjectMessage.js';
import { Notification } from '../models/Notification.js';
import { emitToProject } from './socketService.js';

/** Unread notifications in the last 24 hours (the same window the bell and app badge use). */
export async function unreadNotificationCount(userId: string | mongoose.Types.ObjectId): Promise<number> {
  return Notification.countDocuments({
    recipient: userId,
    isRead: false,
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
}

/**
 * Marks a project chat as read for one user: every message gets their read
 * receipt, their chat notifications for it are marked read (so badges drop),
 * and everyone in the chat sees "seen" live.
 */
export async function markChatRead(
  reader: { userId: string; name?: string; role: string },
  projectId: string | mongoose.Types.ObjectId,
  alsoEmitTo?: string
): Promise<void> {
  const readAt = new Date();
  await ProjectMessage.updateMany(
    { project: projectId, 'readBy.user': { $ne: reader.userId } },
    { $push: { readBy: { user: reader.userId, readAt } } }
  );
  await Notification.updateMany(
    { recipient: reader.userId, project: projectId, relatedEntity: 'PROJECT_MESSAGE', isRead: false },
    { isRead: true }
  );
  const event = {
    projectId,
    readerId: reader.userId,
    readerName: reader.name || (reader.role === 'MD' ? 'MD' : 'Site Engineer'),
    readerRole: reader.role,
    readAt: readAt.toISOString(),
  };
  emitToProject(String(projectId), 'messages:seen', event);
  if (alsoEmitTo && alsoEmitTo !== String(projectId)) emitToProject(alsoEmitTo, 'messages:seen', event);
}
