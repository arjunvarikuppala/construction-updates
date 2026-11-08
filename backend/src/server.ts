import './config/env.js';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import dailyReportRoutes from './routes/dailyReportRoutes.js';
import expenseRoutes from './routes/expenseRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import exportRoutes from './routes/exportRoutes.js';
import userRoutes from './routes/userRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import communicationRoutes from './routes/communicationRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import companySettingsRoutes from './routes/companySettingsRoutes.js';
import { fileApiRouter, serveSignedUpload } from './routes/fileRoutes.js';
import { initSocketService } from './services/socketService.js';
import { seedInitialData } from './scripts/seed.js';
import { sanitizeErrorResponses, globalErrorHandler } from './middleware/errorHandling.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Render / Vercel sit behind one proxy hop; needed for correct client IPs in rate limiting
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 5000;

// ---------------------------------------------------------------------------
// CORS origin resolver — reads CORS_ORIGIN env var (comma-separated list).
// Falls back to permissive '*' ONLY in non-production environments so that
// local development continues to work with no configuration.
// In production, CORS_ORIGIN MUST be set to the exact Vercel origin, e.g.:
//   CORS_ORIGIN=https://sitetrack.vercel.app,http://localhost:5173
// ---------------------------------------------------------------------------
function getAllowedOrigins(): string[] | string {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (raw) {
    return raw.split(',').map((o) => o.trim()).filter(Boolean);
  }
  // No CORS_ORIGIN configured — allow any origin in development only
  if (process.env.NODE_ENV !== 'production') {
    return '*';
  }
  // Production without CORS_ORIGIN set: deny all (fail safe)
  console.warn('⚠️  CORS_ORIGIN is not set in production. Cross-origin requests will be blocked.');
  return [];
}

export const allowedOrigins = getAllowedOrigins();

// Initialize Socket.IO Server (must happen before express middleware)
initSocketService(httpServer, allowedOrigins);

// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allows uploaded images/receipts to load in browser
  })
);

// Dynamic CORS: when credentials are carried (Authorization header), the
// response 'Access-Control-Allow-Origin' must be the exact requesting origin,
// not the wildcard '*'. Modern browsers enforce this per the Fetch spec.
app.use(
  cors({
    origin: (requestOrigin, callback) => {
      // Allow server-to-server requests (no Origin header)
      if (!requestOrigin) return callback(null, true);

      const allowed = allowedOrigins;
      if (allowed === '*') return callback(null, true);

      if (Array.isArray(allowed) && allowed.includes(requestOrigin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS policy: Origin '${requestOrigin}' is not permitted.`));
    },
    credentials: true,
  })
);

// Rate limiter for API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

app.use('/api', apiLimiter);

// Never leak internal error details to clients
app.use(sanitizeErrorResponses);

// Logger & Parsers (Capture rawBody for cryptographic webhook signature verification)
// Morgan's 'dev' format logs only method/url/status/time — no headers or bodies.
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(
  express.json({
    limit: '5mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Private uploads: only served with a short-lived signed URL issued by
// POST /api/v1/files/sign after a project-level authorization check.
const uploadsPath = path.resolve(process.cwd(), 'uploads');
app.get('/uploads/:filename', serveSignedUpload);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'online',
    app: 'BKR INFRA Site Reports & Payments',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/projects', projectRoutes); // Backward-compatible route alias
app.use('/api/v1/daily-reports', dailyReportRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/export', exportRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/uploads', uploadRoutes);
app.use('/api/v1/audit-logs', auditRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/projects/:projectId/messages', communicationRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/company-settings', companySettingsRoutes);
app.use('/api/v1/files', fileApiRouter);

// Unknown API routes
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found' });
});

// Global Error Handler (safe client messages, full detail in server logs)
app.use(globalErrorHandler);

// Bootstrap server
export async function startServer() {
  await connectDB();

  // Demo seeding is strictly disabled in production and only runs if explicitly flagged in development
  if (process.env.SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production') {
    await seedInitialData();
  }

  // Bind explicitly to 0.0.0.0 so Render's health check can reach the process
  // on all network interfaces (not just loopback / IPv6).
  httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 SiteTrack Backend API running on http://localhost:${PORT}`);
    console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`🔌 WebSockets: Socket.IO Server active on port ${PORT}`);
    console.log(`📁 Uploads Directory: ${uploadsPath}`);
    console.log(`======================================================\n`);
  });
}

// Tests import `app` directly and manage their own database connection.
if (process.env.SITETRACK_NO_LISTEN !== 'true') {
  startServer().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}

export default app;
