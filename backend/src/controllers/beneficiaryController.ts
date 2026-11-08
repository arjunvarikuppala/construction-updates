import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest, isMD } from '../types/index.js';
import { Beneficiary, maskAccountNumber, PayeeType } from '../models/Beneficiary.js';
import { IProject } from '../models/Project.js';
import { razorpayXService } from '../services/payments/razorpayXService.js';
import { logAudit } from '../services/auditService.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { getCompanyIdsForUser, getCompanyInChargeIds } from '../services/tenantService.js';
import { escapeRegex } from '../utils/validation.js';

/** The company (MD user id) that owns a project: the explicit owner, else the creator. */
export function getProjectCompanyId(project: Pick<IProject, 'owner' | 'createdBy'>): string {
  return String(project.owner || project.createdBy);
}

/**
 * Mongo filter limiting beneficiaries to the given companies.
 * Legacy rows created before the `company` field existed are matched by their
 * creator being the company's MD or one of the company's In-Charges.
 */
export async function beneficiaryScopeFilter(companyIds: string[]) {
  const ids = companyIds.filter(Boolean).map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length === 0) return { _id: { $in: [] as mongoose.Types.ObjectId[] } };
  const members = new Set<string>(ids.map(String));
  for (const companyId of ids) {
    (await getCompanyInChargeIds(String(companyId))).forEach((m) => members.add(String(m)));
  }
  return {
    $or: [
      { company: { $in: ids } },
      {
        company: { $exists: false },
        createdBy: { $in: Array.from(members).map((m) => new mongoose.Types.ObjectId(m)) },
      },
    ],
  };
}

/** Resolve which company a new beneficiary belongs to for the calling user. */
async function resolveCompanyForCreate(req: AuthenticatedRequest): Promise<string | null> {
  const user = req.user!;
  if (isMD(user.role)) return user.userId;
  const projectId = req.body.projectId || req.body.project;
  if (projectId) {
    const access = await verifyUserProjectAccess(String(projectId), user.userId, user.role);
    return access.allowed && access.project ? getProjectCompanyId(access.project) : null;
  }
  const companies = await getCompanyIdsForUser(user);
  return companies.length === 1 ? companies[0] : null;
}

async function findScopedBeneficiary(req: AuthenticatedRequest, withAccountNumber = false) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
  const scope = await beneficiaryScopeFilter(await getCompanyIdsForUser(req.user!));
  const q = Beneficiary.findOne({ $and: [{ _id: id }, scope] });
  return withAccountNumber ? q.select('+accountNumber') : q.select('-accountNumber');
}

export async function createBeneficiary(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { name, payeeType, accountNumber, ifsc, vpa, phone, email, bankName } = req.body;

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, message: 'Beneficiary name is required.' });
      return;
    }

    const validPayeeTypes: PayeeType[] = ['CONTRACTOR', 'SUPPLIER', 'LABOUR'];
    if (!validPayeeTypes.includes(payeeType)) {
      res.status(400).json({
        success: false,
        message: `Invalid payee type. Allowed: ${validPayeeTypes.join(', ')}`,
      });
      return;
    }

    let cleanAccount = accountNumber ? String(accountNumber).replace(/\s+/g, '').trim() : undefined;
    let cleanIFSC = ifsc ? String(ifsc).trim().toUpperCase() : undefined;
    let cleanVpa = vpa ? String(vpa).trim().toLowerCase() : undefined;

    // Must provide either Bank Account + IFSC or UPI VPA
    if (!cleanVpa && (!cleanAccount || !cleanIFSC)) {
      res.status(400).json({
        success: false,
        message: 'Please provide either Bank Account & IFSC code, or a valid UPI ID (VPA).',
      });
      return;
    }

    if (cleanAccount) {
      if (!/^\d{8,22}$/.test(cleanAccount)) {
        res.status(400).json({
          success: false,
          message: 'Invalid account number. Must contain between 8 and 22 numeric digits.',
        });
        return;
      }
    }

    if (cleanIFSC) {
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIFSC)) {
        res.status(400).json({
          success: false,
          message: 'Invalid IFSC format. Must be 11 characters (e.g. SBIN0001234, HDFC0000240).',
        });
        return;
      }
    }

    if (cleanVpa) {
      if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(cleanVpa)) {
        res.status(400).json({
          success: false,
          message: 'Invalid UPI ID format. Expected format: username@bank (e.g. contractor@okhdfcbank)',
        });
        return;
      }
    }

    const resolvedBankName =
      bankName?.trim() ||
      (cleanIFSC ? `${cleanIFSC.slice(0, 4)} Bank` : cleanVpa ? `UPI (${cleanVpa.split('@')[1] || 'Provider'})` : 'Bank');

    const masked = cleanAccount ? maskAccountNumber(cleanAccount) : undefined;

    const companyId = await resolveCompanyForCreate(req);
    if (!companyId) {
      res.status(400).json({
        success: false,
        message: 'Select the project this payee belongs to before registering the beneficiary.',
      });
      return;
    }

    const beneficiary = await Beneficiary.create({
      name: name.trim(),
      payeeType,
      accountNumber: cleanAccount,
      accountNumberMasked: masked,
      ifsc: cleanIFSC,
      bankName: resolvedBankName,
      vpa: cleanVpa,
      phone: phone?.trim(),
      email: email?.trim(),
      verificationStatus: 'UNVERIFIED',
      createdBy: req.user!.userId,
      company: companyId,
    });

    await logAudit('BENEFICIARY_CREATED', req.user!.userId, 'BENEFICIARY', beneficiary._id, {
      name: beneficiary.name,
      payeeType: beneficiary.payeeType,
      accountNumberMasked: masked,
      ifsc: cleanIFSC,
      vpa: cleanVpa,
    });

    res.status(201).json({
      success: true,
      message: 'Beneficiary account registered successfully',
      beneficiary: {
        id: beneficiary._id,
        _id: beneficiary._id,
        name: beneficiary.name,
        payeeType: beneficiary.payeeType,
        accountNumberMasked: beneficiary.accountNumberMasked,
        ifsc: beneficiary.ifsc,
        bankName: beneficiary.bankName,
        vpa: beneficiary.vpa,
        phone: beneficiary.phone,
        email: beneficiary.email,
        verificationStatus: beneficiary.verificationStatus,
        createdAt: beneficiary.createdAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create beneficiary', error: err.message });
  }
}

export async function listBeneficiaries(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { payeeType, search, verificationStatus } = req.query;

    const query: any = { isActive: true };

    if (typeof payeeType === 'string' && payeeType !== 'ALL') {
      query.payeeType = payeeType;
    }

    if (typeof verificationStatus === 'string' && verificationStatus !== 'ALL') {
      query.verificationStatus = verificationStatus;
    }

    if (search) {
      const s = escapeRegex(String(search).trim());
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { ifsc: { $regex: s, $options: 'i' } },
        { bankName: { $regex: s, $options: 'i' } },
        { vpa: { $regex: s, $options: 'i' } },
      ];
    }

    // Exclude raw full account number in list views for security
    const scope = await beneficiaryScopeFilter(await getCompanyIdsForUser(req.user!));
    const beneficiaries = await Beneficiary.find({ $and: [query, scope] })
      .select('-accountNumber')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: beneficiaries.length,
      beneficiaries,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to list beneficiaries', error: err.message });
  }
}

export async function getBeneficiaryById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const beneficiary = await findScopedBeneficiary(req);
    if (!beneficiary) {
      res.status(404).json({ success: false, message: 'Beneficiary not found' });
      return;
    }

    res.json({ success: true, beneficiary });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch beneficiary', error: err.message });
  }
}

export async function validateBeneficiaryAccount(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!isMD(req.user!.role)) {
      res.status(403).json({ success: false, message: 'Only Managing Directors can verify beneficiary accounts.' });
      return;
    }

    const beneficiary = await findScopedBeneficiary(req, true);

    if (!beneficiary) {
      res.status(404).json({ success: false, message: 'Beneficiary not found' });
      return;
    }

    const result = await razorpayXService.validateBeneficiary(beneficiary);

    beneficiary.verificationStatus = result.isValid ? 'VERIFIED' : 'FAILED';
    if (result.registeredName) beneficiary.verifiedName = result.registeredName;
    if (result.bankName) beneficiary.bankName = result.bankName;
    if (result.validationId) beneficiary.pennyDropValidationId = result.validationId;

    beneficiary.verificationDetails = {
      accountExists: result.accountExists,
      providerRef: result.validationId,
      verifiedAt: new Date(),
      failureReason: result.failureReason,
    };

    await beneficiary.save();

    await logAudit(
      result.isValid ? 'BENEFICIARY_VERIFIED' : 'BENEFICIARY_VERIFICATION_FAILED',
      req.user!.userId,
      'BENEFICIARY',
      beneficiary._id,
      {
        verificationStatus: beneficiary.verificationStatus,
        providerRef: result.validationId,
        failureReason: result.failureReason,
      }
    );

    res.json({
      success: true,
      message: result.isValid
        ? 'Beneficiary verified successfully'
        : `Beneficiary validation failed: ${result.failureReason || 'Account invalid'}`,
      verification: {
        status: beneficiary.verificationStatus,
        verifiedName: beneficiary.verifiedName,
        bankName: beneficiary.bankName,
        failureReason: result.failureReason,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to validate beneficiary bank account',
      error: err.message,
    });
  }
}
