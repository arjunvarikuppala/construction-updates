import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

/**
 * Strips internal error details from every JSON error response.
 *
 * Controllers historically returned `{ error: err.message }` (and sometimes
 * whole error objects). This middleware removes `error`/`stack` from any
 * response with status >= 400, logs them server-side, and replaces the
 * message of 5xx responses that look like raw exceptions.
 */
export function sanitizeErrorResponses(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = (body?: any) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      const { error, stack, ...safe } = body;
      if (error !== undefined || stack !== undefined) {
        const detail = error instanceof Error ? error.stack || error.message : typeof error === 'string' ? error : JSON.stringify(error);
        console.error(`[${req.method} ${req.originalUrl}] ${res.statusCode}: ${safe.message || ''} :: ${detail || stack || ''}`);
      }
      if (res.statusCode >= 500 && typeof safe.message !== 'string') {
        safe.message = 'An internal server error occurred. Please try again.';
      }
      return originalJson(safe);
    }
    return originalJson(body);
  };

  next();
}

/** Final error handler: safe messages for clients, full details in server logs only. */
export function globalErrorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  let status = Number(err?.status || err?.statusCode) || 500;
  let message = 'An internal server error occurred. Please try again.';

  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : 'File upload rejected.';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large.';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON request body.';
  } else if (err?.expose || (status >= 400 && status < 500)) {
    message = typeof err?.message === 'string' ? err.message : 'Request could not be processed.';
  } else if (typeof err?.message === 'string' && err.message.startsWith('CORS policy')) {
    status = 403;
    message = 'Origin not permitted.';
  }

  if (status >= 500) {
    console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  } else {
    // Expected client mistakes (bad file type, bad JSON…): one line, no stack trace
    console.warn(`${status} on ${req.method} ${req.originalUrl}: ${message}`);
  }
  if (res.headersSent) return;
  res.status(status).json({ success: false, message });
}
