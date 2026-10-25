import { Response } from 'express';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { Expense } from '../models/Expense.js';
import { Project } from '../models/Project.js';
import { DailyReport } from '../models/DailyReport.js';
import { AuthenticatedRequest } from '../types/index.js';
import { paiseToRupees, formatIndianCurrency } from '../utils/currency.js';

export async function exportExpensesExcel(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId, status, category, startDate, endDate } = req.query;

    let query: any = {};
    let projectTitle = 'All Projects';

    if (projectId) {
      query.project = new mongoose.Types.ObjectId(String(projectId));
      const proj = await Project.findById(projectId);
      if (proj) projectTitle = `${proj.name} (${proj.code})`;
    }

    if (status && status !== 'ALL') query.status = status;
    if (category && category !== 'ALL') query.category = category;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(String(startDate));
      if (endDate) {
        const end = new Date(String(endDate));
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const expenses = await Expense.find(query)
      .populate('project', 'name code location budget')
      .populate('submittedBy', 'name email')
      .populate('reviewedBy', 'name email')
      .sort({ date: -1 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SiteTrack Construction Management';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Expenses Register');

    // Headers
    sheet.columns = [
      { header: 'Project Code', key: 'projectCode', width: 16 },
      { header: 'Project Name', key: 'projectName', width: 28 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Category', key: 'category', width: 24 },
      { header: 'Vendor / Payee', key: 'vendor', width: 24 },
      { header: 'Description', key: 'description', width: 36 },
      { header: 'Amount (INR)', key: 'amount', width: 18 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Submitted By', key: 'submittedBy', width: 20 },
      { header: 'Reviewed By', key: 'reviewedBy', width: 20 },
      { header: 'Rejection Reason', key: 'rejectionReason', width: 30 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF142B4A' }, // Deep Navy
    };

    let totalPaise = 0;
    let approvedPaise = 0;
    let pendingPaise = 0;
    let rejectedPaise = 0;

    expenses.forEach((e: any) => {
      totalPaise += e.amount;
      if (e.status === 'APPROVED') approvedPaise += e.amount;
      if (e.status === 'PENDING') pendingPaise += e.amount;
      if (e.status === 'REJECTED') rejectedPaise += e.amount;

      sheet.addRow({
        projectCode: e.project?.code || 'N/A',
        projectName: e.project?.name || 'N/A',
        date: new Date(e.date).toISOString().split('T')[0],
        category: e.category.replace(/_/g, ' '),
        vendor: e.vendor,
        description: e.description,
        amount: paiseToRupees(e.amount),
        status: e.status,
        submittedBy: e.submittedBy?.name || 'Unknown',
        reviewedBy: e.reviewedBy?.name || 'Pending',
        rejectionReason: e.rejectionReason || '',
      });
    });

    // Format currency column
    sheet.getColumn('amount').numFmt = '₹#,##0.00';

    // Add empty row then summary
    sheet.addRow({});
    const summaryRow1 = sheet.addRow({
      description: 'TOTAL EXPENDITURE SUBMITTED:',
      amount: paiseToRupees(totalPaise),
    });
    summaryRow1.font = { bold: true };

    const summaryRow2 = sheet.addRow({
      description: 'APPROVED TOTAL:',
      amount: paiseToRupees(approvedPaise),
    });
    summaryRow2.font = { bold: true, color: { argb: 'FF15803D' } };

    const summaryRow3 = sheet.addRow({
      description: 'PENDING TOTAL:',
      amount: paiseToRupees(pendingPaise),
    });
    summaryRow3.font = { bold: true, color: { argb: 'FFB45309' } };

    const summaryRow4 = sheet.addRow({
      description: 'REJECTED TOTAL:',
      amount: paiseToRupees(rejectedPaise),
    });
    summaryRow4.font = { bold: true, color: { argb: 'FFDC2626' } };

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="SiteTrack-Expenses-${Date.now()}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to export Excel report', error: error.message });
  }
}
