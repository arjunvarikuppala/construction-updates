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
    });
  } catch (err) {
    console.error('Failed to record upload ownership:', (err as Error).message);
  }
}
