import mongoose from 'mongoose';
import { Notification, NotificationType, NotificationRelatedEntity } from '../models/Notification.js';
import { User } from '../models/User.js';
import { emitToUser, emitToMDs } from './socketService.js';

export async function createNotification(params: {
  recipient: string | mongoose.Types.ObjectId;
  sender?: string | mongoose.Types.ObjectId;
  project?: string | mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntity?: NotificationRelatedEntity;
  relatedId?: string;
}) {
  try {
    const notif = await Notification.create({
      recipient: params.recipient,
      sender: params.sender,
      project: params.project,
      type: params.type,
      title: params.title,
      message: params.message,
      relatedEntity: params.relatedEntity,
      relatedId: params.relatedId,
    });

    // Populate sender name if available
    const populated = await Notification.findById(notif._id)
      .populate('sender', 'name email role')
      .populate('project', 'name code');

    emitToUser(params.recipient.toString(), 'notification:new', populated);
    return notif;
  } catch (err) {
    console.error('Failed to create notification:', err);
    return null;
  }
}

export async function notifyAllMDs(params: {
  sender?: string | mongoose.Types.ObjectId;
  project?: string | mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntity?: NotificationRelatedEntity;
  relatedId?: string;
  excludeUserId?: string;
}) {
  try {
    const mds = await User.find({ role: 'MD', isActive: true });
    for (const md of mds) {
      if (params.excludeUserId && md._id.toString() === params.excludeUserId) {
        continue;
      }
      await createNotification({
        ...params,
        recipient: md._id,
      });
    }
  } catch (err) {
    console.error('Failed to notify MDs:', err);
  }
}
