import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getCompanySettings, updateCompanySettings } from '../controllers/companySettingsController.js';

const router = Router();
router.use(authenticate);

// Readable by the MD and their In-Charges (needed to split CGST/SGST vs IGST); editable by the MD only
router.get('/', getCompanySettings);
router.put('/', updateCompanySettings);

export default router;
