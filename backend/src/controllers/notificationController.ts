import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { Notification } from '../models/Notification.js';

/**
 * List notifications for the authenticated user.
 * By default, limits to a rolling 24-hour window (createdAt >= now - 24 hours).
 * Setting timeWindow='all' or history='true' returns historical notifications.
 */
export async function listNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { limit = 50, page = 1, timeWindow, history, type, unreadOnly, search } = req.query;
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const isHistorical = history === 'true' || timeWindow === 'all';

    // Base filter scoped to current authenticated recipient
    const filter: any = { recipient: req.user!.userId };

    // Dynamic 24-hour rolling window constraint (unless historical is explicitly requested)
    if (!isHistorical) {
      filter.createdAt = { $gte: twentyFourHoursAgo };
    }

    // Filter by unread status if requested
    if (unreadOnly === 'true') {
      filter.isRead = false;
    }

    // Filter by notification category / type
    if (type && type !== 'ALL') {
      const typeStr = String(type);
      if (typeStr === 'DAILY_REPORT') {
        filter.type = { $regex: '^DAILY_REPORT' };
      } else if (typeStr === 'PAYMENT') {
        filter.type = { $regex: '^PAYMENT' };
      } else {
        filter.type = typeStr;
      }
    }

    // Search query by title or message
    if (search && String(search).trim()) {
      const searchTerm = String(search).trim();
      filter.$or = [
        { title: { $regex: searchTerm, $options: 'i' } },
        { message: { $regex: searchTerm, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(Math.max(1, Number(limit) || (isHistorical ? 100 : 50)), 200);
    const skip = (pageNum - 1) * limitNum;

    const [notifications, totalFilteredCount, windowUnreadCount, totalHistoricalCount, totalHistoricalUnreadCount] =
      await Promise.all([
        Notification.find(filter)
          .populate('sender', 'name email role')
          .populate('project', 'name code')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        Notification.countDocuments(filter),
        Notification.countDocuments({
          recipient: req.user!.userId,
          isRead: false,
          createdAt: { $gte: twentyFourHoursAgo },
        }),
        Notification.countDocuments({ recipient: req.user!.userId }),
        Notification.countDocuments({ recipient: req.user!.userId, isRead: false }),
      ]);

    res.json({
      success: true,
      unreadCount: windowUnreadCount, // 24-hour unread count for badges and recent indicators
      windowUnreadCount,
      count: notifications.length,
      totalCount: totalFilteredCount,
      page: pageNum,
      totalPages: Math.ceil(totalFilteredCount / limitNum) || 1,
      totalHistoricalCount,
      totalHistoricalUnreadCount,
      timeWindow: isHistorical ? 'all' : '24h',
      serverTime: now.toISOString(),
      twentyFourHoursAgo: twentyFourHoursAgo.toISOString(),
      notifications,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications', error: err.message });
  }
}

/**
 * Mark a single notification as read.
 */
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

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const unreadCount = await Notification.countDocuments({
      recipient: req.user!.userId,
      isRead: false,
      createdAt: { $gte: twentyFourHoursAgo },
    });

    res.json({
      success: true,
      message: 'Notification marked as read',
      notification: notif,
      unreadCount,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to update notification', error: err.message });
  }
}

/**
 * Mark all notifications for the authenticated user as read.
 */
export async function markAllNotificationsAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    await Notification.updateMany({ recipient: req.user!.userId, isRead: false }, { isRead: true });

    res.json({ success: true, message: 'All notifications marked as read', unreadCount: 0 });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to mark all read', error: err.message });
  }
}

/**
 * Get dynamic unread notification count.
 * Defaults to notifications created within the rolling 24-hour window.
 */
export async function getUnreadNotificationCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { timeWindow, history } = req.query;
    const isHistorical = history === 'true' || timeWindow === 'all';
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const filter: any = {
      recipient: req.user!.userId,
      isRead: false,
    };

    if (!isHistorical) {
      filter.createdAt = { $gte: twentyFourHoursAgo };
    }

    const [unreadCount, totalHistoricalUnreadCount] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: req.user!.userId, isRead: false }),
    ]);

    res.json({
      success: true,
      unreadCount, // Active 24-hour rolling window unread count
      totalHistoricalUnreadCount,
      serverTime: now.toISOString(),
      twentyFourHoursAgo: twentyFourHoursAgo.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get unread count', error: err.message });
  }
}
