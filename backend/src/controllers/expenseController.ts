import { Response } from 'express';
import { sanitizeGstBill, getCompanyGstinForProject } from '../services/gstService.js';
import mongoose from 'mongoose';
import { Expense } from '../models/Expense.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { AuthenticatedRequest, isMD, isSiteInCharge } from '../types/index.js';
import { logAudit } from '../services/auditService.js';
import { rupeesToPaise } from '../utils/currency.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { getAccessibleProjectIds } from '../services/tenantService.js';
import { escapeRegex, parseDate } from '../utils/validation.js';
import { EXPENSE_CATEGORIES, isAcceptableMediaUrl } from '../services/reportService.js';

export async function listExpenses(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = req.user!;
    const { projectId, status, category, startDate, endDate, search } = req.query;

    let query: any = {};

    if (projectId) {
      const accessCheck = await verifyUserProjectAccess(String(projectId), user.userId, user.role);
      if (!accessCheck.allowed || !accessCheck.project) {
        res.status(403).json({ success: false, message: 'Forbidden. You do not have access to this project.' });
        return;
      }
      query.project = accessCheck.project._id;
    } else {
      query.project = { $in: await getAccessibleProjectIds(user) };
    }

    if (typeof status === 'string' && status !== 'ALL') {
      query.status = status;
    }

    // Draft expenses are private to the person who created them
    if (query.status !== 'PENDING' && query.status !== 'APPROVED' && query.status !== 'REJECTED') {
      query.$and = [{ $or: [{ status: { $ne: 'DRAFT' } }, { submittedBy: new mongoose.Types.ObjectId(user.userId) }] }];
    }

    if (typeof category === 'string' && category !== 'ALL') {
      query.category = category;
    }

    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (start || end) {
      query.date = {};
      if (start) query.date.$gte = start;
      if (end) {
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    if (req.query.dailyReport && mongoose.Types.ObjectId.isValid(String(req.query.dailyReport))) {
      query.dailyReport = new mongoose.Types.ObjectId(String(req.query.dailyReport));
    }

    if (search) {
      const searchStr = escapeRegex(String(search).trim());
      query.$or = [
        { description: { $regex: searchStr, $options: 'i' } },
        { vendor: { $regex: searchStr, $options: 'i' } },
      ];
    }

    const expenses = await Expense.find(query)
      .populate('project', 'name code location budget')
      .populate('submittedBy', 'name email role')
      .populate('reviewedBy', 'name email role')
      .sort({ date: -1, createdAt: -1 });

    res.json({ success: true, count: expenses.length, expenses });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to list expenses', error: error.message });
  }
}

export async function getExpenseById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const expense = await Expense.findById(id)
      .populate('project', 'name code location budget assignedInCharge')
      .populate('submittedBy', 'name email')
      .populate('reviewedBy', 'name email');

    if (!expense) {
      res.status(404).json({ success: false, message: 'Expense record not found' });
      return;
    }

    const accessCheck = await verifyUserProjectAccess((expense.project as any)._id, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You cannot view this expense.' });
      return;
    }

    res.json({ success: true, expense });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch expense', error: error.message });
  }
}

export async function createExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      project,
      date,
      category,
      description,
      amount,
      vendor,
      receiptUrl,
      status = 'PENDING',
    } = req.body;

    if (!project || !date || !category || !description || amount === undefined || !vendor) {
      res.status(400).json({ success: false, message: 'Missing required expense details' });
      return;
    }

    if (typeof description !== 'string' || typeof vendor !== 'string' || !EXPENSE_CATEGORIES.includes(category)) {
      res.status(400).json({ success: false, message: 'Invalid expense category, description or vendor' });
      return;
    }

    if (!parseDate(date)) {
      res.status(400).json({ success: false, message: 'A valid expense date is required' });
      return;
    }

    if (receiptUrl && !isAcceptableMediaUrl(receiptUrl)) {
      res.status(400).json({ success: false, message: 'Receipt attachment is invalid. Please re-upload it.' });
      return;
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
      return;
    }

    const accessCheck = await verifyUserProjectAccess(project, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You are not authorized to submit expenses for this project.' });
      return;
    }

    const projectDoc = accessCheck.project!;

    // GST bill: the total is taxable value + GST, computed here (never trusted from the client)
    const gstResult = sanitizeGstBill(req.body.gst, await getCompanyGstinForProject(projectDoc._id), 'GST bill');
    if (gstResult.errors.length) {
      res.status(400).json({ success: false, message: gstResult.errors[0], errors: gstResult.errors });
      return;
    }

    const amountInPaise = gstResult.totalPaise ?? (req.body.isPaise === true ? numericAmount : rupeesToPaise(numericAmount));
    if (!Number.isInteger(amountInPaise) || amountInPaise < 100) {
      res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
      return;
    }

    const expenseDate = new Date(date);
    const startOfDay = new Date(expenseDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(expenseDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Prevent duplicate submissions within same project, same vendor, same amount on the same calendar day
    const duplicateCheck = await Expense.findOne({
      project: projectDoc._id,
      vendor: vendor.trim(),
      amount: amountInPaise,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['PENDING', 'APPROVED'] },
    });

    if (duplicateCheck) {
      res.status(409).json({
        success: false,
        message: 'A duplicate expense with the exact same vendor, amount, and date is already pending or approved.',
      });
      return;
    }

    const expense = await Expense.create({
      project: projectDoc._id,
      submittedBy: req.user!.userId,
      date: expenseDate,
      category,
      description: description.trim(),
      amount: amountInPaise,
      vendor: vendor.trim(),
      receiptUrl: receiptUrl?.trim(),
      gst: gstResult.gst,
      status: status === 'DRAFT' ? 'DRAFT' : 'PENDING',
      resubmissionCount: 0,
    });

    await logAudit(
      status === 'DRAFT' ? 'EXPENSE_SAVED_DRAFT' : 'EXPENSE_SUBMITTED',
      req.user!.userId,
      'EXPENSE',
      expense._id,
      {
        projectCode: projectDoc.code,
        category: expense.category,
        amount: expense.amount,
        vendor: expense.vendor,
      }
    );

    res.status(201).json({
      success: true,
      message: status === 'DRAFT' ? 'Expense draft saved' : 'Expense submitted directly and visible to Managing Director',
      expense,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to create expense', error: error.message });
  }
}

export async function approveExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const expense = await Expense.findById(id).populate('project');

    if (!expense) {
      res.status(404).json({ success: false, message: 'Expense record not found' });
      return;
    }

    const accessCheck = await verifyUserProjectAccess((expense.project as any)._id, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed || !isMD(req.user!.role)) {
      res.status(403).json({ success: false, message: 'Only the authorized MD can approve expenses for this project.' });
      return;
    }

    if (expense.status === 'APPROVED') {
      res.status(400).json({ success: false, message: 'Expense has already been approved' });
      return;
    }

    if (expense.status === 'DRAFT') {
      res.status(400).json({ success: false, message: 'Draft expenses cannot be approved until they are submitted.' });
      return;
    }

    expense.status = 'APPROVED';
    expense.reviewedBy = new mongoose.Types.ObjectId(req.user!.userId);
    expense.reviewedAt = new Date();
    expense.rejectionReason = undefined;

    await expense.save();

    await logAudit('EXPENSE_APPROVED', req.user!.userId, 'EXPENSE', expense._id, {
      amount: expense.amount,
      vendor: expense.vendor,
      disclaimer: 'Approval confirms expense verification and does not constitute proof of payment.',
    });

    res.json({
      success: true,
      message: 'Expense successfully verified and approved',
      disclaimer: 'Notice: Approval confirms expense verification and does not constitute proof of payment.',
      expense,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to approve expense', error: error.message });
  }
}

export async function rejectExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      res.status(400).json({ success: false, message: 'A rejection reason is strictly required.' });
      return;
    }

    const expense = await Expense.findById(id);
    if (!expense) {
      res.status(404).json({ success: false, message: 'Expense record not found' });
      return;
    }

    const accessCheck = await verifyUserProjectAccess(expense.project, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed || !isMD(req.user!.role)) {
      res.status(403).json({ success: false, message: 'Only the authorized MD can reject expenses for this project.' });
      return;
    }

    if (expense.status === 'APPROVED') {
      res.status(400).json({ success: false, message: 'Approved expenses cannot be silently modified or rejected' });
      return;
    }

    if (expense.status === 'DRAFT') {
      res.status(400).json({ success: false, message: 'Draft expenses cannot be rejected until they are submitted.' });
      return;
    }

    expense.status = 'REJECTED';
    expense.reviewedBy = new mongoose.Types.ObjectId(req.user!.userId);
    expense.reviewedAt = new Date();
    expense.rejectionReason = reason.trim();

    await expense.save();

    await logAudit('EXPENSE_REJECTED', req.user!.userId, 'EXPENSE', expense._id, {
      reason: expense.rejectionReason,
      amount: expense.amount,
    });

    res.json({ success: true, message: 'Expense rejected with documented reason', expense });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to reject expense', error: error.message });
  }
}

export async function resubmitExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { category, description, amount, vendor, receiptUrl, notes } = req.body;

    const expense = await Expense.findById(id);
    if (!expense) {
      res.status(404).json({ success: false, message: 'Expense record not found' });
      return;
    }

    const accessCheck = await verifyUserProjectAccess(expense.project, req.user!.userId, req.user!.role);
    if (!accessCheck.allowed) {
      res.status(403).json({ success: false, message: 'Forbidden. You do not have access to this project.' });
      return;
    }

    if (expense.status !== 'REJECTED') {
      res.status(400).json({ success: false, message: 'Only rejected expenses can be corrected and resubmitted' });
      return;
    }

    if (category) expense.category = category;
    if (description) expense.description = description.trim();
    if (amount !== undefined) {
      expense.amount = req.body.isPaise ? amount : rupeesToPaise(amount);
    }
    if (vendor) expense.vendor = vendor.trim();
    if (receiptUrl) expense.receiptUrl = receiptUrl.trim();
    if (req.body.gst !== undefined) {
      const gstResult = sanitizeGstBill(req.body.gst, await getCompanyGstinForProject(expense.project), 'GST bill');
      if (gstResult.errors.length) {
        res.status(400).json({ success: false, message: gstResult.errors[0], errors: gstResult.errors });
        return;
      }
      expense.gst = gstResult.gst;
      if (gstResult.totalPaise !== undefined) expense.amount = gstResult.totalPaise;
    }

    expense.previousNotes = `Resubmitted. Prior rejection reason: ${expense.rejectionReason}. Resubmission note: ${notes || 'Updated details'}`;
    expense.status = 'PENDING';
    expense.reviewedBy = undefined;
    expense.reviewedAt = undefined;
    expense.rejectionReason = undefined;
    expense.resubmissionCount += 1;

    await expense.save();

    await logAudit('EXPENSE_RESUBMITTED', req.user!.userId, 'EXPENSE', expense._id, {
      resubmissionCount: expense.resubmissionCount,
      amount: expense.amount,
    });

    res.json({ success: true, message: 'Expense corrected and resubmitted for owner review', expense });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to resubmit expense', error: error.message });
  }
}
