import { Router, Response } from 'express';
import { upload } from '../middleware/upload.js';
import { authenticate } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../types/index.js';

const router = Router();

router.use(authenticate);

// Single file upload (receipts)
router.post('/single', upload.single('file'), (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'No file uploaded' });
    return;
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    fileUrl,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

// Multiple files upload (site photos)
router.post('/multiple', upload.array('files', 10), (req: AuthenticatedRequest, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ success: false, message: 'No files uploaded' });
    return;
  }

  const uploadedFiles = files.map((file) => ({
    url: `/uploads/${file.filename}`,
    filename: file.filename,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
  }));

  res.json({
    success: true,
    count: uploadedFiles.length,
    files: uploadedFiles,
  });
});

export default router;
