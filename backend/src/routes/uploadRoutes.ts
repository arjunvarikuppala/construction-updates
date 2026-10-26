import { Router, Response } from 'express';
import { upload } from '../middleware/upload.js';
import { authenticate } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../types/index.js';
import { storageService } from '../services/storageService.js';

const router = Router();

router.use(authenticate);

// Get current storage backend status (Cloudflare R2 vs Local)
router.get('/storage-status', (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    r2Enabled: storageService.isR2Enabled(),
    storageProvider: storageService.isR2Enabled() ? 'Cloudflare R2 Cloud Storage (S3-compatible)' : 'Local Disk Storage (/uploads)',
  });
});

// Presigned URL generator for direct-to-R2 upload (bypasses Node.js server RAM for 200MB+ videos)
router.get('/presigned-url', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const filename = String(req.query.filename || 'site-media.mp4');
    const mimetype = String(req.query.mimetype || 'video/mp4');

    const presigned = await storageService.getPresignedUploadUrl(filename, mimetype);
    if (!presigned) {
      res.status(400).json({
        success: false,
        message: 'Cloudflare R2 storage is not configured for direct presigned uploads. Use standard multipart upload instead.',
      });
      return;
    }

    res.json({
      success: true,
      ...presigned,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to generate presigned upload URL', error: error.message });
  }
});

// Single file upload (receipts, photos, videos)
router.post('/single', upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'No file uploaded' });
    return;
  }

  try {
    const result = await storageService.uploadFile(req.file.path, req.file.filename, req.file.mimetype);

    res.json({
      success: true,
      fileUrl: result.url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: result.size,
      mimetype: result.mimetype,
      storage: storageService.isR2Enabled() ? 'R2' : 'LOCAL',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to store uploaded file', error: error.message });
  }
});

// Multiple files upload (site photos & videos)
router.post('/multiple', upload.array('files', 15), async (req: AuthenticatedRequest, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ success: false, message: 'No files uploaded' });
    return;
  }

  try {
    const uploadedFiles = await Promise.all(
      files.map(async (file) => {
        const result = await storageService.uploadFile(file.path, file.filename, file.mimetype);
        return {
          url: result.url,
          filename: file.filename,
          originalName: file.originalname,
          size: result.size,
          mimetype: result.mimetype,
          storage: storageService.isR2Enabled() ? 'R2' : 'LOCAL',
        };
      })
    );

    res.json({
      success: true,
      count: uploadedFiles.length,
      files: uploadedFiles,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to store uploaded files', error: error.message });
  }
});

export default router;
