import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { Notification } from '../models/Notification.js';

export async function listNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { limit = 50 } = req.query;

    const notifications = await Notification.find({ recipient: req.user!.userId })
      .populate('sender', 'name email role')
      .populate('project', 'name code')
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 100));

    const unreadCount = await Notification.countDocuments({
      recipient: req.user!.userId,
      isRead: false,
    });

    res.json({
      success: true,
      unreadCount,
      count: notifications.length,
      notifications,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications', error: err.message });
  }
}

export async function markNotificationAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const notif = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.user!.userId },
      { isRead: true },
      { new: true }
    );

    if (!notif) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    res.json({ success: true, message: 'Notification marked as read', notification: notif });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to update notification', error: err.message });
  }
}

export async function markAllNotificationsAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    await Notification.updateMany({ recipient: req.user!.userId, isRead: false }, { isRead: true });

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to mark all read', error: err.message });
  }
}
