import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../types/index.js';
import {
  canUserAccessFile,
  extractLocalFilename,
  signFilename,
  verifyFileSignature,
  SIGNED_URL_TTL_SECONDS,
} from '../services/fileAccessService.js';

export const uploadsDir = path.resolve(process.cwd(), 'uploads');

/**
 * POST /api/v1/files/sign  { urls: string[] }
 * Returns { signed: { [originalUrl]: signedUrl | null } }.
 * External (Cloudinary/R2) URLs are returned unchanged; local files the caller
 * may not access map to null.
 */
export const fileApiRouter = Router();
fileApiRouter.use(authenticate);

fileApiRouter.post('/sign', async (req: AuthenticatedRequest, res: Response) => {
  const urls: unknown = req.body?.urls;
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 100) {
    res.status(400).json({ success: false, message: 'Provide between 1 and 100 file URLs to sign.' });
    return;
  }

  const signed: Record<string, string | null> = {};
  const cache = new Map<string, boolean>();

  for (const raw of urls) {
    if (typeof raw !== 'string' || raw.length > 2048) continue;
    if (/^https?:\/\//i.test(raw) || raw.startsWith('blob:') || raw.startsWith('data:')) {
      signed[raw] = raw;
      continue;
    }
    const filename = extractLocalFilename(raw);
    if (!filename) {
      signed[raw] = null;
      continue;
    }
    if (!cache.has(filename)) cache.set(filename, await canUserAccessFile(req.user!, filename));
    signed[raw] = cache.get(filename) ? signFilename(filename) : null;
  }

  res.json({ success: true, expiresIn: SIGNED_URL_TTL_SECONDS, signed });
});

/**
 * GET /uploads/:filename?exp=&sig=
 * Serves a private upload only with a valid, unexpired signature.
 */
export function serveSignedUpload(req: Request, res: Response): void {
  const filename = path.basename(String(req.params.filename || ''));
  if (!filename || filename.startsWith('.')) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }

  if (!verifyFileSignature(filename, req.query.exp, req.query.sig)) {
    res.status(403).json({ success: false, message: 'This file link is invalid or has expired.' });
    return;
  }

  const filePath = path.join(uploadsDir, filename);
  if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }

  res.setHeader('Cache-Control', 'private, max-age=3000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.query.download === 'true') {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  // sendFile handles Range requests for video seeking
  res.sendFile(filePath, { dotfiles: 'deny' });
}
