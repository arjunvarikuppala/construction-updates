/**
 * Recover files that the live database points to but the live server cannot find.
 *
 * How this happens: the API ran on a laptop while connected to the LIVE database.
 * Message / report / expense records went into the live database, but their files
 * were saved to that laptop's backend/uploads folder, which the live server can't see,
 * so the app shows "File no longer available".
 *
 * This script finds every file referenced by the database, and for each one that is not
 * in Cloudinary yet but IS in a local uploads folder, uploads it to Cloudinary (private,
 * same naming as the app) and records it, so the live app serves it again.
 * Stored URLs in messages/reports are NOT changed.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/migrate-local-uploads.ts --env .env.migrate            # dry run: report only
 *   npx tsx src/scripts/migrate-local-uploads.ts --env .env.migrate --apply    # upload + record
 *
 * .env.migrate must contain the LIVE values (copy from Render → API service → Environment):
 *   MONGODB_URI=...
 *   CLOUDINARY_CLOUD_NAME=...
 *   CLOUDINARY_API_KEY=...
 *   CLOUDINARY_API_SECRET=...
 * Optional: UPLOADS_DIR=path/to/uploads (default: backend/uploads)
 *
 * Local files are never deleted. Safe to run more than once (already-recovered files are skipped).
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
const envFile = envIdx >= 0 ? args[envIdx + 1] : undefined;
const APPLY = args.includes('--apply');

if (!envFile || !fs.existsSync(envFile)) {
  console.error('Pass --env <file> with the LIVE MONGODB_URI and CLOUDINARY_* values. See the header of this script.');
  process.exit(1);
}
const env = dotenv.parse(fs.readFileSync(envFile));
for (const key of ['MONGODB_URI', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
  if (!env[key]?.trim()) {
    console.error(`Missing ${key} in ${envFile}`);
    process.exit(1);
  }
}
const UPLOADS_DIR = path.resolve(env.UPLOADS_DIR || path.resolve(process.cwd(), 'uploads'));

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME.trim(),
  api_key: env.CLOUDINARY_API_KEY.trim(),
  api_secret: env.CLOUDINARY_API_SECRET.trim(),
  secure: true,
});

const LOCAL_UPLOAD_RE = /^\/uploads\/([^/?#]+)$/;
const CHAT_MEDIA_RE = /^\/api\/v1\/projects\/[^/]+\/messages\/media\/([^/?#]+)$/;
function filenameOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(LOCAL_UPLOAD_RE) || clean.match(CHAT_MEDIA_RE);
  if (!m) return null;
  const name = path.basename(decodeURIComponent(m[1]));
  return name && name !== '.' && name !== '..' ? name : null;
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.3gp': 'video/3gpp', '.avi': 'video/avi', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
};

interface Ref {
  url: string;
  owner?: mongoose.Types.ObjectId;
  where: string;
}

async function main() {
  await mongoose.connect(env.MONGODB_URI.trim());
  const db = mongoose.connection.db!;
  console.log(`Connected to database "${db.databaseName}". Mode: ${APPLY ? 'APPLY (uploading)' : 'DRY RUN (no changes)'}`);
  console.log(`Looking for local files in: ${UPLOADS_DIR}\n`);

  // 1. Every file the database points to
  const refs = new Map<string, Ref>();
  const add = (url: unknown, owner: any, where: string) => {
    const name = filenameOf(url);
    if (name && !refs.has(name)) refs.set(name, { url: String(url), owner, where });
  };
  for await (const m of db.collection('projectmessages').find({ 'attachments.0': { $exists: true } }, { projection: { attachments: 1, sender: 1 } })) {
    for (const a of m.attachments || []) {
      add(a.url, m.sender, 'chat');
      add(a.thumbnailUrl, m.sender, 'chat preview');
    }
  }
  for await (const r of db.collection('dailyreports').find({ 'photos.0': { $exists: true } }, { projection: { photos: 1, submittedBy: 1 } })) {
    for (const p of r.photos || []) add(p.url, r.submittedBy, 'daily report');
  }
  for await (const e of db.collection('expenses').find({ receiptUrl: { $nin: [null, ''] } }, { projection: { receiptUrl: 1, submittedBy: 1 } })) {
    add(e.receiptUrl, e.submittedBy, 'expense receipt');
  }
  for await (const p of db.collection('paymentrequests').find({}, { projection: { invoiceUrl: 1, settlements: 1, createdBy: 1 } })) {
    add(p.invoiceUrl, p.createdBy, 'payment invoice');
    for (const s of p.settlements || []) add(s.proofUrl, p.createdBy, 'payment proof');
  }

  // 2. Classify and recover
  const counts = { inCloud: 0, recovered: 0, wouldRecover: 0, lost: 0, failed: 0 };
  const lost: string[] = [];
  const files = db.collection('uploadedfiles');

  for (const [filename, ref] of refs) {
    const inCloud = await files.findOne({ filename, provider: 'CLOUDINARY', storageKey: { $exists: true } });
    if (inCloud) {
      counts.inCloud++;
      continue;
    }
    const localPath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(localPath)) {
      counts.lost++;
      lost.push(`${ref.where}: ${filename}`);
      continue;
    }
    if (!APPLY) {
      counts.wouldRecover++;
      console.log(`would upload  ${ref.where}: ${filename}`);
      continue;
    }
    try {
      const up = await cloudinary.uploader.upload(localPath, {
        folder: 'sitetrack',
        resource_type: 'auto',
        type: 'private',
        public_id: filename.replace(/\.[^.]+$/, ''),
        overwrite: false,
      });
      const ext = path.extname(filename).toLowerCase();
      const cloudFields = {
        provider: 'CLOUDINARY',
        storageKey: up.public_id,
        resourceType: up.resource_type,
        format: up.format || ext.slice(1),
        size: up.bytes || fs.statSync(localPath).size,
        mimetype: MIME[ext] || 'application/octet-stream',
      };
      const existing = await files.updateMany({ filename }, { $set: { ...cloudFields, updatedAt: new Date() } });
      if (existing.matchedCount === 0) {
        if (!ref.owner) throw new Error('no owner found to record the file under');
        await files.insertOne({
          filename,
          url: ref.url,
          uploadedBy: ref.owner,
          ...cloudFields,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      counts.recovered++;
      console.log(`uploaded      ${ref.where}: ${filename}`);
    } catch (err) {
      counts.failed++;
      console.error(`FAILED        ${ref.where}: ${filename} — ${(err as Error).message}`);
    }
  }

  console.log('\n----- Summary -----');
  console.log(`Files referenced by the database: ${refs.size}`);
  console.log(`Already in Cloudinary:            ${counts.inCloud}`);
  if (APPLY) console.log(`Recovered now:                    ${counts.recovered}`);
  else console.log(`Can be recovered (run --apply):   ${counts.wouldRecover}`);
  console.log(`Failed:                           ${counts.failed}`);
  console.log(`Lost (no copy anywhere):          ${counts.lost}`);
  lost.forEach((l) => console.log(`  - ${l}`));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
