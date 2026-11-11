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
  streamCloudFile,
  SIGNED_URL_TTL_SECONDS,
} from '../services/fileAccessService.js';
import { storageService } from '../services/storageService.js';
import { UploadedFile } from '../models/UploadedFile.js';

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

  // Optional: for photos/videos kept in Cloudinary, also hand out a short-lived signed
  // Cloudinary link so the browser loads them straight from Cloudinary's servers instead
  // of through this API. Access was already checked above (only signed files qualify).
  // The app falls back to the `signed` link if a direct link fails to load.
  const direct: Record<string, string> = {};
  if (req.body?.direct === true && storageService.isCloudinaryEnabled()) {
    const byFilename = new Map<string, string[]>();
    for (const [raw, value] of Object.entries(signed)) {
      const filename = value && !/^https?:/i.test(raw) ? extractLocalFilename(raw) : null;
      if (filename) byFilename.set(filename, [...(byFilename.get(filename) || []), raw]);
    }
    if (byFilename.size > 0) {
      const records = await UploadedFile.find({
        filename: { $in: Array.from(byFilename.keys()) },
        provider: 'CLOUDINARY',
        storageKey: { $exists: true },
        resourceType: { $in: ['image', 'video'] },
      })
        .select('filename storageKey resourceType format')
        .lean();
      for (const r of records) {
        if (!r.storageKey || !r.format || !r.resourceType) continue;
        const link = storageService.privateCloudinaryUrl(r.storageKey, r.resourceType, r.format, SIGNED_URL_TTL_SECONDS);
        byFilename.get(r.filename)?.forEach((raw) => (direct[raw] = link));
      }
    }
  }

  res.json({ success: true, expiresIn: SIGNED_URL_TTL_SECONDS, signed, direct });
});

/**
 * GET /uploads/:filename?exp=&sig=
 * Serves a private upload only with a valid, unexpired signature.
 */
export async function serveSignedUpload(req: Request, res: Response): Promise<void> {
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
  if (!filePath.startsWith(uploadsDir)) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }
  if (!fs.existsSync(filePath)) {
    // Signature already verified: stream from private cloud storage if it lives there
    try {
      if (await streamCloudFile(filename, req, res, { download: req.query.download === 'true' })) return;
    } catch (err) {
      console.error('Cloud stream failed:', (err as Error).message);
    }
    if (!res.headersSent) res.status(404).json({ success: false, message: 'File not found' });
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
