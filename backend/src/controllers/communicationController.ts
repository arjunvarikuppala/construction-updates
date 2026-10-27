import { Response } from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { AuthenticatedRequest } from '../types/index.js';
import { ProjectMessage, MessageContextType, IMessageAttachment } from '../models/ProjectMessage.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { User } from '../models/User.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { emitToProject, isUserOnline, isUserInProject } from '../services/socketService.js';
import { createNotification, notifyAllMDs } from '../services/notificationService.js';
import { logAudit } from '../services/auditService.js';
import { storageService } from '../services/storageService.js';

const MAX_IMAGE_SIZE = parseInt(process.env.CHAT_MAX_IMAGE_SIZE_MB || '10', 10) * 1024 * 1024;
const MAX_VIDEO_SIZE = parseInt(process.env.CHAT_MAX_VIDEO_SIZE_MB || '100', 10) * 1024 * 1024;

export function validateMediaMagicBytes(
  filePath: string
): { valid: boolean; mediaType: 'image' | 'video' | 'document'; detectedMime: string } | null {
  try {
    const buffer = Buffer.alloc(32);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 32, 0);
    fs.closeSync(fd);

    if (bytesRead < 4) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { valid: true, mediaType: 'image', detectedMime: 'image/jpeg' };
    }

    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { valid: true, mediaType: 'image', detectedMime: 'image/png' };
    }

    // WEBP: 'RIFF' at 0..3 and 'WEBP' at 8..11
    if (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      bytesRead >= 12 &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { valid: true, mediaType: 'image', detectedMime: 'image/webp' };
    }

    // MP4: 'ftyp' at bytes 4..7
    if (bytesRead >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp') {
      return { valid: true, mediaType: 'video', detectedMime: 'video/mp4' };
    }

    // WebM / Matroska: 1A 45 DF A3
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return { valid: true, mediaType: 'video', detectedMime: 'video/webm' };
    }

    // PDF: %PDF-
    if (buffer.toString('ascii', 0, 4) === '%PDF') {
      return { valid: true, mediaType: 'document', detectedMime: 'application/pdf' };
    }

    return null;
  } catch (err) {
    return null;
  }
}

function getMimeTypeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

export async function listProjectMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const { limit = 100, before } = req.query;

    const access = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!access.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to this project conversation.' });
      return;
    }

    const resolvedProjectId = access.project ? access.project._id : projectId;

    const query: any = { project: resolvedProjectId };
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
        projectId: resolvedProjectId,
        readerId: req.user!.userId,
        readerName: req.user!.name || (req.user!.role === 'MD' ? 'MD' : 'Site Engineer'),
        readerRole: req.user!.role,
        readAt: readAt.toISOString(),
      });
      if (String(resolvedProjectId) !== String(projectId)) {
        emitToProject(String(resolvedProjectId), 'messages:seen', {
          projectId: resolvedProjectId,
          readerId: req.user!.userId,
          readerName: req.user!.name || (req.user!.role === 'MD' ? 'MD' : 'Site Engineer'),
          readerRole: req.user!.role,
          readAt: readAt.toISOString(),
        });
      }
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

    const access = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!access.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to post to this project.' });
      return;
    }

    const resolvedProjectId = access.project ? access.project._id : projectId;
    const project = access.project || (await Project.findById(resolvedProjectId));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found.' });
      return;
    }

    const textContent = (content || '').trim();
    const messageAttachments = Array.isArray(attachments) ? attachments : [];

    if (!textContent && messageAttachments.length === 0) {
      res.status(400).json({ success: false, message: 'Message content or at least one attachment is required.' });
      return;
    }

    const message = await ProjectMessage.create({
      project: resolvedProjectId,
      sender: req.user!.userId,
      content: textContent,
      attachments: messageAttachments,
      contextType: contextType as MessageContextType,
      contextId: contextId ? String(contextId) : undefined,
      contextSummary: contextSummary ? String(contextSummary) : undefined,
      readBy: [{ user: req.user!.userId, readAt: new Date() }],
    });

    const populatedMessage = await ProjectMessage.findById(message._id).populate('sender', 'name email role');

    // Broadcast message via Socket.IO to project room
    emitToProject(projectId, 'message:new', populatedMessage);
    if (String(resolvedProjectId) !== String(projectId)) {
      emitToProject(String(resolvedProjectId), 'message:new', populatedMessage);
    }

    // Notify project members
    const senderObj = populatedMessage?.sender as any;
    const senderName = senderObj?.name || (req.user!.role === 'MD' ? 'Managing Director' : 'Site In-Charge');
    const notifTitle = `New Message in ${project.name}`;
    const notifMessage = textContent
      ? `${senderName}: ${textContent.slice(0, 100)}`
      : `${senderName} sent ${messageAttachments.length} attachment(s)`;

    if (req.user!.role === 'MD') {
      // Notify assigned in-charges
      const assignments = await ProjectAssignment.find({ project: resolvedProjectId, assignmentStatus: 'ACTIVE' });
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

      const assignments = await ProjectAssignment.find({ project: resolvedProjectId, assignmentStatus: 'ACTIVE' });
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
      projectId: resolvedProjectId,
      contextType,
      contextId,
      hasAttachments: messageAttachments.length > 0,
      attachmentCount: messageAttachments.length,
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

    const resolvedProjectId = access.project ? access.project._id : projectId;

    const readAt = new Date();
    await ProjectMessage.updateMany(
      { project: resolvedProjectId, 'readBy.user': { $ne: req.user!.userId } },
      { $push: { readBy: { user: req.user!.userId, readAt } } }
    );

    // Broadcast seen event live!
    emitToProject(projectId, 'messages:seen', {
      projectId: resolvedProjectId,
      readerId: req.user!.userId,
      readerName: req.user!.name || (req.user!.role === 'MD' ? 'MD' : 'Site Engineer'),
      readerRole: req.user!.role,
      readAt: readAt.toISOString(),
    });
    if (String(resolvedProjectId) !== String(projectId)) {
      emitToProject(String(resolvedProjectId), 'messages:seen', {
        projectId: resolvedProjectId,
        readerId: req.user!.userId,
        readerName: req.user!.name || (req.user!.role === 'MD' ? 'MD' : 'Site Engineer'),
        readerRole: req.user!.role,
        readAt: readAt.toISOString(),
      });
    }

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

    const resolvedProjectId = access.project ? access.project._id : projectId;

    // Fetch the project and its linked ownership
    const project = await Project.findById(resolvedProjectId)
      .populate('createdBy', 'name email role phone')
      .populate('owner', 'name email role phone')
      .populate('assignedInCharge', 'name email role phone');

    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found.' });
      return;
    }

    const participantsMap = new Map<string, any>();

    // 1. LINKED MANAGING DIRECTOR (Only the MD linked to this project)
    let projectMD: any = null;
    if (project.owner && (project.owner as any)._id) {
      projectMD = project.owner;
    } else if (project.createdBy && (project.createdBy as any)._id) {
      projectMD = project.createdBy;
    } else if (req.user!.role === 'MD' || req.user!.role === 'OWNER') {
      projectMD = { _id: req.user!.userId, name: req.user!.name || 'Managing Director', role: req.user!.role };
    }

    if (projectMD) {
      const mdId = (projectMD._id || projectMD.id).toString();
      participantsMap.set(mdId, {
        userId: mdId,
        name: projectMD.name,
        role: projectMD.role || 'MD',
        isOnline: isUserOnline(mdId),
        isInChannel: isUserInProject(mdId, String(resolvedProjectId)) || isUserInProject(mdId, projectId),
        isMD: true,
      });
    }

    // If caller is an MD and matches creator/owner or is viewing their project, ensure caller is present
    if (
      (req.user!.role === 'MD' || req.user!.role === 'OWNER') &&
      !participantsMap.has(req.user!.userId) &&
      (String(project.createdBy?._id) === req.user!.userId || String(project.owner?._id) === req.user!.userId)
    ) {
      participantsMap.set(req.user!.userId, {
        userId: req.user!.userId,
        name: req.user!.name || 'Managing Director',
        role: req.user!.role,
        isOnline: isUserOnline(req.user!.userId),
        isInChannel: isUserInProject(req.user!.userId, String(resolvedProjectId)) || isUserInProject(req.user!.userId, projectId),
        isMD: true,
      });
    }

    // 2. LINKED SITE IN-CHARGE(S) FOR THIS PROJECT ONLY
    // A) From ProjectAssignment:
    const assignments = await ProjectAssignment.find({
      project: resolvedProjectId,
      assignmentStatus: 'ACTIVE',
    }).populate('siteInCharge', 'name email role phone');

    assignments.forEach((a: any) => {
      if (a.siteInCharge && a.siteInCharge._id) {
        const id = a.siteInCharge._id.toString();
        participantsMap.set(id, {
          userId: id,
          name: a.siteInCharge.name,
          role: a.siteInCharge.role || 'SITE_INCHARGE',
          phone: a.siteInCharge.phone,
          isOnline: isUserOnline(id),
          isInChannel: isUserInProject(id, String(resolvedProjectId)) || isUserInProject(id, projectId),
          isInCharge: true,
        });
      }
    });

    // B) From project.assignedInCharge:
    if (project.assignedInCharge && (project.assignedInCharge as any)._id) {
      const incharge = project.assignedInCharge as any;
      const id = incharge._id.toString();
      if (!participantsMap.has(id)) {
        participantsMap.set(id, {
          userId: id,
          name: incharge.name,
          role: incharge.role || 'SITE_INCHARGE',
          phone: incharge.phone,
          isOnline: isUserOnline(id),
          isInChannel: isUserInProject(id, String(resolvedProjectId)) || isUserInProject(id, projectId),
          isInCharge: true,
        });
      }
    }

    const participants = Array.from(participantsMap.values());
    const mdParticipants = participants.filter((p) => p.isMD);
    const inchargeParticipants = participants.filter((p) => p.isInCharge);

    const otherParticipants = participants.filter((p) => p.userId !== req.user!.userId);
    const onlineCount = otherParticipants.filter((p) => p.isOnline).length;
    const isOtherPartyOnline = onlineCount > 0;

    res.json({
      success: true,
      projectId: resolvedProjectId,
      project: {
        id: project._id,
        name: project.name,
        code: project.code,
      },
      participants,
      linkedMD: mdParticipants[0] || null,
      linkedInCharges: inchargeParticipants,
      hasAssignedInCharge: inchargeParticipants.length > 0,
      onlineCount,
      isOtherPartyOnline,
      isChannelActive: otherParticipants.some((p) => p.isInChannel),
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

    const resolvedProjectId = access.project ? access.project._id : projectId;

    const unreadCount = await ProjectMessage.countDocuments({
      project: resolvedProjectId,
      'readBy.user': { $ne: req.user!.userId },
    });

    res.json({ success: true, unreadCount });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to get unread count', error: err.message });
  }
}

export async function uploadProjectMessageMedia(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const access = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!access.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to this project.' });
      return;
    }

    const resolvedProjectId = access.project ? access.project._id : projectId;

    // Collect uploaded files from req.files or req.file
    let uploadedFiles: Express.Multer.File[] = [];
    if (Array.isArray(req.files)) {
      uploadedFiles = req.files;
    } else if (req.files && typeof req.files === 'object') {
      const fieldFiles = Object.values(req.files).flat() as Express.Multer.File[];
      uploadedFiles = fieldFiles;
    } else if (req.file) {
      uploadedFiles = [req.file];
    }

    if (!uploadedFiles || uploadedFiles.length === 0) {
      res.status(400).json({ success: false, message: 'No media files provided.' });
      return;
    }

    const processedAttachments: IMessageAttachment[] = [];

    for (const file of uploadedFiles) {
      const filePath = file.path;

      // 1. Validate magic bytes
      const detected = validateMediaMagicBytes(filePath);
      if (!detected) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        res.status(400).json({
          success: false,
          message: `File "${file.originalname}" failed magic byte inspection. Unsupported or corrupted file format. Supported: JPEG, PNG, WEBP, MP4, WEBM, PDF.`,
        });
        return;
      }

      // 2. Validate size limits
      const stat = fs.statSync(filePath);
      if (detected.mediaType === 'image' && stat.size > MAX_IMAGE_SIZE) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        res.status(400).json({
          success: false,
          message: `Image "${file.originalname}" exceeds maximum allowed size of ${MAX_IMAGE_SIZE / (1024 * 1024)}MB.`,
        });
        return;
      }
      if (detected.mediaType === 'video' && stat.size > MAX_VIDEO_SIZE) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        res.status(400).json({
          success: false,
          message: `Video "${file.originalname}" exceeds maximum allowed size of ${MAX_VIDEO_SIZE / (1024 * 1024)}MB.`,
        });
        return;
      }

      // 3. Upload to cloud or save to local
      const uploadResult = await storageService.uploadFile(filePath, file.filename, detected.detectedMime);

      // If local storage was used, provide URL pointing to authenticated media streaming route
      let fileUrl = uploadResult.url;
      if (fileUrl.startsWith('/uploads/')) {
        fileUrl = `/api/v1/projects/${resolvedProjectId}/messages/media/${file.filename}`;
      }

      processedAttachments.push({
        type: detected.mediaType,
        url: fileUrl,
        name: file.originalname,
        size: uploadResult.size,
        mimeType: detected.detectedMime,
        storageKey: uploadResult.key,
      });
    }

    await logAudit('COMMUNICATION_MEDIA_UPLOAD', req.user!.userId, 'COMMUNICATION', resolvedProjectId, {
      projectId: resolvedProjectId,
      filesCount: processedAttachments.length,
      attachments: processedAttachments.map((a) => ({ name: a.name, type: a.type, size: a.size })),
    });

    res.json({
      success: true,
      message: `${processedAttachments.length} file(s) processed successfully`,
      attachments: processedAttachments,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Media upload failed', error: err.message });
  }
}

export async function serveProjectMessageMedia(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId, filename } = req.params;
    const safeFilename = path.basename(filename);

    const access = await verifyUserProjectAccess(projectId, req.user!.userId, req.user!.role);
    if (!access.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to this project media.' });
      return;
    }

    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const filePath = path.join(uploadsDir, safeFilename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, message: 'Media file not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const mimeType = getMimeTypeFromFilename(safeFilename);

    // Optional download disposition
    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    }

    // Support HTTP 206 Partial Content Range requests for smooth video playback & seeking
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });

      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to serve media', error: err.message });
  }
}
