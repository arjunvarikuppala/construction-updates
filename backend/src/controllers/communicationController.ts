import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../types/index.js';
import { ProjectMessage, MessageContextType } from '../models/ProjectMessage.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { User } from '../models/User.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { emitToProject, isUserOnline, isUserInProject } from '../services/socketService.js';
import { createNotification, notifyAllMDs } from '../services/notificationService.js';
import { logAudit } from '../services/auditService.js';

export async function listProjectMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const { limit = 100, before } = req.query;

    const access = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!access.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to this project conversation.' });
      return;
    }

    const query: any = { project: projectId };
    if (before) {
      query.createdAt = { $lt: new Date(String(before)) };
    }

    const messages = await ProjectMessage.find(query)
      .populate('sender', 'name email role')
      .populate('readBy.user', 'name email role')
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 100, 200));

    // Reverse to chronological order for chat view
    messages.reverse();

    // Mark messages as read by current user in background
    const unreadMessageIds = messages
      .filter((m) => !m.readBy.some((r) => {
        const uId = String((r.user as any)?._id || r.user);
        return uId === req.user!.userId;
      }))
      .map((m) => m._id);

    if (unreadMessageIds.length > 0) {
      const readAt = new Date();
      await ProjectMessage.updateMany(
        { _id: { $in: unreadMessageIds } },
        { $push: { readBy: { user: req.user!.userId, readAt } } }
      );

      // Broadcast seen event live!
      emitToProject(projectId, 'messages:seen', {
        projectId,
        readerId: req.user!.userId,
        readerName: req.user!.name || (req.user!.role === 'MD' ? 'MD' : 'Site Engineer'),
        readerRole: req.user!.role,
        readAt: readAt.toISOString(),
      });
    }

    res.json({
      success: true,
      count: messages.length,
      messages,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch messages', error: err.message });
  }
}

export async function sendProjectMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const { content, attachments, contextType = 'GENERAL', contextId, contextSummary } = req.body;

    if (!content || !content.trim()) {
      res.status(400).json({ success: false, message: 'Message content is required.' });
      return;
    }

    const access = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!access.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to post to this project.' });
      return;
    }

    const project = await Project.findById(projectId);
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found.' });
      return;
    }

    const message = await ProjectMessage.create({
      project: projectId,
      sender: req.user!.userId,
      content: content.trim(),
      attachments: Array.isArray(attachments) ? attachments : [],
      contextType: contextType as MessageContextType,
      contextId: contextId ? String(contextId) : undefined,
      contextSummary: contextSummary ? String(contextSummary) : undefined,
      readBy: [{ user: req.user!.userId, readAt: new Date() }],
    });

    const populatedMessage = await ProjectMessage.findById(message._id).populate('sender', 'name email role');

    // Broadcast message via Socket.IO to project room
    emitToProject(projectId, 'message:new', populatedMessage);

    // Notify project members
    const senderObj = populatedMessage?.sender as any;
    const senderName = senderObj?.name || (req.user!.role === 'MD' ? 'Managing Director' : 'Site In-Charge');
    const notifTitle = `New Message in ${project.name}`;
    const notifMessage = `${senderName}: ${content.slice(0, 100)}`;

    if (req.user!.role === 'MD') {
      // Notify assigned in-charges
      const assignments = await ProjectAssignment.find({ project: projectId, assignmentStatus: 'ACTIVE' });
      for (const assign of assignments) {
        if (assign.siteInCharge.toString() !== req.user!.userId) {
          await createNotification({
            recipient: assign.siteInCharge,
            sender: req.user!.userId,
            project: project._id,
            type: 'PROJECT_MESSAGE',
            title: notifTitle,
            message: notifMessage,
            relatedEntity: 'PROJECT_MESSAGE',
            relatedId: message._id.toString(),
          });
        }
      }
    } else {
      // In-Charge sent: notify MDs and other assigned in-charges
      await notifyAllMDs({
        sender: req.user!.userId,
        project: project._id,
        type: 'PROJECT_MESSAGE',
        title: notifTitle,
        message: notifMessage,
        relatedEntity: 'PROJECT_MESSAGE',
        relatedId: message._id.toString(),
      });

      const assignments = await ProjectAssignment.find({ project: projectId, assignmentStatus: 'ACTIVE' });
      for (const assign of assignments) {
        if (assign.siteInCharge.toString() !== req.user!.userId) {
          await createNotification({
            recipient: assign.siteInCharge,
            sender: req.user!.userId,
            project: project._id,
            type: 'PROJECT_MESSAGE',
            title: notifTitle,
            message: notifMessage,
            relatedEntity: 'PROJECT_MESSAGE',
            relatedId: message._id.toString(),
          });
        }
      }
    }

    await logAudit('COMMUNICATION_MESSAGE_SENT', req.user!.userId, 'COMMUNICATION', message._id, {
      projectId,
      contextType,
      contextId,
      hasAttachments: Array.isArray(attachments) && attachments.length > 0,
    });

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: populatedMessage,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to send message', error: err.message });
  }
}

export async function markProjectMessagesRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;

    const access = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!access.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden.' });
      return;
    }

    const readAt = new Date();
    await ProjectMessage.updateMany(
      { project: projectId, 'readBy.user': { $ne: req.user!.userId } },
      { $push: { readBy: { user: req.user!.userId, readAt } } }
    );

    // Broadcast seen event live!
    emitToProject(projectId, 'messages:seen', {
      projectId,
      readerId: req.user!.userId,
      readerName: req.user!.name || (req.user!.role === 'MD' ? 'MD' : 'Site Engineer'),
      readerRole: req.user!.role,
      readAt: readAt.toISOString(),
    });

    res.json({ success: true, message: 'All messages marked as read.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to mark messages read', error: err.message });
  }
}

export async function getProjectPresence(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;

    const access = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!access.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden.' });
      return;
    }

    // Find assigned site in-charges
    const assignments = await ProjectAssignment.find({
      project: projectId,
      assignmentStatus: 'ACTIVE',
    }).populate('siteInCharge', 'name email role');

    // Find MDs
    const mds = await User.find({ role: { $in: ['MD', 'OWNER'] }, isActive: true }).select('name email role');

    const participantsMap = new Map<string, any>();

    mds.forEach((md) => {
      const id = md._id.toString();
      participantsMap.set(id, {
        userId: id,
        name: md.name,
        role: md.role,
        isOnline: isUserOnline(id),
        isInChannel: isUserInProject(id, projectId),
      });
    });

    assignments.forEach((a: any) => {
      if (a.siteInCharge) {
        const id = a.siteInCharge._id.toString();
        participantsMap.set(id, {
          userId: id,
          name: a.siteInCharge.name,
          role: a.siteInCharge.role,
          isOnline: isUserOnline(id),
          isInChannel: isUserInProject(id, projectId),
        });
      }
    });

    const participants = Array.from(participantsMap.values());
    const onlineCount = participants.filter((p) => p.isOnline).length;
    const inChannelCount = participants.filter((p) => p.isInChannel).length;

    res.json({
      success: true,
      projectId,
      participants,
      onlineCount,
      inChannelCount,
      isChannelActive: inChannelCount > 0,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get presence', error: err.message });
  }
}

export async function getUnreadMessagesCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;

    const access = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!access.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden.' });
      return;
    }

    const unreadCount = await ProjectMessage.countDocuments({
      project: projectId,
      'readBy.user': { $ne: req.user!.userId },
    });

    res.json({ success: true, unreadCount });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get unread count', error: err.message });
  }
}
