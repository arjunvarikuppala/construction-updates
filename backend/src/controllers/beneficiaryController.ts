import { Response } from 'express';
import { AuthenticatedRequest } from '../types/index.js';
import { Beneficiary, maskAccountNumber, PayeeType } from '../models/Beneficiary.js';
import { razorpayXService } from '../services/payments/razorpayXService.js';
import { logAudit } from '../services/auditService.js';

export async function createBeneficiary(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { name, payeeType, accountNumber, ifsc, phone, email, bankName } = req.body;

    if (!name || !payeeType || !accountNumber || !ifsc) {
      res.status(400).json({
        success: false,
        message: 'Name, payeeType, accountNumber, and IFSC code are required.',
      });
      return;
    }

    const cleanAccount = String(accountNumber).replace(/\s+/g, '').trim();
    const cleanIFSC = String(ifsc).trim().toUpperCase();

    if (!/^\d{8,22}$/.test(cleanAccount)) {
      res.status(400).json({
        success: false,
        message: 'Invalid account number. Must contain between 8 and 22 numeric digits.',
      });
      return;
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIFSC)) {
      res.status(400).json({
        success: false,
        message: 'Invalid IFSC format. Must be 11 characters (e.g. SBIN0001234, HDFC0000240).',
      });
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

    // Auto-resolve bank name from IFSC or use provided
    const resolvedBankName =
      bankName?.trim() || `${cleanIFSC.slice(0, 4)} Bank`;

    const masked = maskAccountNumber(cleanAccount);

    const beneficiary = await Beneficiary.create({
      name: name.trim(),
      payeeType,
      accountNumber: cleanAccount,
      accountNumberMasked: masked,
      ifsc: cleanIFSC,
      bankName: resolvedBankName,
      phone: phone?.trim(),
      email: email?.trim(),
      verificationStatus: 'UNVERIFIED',
      createdBy: req.user!.userId,
    });

    await logAudit('BENEFICIARY_CREATED', req.user!.userId, 'BENEFICIARY', beneficiary._id, {
      name: beneficiary.name,
      payeeType: beneficiary.payeeType,
      accountNumberMasked: masked,
      ifsc: cleanIFSC,
    });

    res.status(201).json({
      success: true,
      message: 'Beneficiary account created successfully',
      beneficiary: {
        id: beneficiary._id,
        name: beneficiary.name,
        payeeType: beneficiary.payeeType,
        accountNumberMasked: beneficiary.accountNumberMasked,
        ifsc: beneficiary.ifsc,
        bankName: beneficiary.bankName,
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

    if (payeeType && payeeType !== 'ALL') {
      query.payeeType = payeeType;
    }

    if (verificationStatus && verificationStatus !== 'ALL') {
      query.verificationStatus = verificationStatus;
    }

    if (search) {
      const s = String(search).trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { ifsc: { $regex: s, $options: 'i' } },
        { bankName: { $regex: s, $options: 'i' } },
      ];
    }

    // Exclude raw full account number in list views for security
    const beneficiaries = await Beneficiary.find(query)
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
    const { id } = req.params;
    const beneficiary = await Beneficiary.findById(id).select('-accountNumber');
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
    const { id } = req.params;
    const beneficiary = await Beneficiary.findById(id);

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
        ? 'Beneficiary bank account verified successfully via Penny Drop'
        : `Beneficiary verification failed: ${result.failureReason || 'Account invalid'}`,
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
