/**
 * Private file access.
 *
 * Locally stored uploads (receipts, invoices, site photos, chat media) are no
 * longer served publicly. A client first asks POST /api/v1/files/sign with the
 * stored URLs; the server checks project-level authorization for each file and
 * returns short-lived HMAC-signed URLs (/uploads/<file>?exp=..&sig=..) that work
 * in <img>/<video>/<a> tags without exposing the login token.
 */
import crypto from 'crypto';
import path from 'path';
import mongoose from 'mongoose';
import { getFileSigningSecret } from '../config/env.js';
import { AuthUserPayload } from '../types/index.js';
import { UploadedFile } from '../models/UploadedFile.js';
import { DailyReport } from '../models/DailyReport.js';
import { Expense } from '../models/Expense.js';
import { PaymentRequest } from '../models/PaymentRequest.js';
import { ProjectMessage } from '../models/ProjectMessage.js';
import { getAccessibleProjectIds } from './tenantService.js';
import { escapeRegex } from '../utils/validation.js';
import { storageService, StorageUploadResult } from './storageService.js';
import type { Request, Response } from 'express';

export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

const LOCAL_UPLOAD_RE = /^\/uploads\/([^/?#]+)$/;
const CHAT_MEDIA_RE = /^\/api\/v1\/projects\/[^/]+\/messages\/media\/([^/?#]+)$/;

/** Returns the stored filename for local URLs, or null for external (Cloudinary/R2) URLs. */
export function extractLocalFilename(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  const clean = url.split('?')[0].split('#')[0];
  const match = clean.match(LOCAL_UPLOAD_RE) || clean.match(CHAT_MEDIA_RE);
  if (!match) return null;
  const name = path.basename(decodeURIComponent(match[1]));
  return name && name !== '.' && name !== '..' ? name : null;
}

function computeSignature(filename: string, exp: number): string {
  return crypto.createHmac('sha256', getFileSigningSecret()).update(`${filename}:${exp}`).digest('hex');
}

export function signFilename(filename: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = computeSignature(filename, exp);
  return `/uploads/${encodeURIComponent(filename)}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(filename: string, exp: unknown, sig: unknown): boolean {
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || typeof sig !== 'string' || sig.length !== 64) return false;
  if (expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = computeSignature(filename, expNum);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** Projects whose records reference this file. */
async function findReferencingProjectIds(filename: string): Promise<string[]> {
  const pattern = new RegExp(`/${escapeRegex(filename)}$`);
  const [reports, expenses, payments, messages] = await Promise.all([
    DailyReport.find({ 'photos.url': pattern }).select('project'),
    Expense.find({ receiptUrl: pattern }).select('project'),
    PaymentRequest.find({ invoiceUrl: pattern }).select('project'),
    ProjectMessage.find({ 'attachments.url': pattern }).select('project'),
  ]);
  const ids = new Set<string>();
  [...reports, ...expenses, ...payments, ...messages].forEach((doc: any) => doc.project && ids.add(String(doc.project)));
  return Array.from(ids);
}

/** Can this user read the given stored file? */
export async function canUserAccessFile(
  user: Pick<AuthUserPayload, 'userId' | 'role'>,
  filename: string
): Promise<boolean> {
  const ownUpload = await UploadedFile.exists({
    filename,
    uploadedBy: new mongoose.Types.ObjectId(user.userId),
  });
  if (ownUpload) return true;

  const referencing = await findReferencingProjectIds(filename);
  if (referencing.length === 0) return false;

  const accessible = new Set((await getAccessibleProjectIds(user)).map(String));
  return referencing.some((id) => accessible.has(id));
}

/** Record an upload so the uploader can preview it before it is attached to a record. */
export async function recordUpload(params: {
  url: string;
  uploadedBy: string;
  mimetype?: string;
  size?: number;
  storage?: StorageUploadResult;
}): Promise<void> {
  const filename = extractLocalFilename(params.url);
  if (!filename) return; // external storage (Cloudinary/R2) — nothing to protect locally
  try {
    await UploadedFile.create({
      filename,
      url: params.url,
      uploadedBy: params.uploadedBy,
      mimetype: params.mimetype,
      size: params.size,
      provider: params.storage?.provider,
      storageKey: params.storage?.provider === 'CLOUDINARY' ? params.storage.key : undefined,
      resourceType: params.storage?.resourceType,
      format: params.storage?.format,
    });
  } catch (err) {
    console.error('Failed to record upload ownership:', (err as Error).message);
  }
}

export interface ShareableAttachment {
  url: string;
  name: string;
  type: 'image' | 'video' | 'document';
  mimeType: string;
  size?: number;
  storageKey?: string;
}

function inferMime(url: string, fallback?: string): string {
  if (fallback) return fallback;
  const ext = path.extname(url.split('?')[0]).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp4' || ext === '.mov') return 'video/mp4';
  return 'application/octet-stream';
}

function mediaTypeFor(mime: string): 'image' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Validate an attachment a client wants to post in a project chat. Accepted only if
 * the caller uploaded it themselves, or it already belongs to a record of THIS
 * project (sharing an existing receipt/invoice/photo without duplicating the file).
 * Metadata is taken from the server record, never trusted from the client.
 */
export async function resolveShareableAttachment(
  user: Pick<AuthUserPayload, 'userId'>,
  projectId: string,
  raw: any
): Promise<ShareableAttachment | null> {
  const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
  if (!url || url.length > 2048) return null;
  if (!/^https:\/\//i.test(url) && !extractLocalFilename(url)) return null;

  const name = String(raw?.name || path.basename(url.split('?')[0]) || 'file').slice(0, 200);

  // Chat media URLs are bound to the project they were uploaded into
  const chatProject = url.match(/^\/api\/v1\/projects\/([^/]+)\/messages\/media\//)?.[1];
  if (chatProject && chatProject !== String(projectId)) return null;

  const own =await UploadedFile.findOne({ url, uploadedBy: new mongoose.Types.ObjectId(user.userId) });
  if (own) {
    const mimeType = inferMime(url, own.mimetype);
    return { url, name, type: mediaTypeFor(mimeType), mimeType, size: own.size, storageKey: raw?.storageKey };
  }

  const project = new mongoose.Types.ObjectId(projectId);
  const local = extractLocalFilename(url);
  const match: any = local ? new RegExp(`/${escapeRegex(local)}$`) : url;
  const [report, expense, payment, message] = await Promise.all([
    DailyReport.exists({ project, 'photos.url': match }),
    Expense.exists({ project, receiptUrl: match }),
    PaymentRequest.exists({ project, invoiceUrl: match }),
    ProjectMessage.exists({ project, 'attachments.url': match }),
  ]);
  if (!report && !expense && !payment && !message) return null;

  const mimeType = inferMime(url);
  return { url, name, type: mediaTypeFor(mimeType), mimeType, size: typeof raw?.size === 'number' && raw.size > 0 ? raw.size : undefined };
}

/** Record an externally stored (Cloudinary/R2) upload so it can later be validated as the caller's own. */
export async function recordExternalUpload(params: {
  url: string;
  uploadedBy: string;
  mimetype?: string;
  size?: number;
  storage?: StorageUploadResult;
}) {
  if (extractLocalFilename(params.url)) return recordUpload(params);
  try {
    const { storage: _storage, ...rest } = params;
    await UploadedFile.create({ filename: `ext:${params.url.slice(-120)}`, ...rest });
  } catch (err) {
    console.error('Failed to record external upload:', (err as Error).message);
  }
}

/**
 * Stream a file kept in private cloud storage. Call only AFTER authorization.
 * Returns false when the file is not in cloud storage (caller then 404s).
 */
export async function streamCloudFile(
  filename: string,
  req: Request,
  res: Response,
  opts: { download?: boolean } = {}
): Promise<boolean> {
  const record = await UploadedFile.findOne({ filename, provider: 'CLOUDINARY', storageKey: { $exists: true } });
  if (!record?.storageKey || !record.format) return false;

  const upstream = await storageService.fetchPrivateCloudinary(
    record.storageKey,
    record.resourceType || 'image',
    record.format,
    typeof req.headers.range === 'string' ? req.headers.range : undefined
  );
  if (!upstream.ok || !upstream.body) {
    console.error(`Cloud file fetch failed for ${filename}: ${upstream.status}`);
    return false;
  }

  res.status(upstream.status);
  res.setHeader('Content-Type', record.mimetype || upstream.headers.get('content-type') || 'application/octet-stream');
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3000');
  res.setHeader('Content-Disposition', `${opts.download ? 'attachment' : 'inline'}; filename="${filename}"`);
  const { Readable } = await import('stream');
  Readable.fromWeb(upstream.body as any).pipe(res);
  return true;
}
