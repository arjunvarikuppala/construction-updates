import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load backend/.env safely regardless of where node process was launched
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export const isProduction = process.env.NODE_ENV === 'production';

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Validates required secrets at boot. In production, missing or weak secrets
 * abort startup rather than silently falling back to a known value.
 * In development/test a random per-process JWT secret is generated (sessions
 * are invalidated on restart) — there is never a hardcoded fallback.
 */
function resolveJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured && configured.length >= MIN_JWT_SECRET_LENGTH) return configured;

  if (isProduction) {
    console.error(
      `FATAL: JWT_SECRET must be set to a random string of at least ${MIN_JWT_SECRET_LENGTH} characters in production.`
    );
    process.exit(1);
  }

  if (configured) {
    console.warn(
      `⚠️  JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters. Using it for development only — never in production.`
    );
    return configured;
  }

  console.warn('⚠️  JWT_SECRET not set. Generated a random development secret; sessions reset on every restart.');
  return crypto.randomBytes(48).toString('hex');
}

const jwtSecret = resolveJwtSecret();

if (isProduction) {
  if (!process.env.MONGODB_URI?.trim()) {
    console.error('FATAL: MONGODB_URI is required in production.');
    process.exit(1);
  }
  if (!process.env.CORS_ORIGIN?.trim()) {
    console.warn('⚠️  CORS_ORIGIN is not set in production. Cross-origin browser requests will be blocked.');
  }
  if (process.env.PAYMENTS_LIVE_ENABLED === 'true' && !process.env.RAZORPAYX_WEBHOOK_SECRET?.trim()) {
    console.error('FATAL: RAZORPAYX_WEBHOOK_SECRET is required when PAYMENTS_LIVE_ENABLED=true.');
    process.exit(1);
  }
}

export function getJwtSecret(): string {
  return jwtSecret;
}

/** Secret used to sign short-lived private file URLs. Derived so no extra env var is required. */
export function getFileSigningSecret(): string {
  return crypto.createHash('sha256').update(`sitetrack-file-url:${jwtSecret}`).digest('hex');
}
