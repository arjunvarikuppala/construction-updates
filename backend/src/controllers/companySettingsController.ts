import { Response } from 'express';
import { AuthenticatedRequest, isMD } from '../types/index.js';
import { CompanySettings } from '../models/CompanySettings.js';
import { getCompanyIdsForUser } from '../services/tenantService.js';
import { isValidGstin, gstinStateCode } from '../services/gstService.js';
import { logAudit } from '../services/auditService.js';

const publicView = (s: any) => ({
  legalName: s?.legalName || '',
  gstin: s?.gstin || '',
  address: s?.address || '',
  stateCode: gstinStateCode(s?.gstin) || null,
});

/** GET /api/v1/company-settings — the caller's company (MD: own; In-Charge: their MD's). */
export async function getCompanySettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const [companyId] = await getCompanyIdsForUser(req.user!);
    const settings = companyId ? await CompanySettings.findOne({ owner: companyId }) : null;
    res.json({ success: true, settings: publicView(settings) });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to load company settings' });
  }
}

/** PUT /api/v1/company-settings — MD only. */
export async function updateCompanySettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!isMD(req.user!.role)) {
      res.status(403).json({ success: false, message: 'Only the Managing Director can change company settings.' });
      return;
    }
    const { legalName, gstin, address } = req.body || {};
    const cleanGstin = typeof gstin === 'string' ? gstin.trim().toUpperCase() : '';
    if (cleanGstin && !isValidGstin(cleanGstin)) {
      res.status(400).json({ success: false, message: 'GSTIN is invalid. It must be 15 characters, e.g. 36AABCU9603R1ZO.' });
      return;
    }
    const settings = await CompanySettings.findOneAndUpdate(
      { owner: req.user!.userId },
      {
        legalName: typeof legalName === 'string' ? legalName.trim().slice(0, 150) : '',
        gstin: cleanGstin || undefined,
        address: typeof address === 'string' ? address.trim().slice(0, 500) : '',
        updatedBy: req.user!.userId,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await logAudit('COMPANY_SETTINGS_UPDATED', req.user!.userId, 'COMPANY', settings._id, {
      gstinSet: Boolean(cleanGstin),
    });
    res.json({ success: true, settings: publicView(settings) });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to save company settings' });
  }
}
