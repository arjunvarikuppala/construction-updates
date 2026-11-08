import { Response } from 'express';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { Expense } from '../models/Expense.js';
import { Project } from '../models/Project.js';
import { DailyReport } from '../models/DailyReport.js';
import { AuthenticatedRequest } from '../types/index.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { getAccessibleProjectIds } from '../services/tenantService.js';
import { paiseToRupees, formatIndianCurrency } from '../utils/currency.js';
import { CompanySettings } from '../models/CompanySettings.js';

export async function exportExpensesExcel(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { projectId, status, category, startDate, endDate } = req.query;

    let query: any = {};
    let projectTitle = 'All Projects';

    if (projectId) {
      const access = await verifyUserProjectAccess(String(projectId), req.user!.userId, req.user!.role);
      if (!access.allowed || !access.project) {
        res.status(404).json({ success: false, message: 'Project not found' });
        return;
      }
      query.project = access.project._id;
      projectTitle = `${access.project.name} (${access.project.code})`;
    } else {
      query.project = { $in: await getAccessibleProjectIds(req.user!) };
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
    workbook.creator = 'BKR INFRA';
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
      `attachment; filename="BKR-INFRA-Expenses-${Date.now()}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to export Excel report', error: error.message });
  }
}

/**
 * GET /api/v1/export/gst-register?month=YYYY-MM  (MD only)
 * Monthly GST purchase register for the CA: every GST bill (by invoice date) across
 * the MD's projects, with taxable value and CGST / SGST / IGST. Rejected bills are excluded.
 */
export async function exportGstRegister(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const month = String(req.query.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      res.status(400).json({ success: false, message: 'Choose a month in YYYY-MM format.' });
      return;
    }
    const [y, m] = month.split('-').map(Number);
    // Invoice dates are calendar dates; use an IST-safe window around the month
    const from = new Date(Date.UTC(y, m - 1, 1) - 330 * 60000);
    const to = new Date(Date.UTC(y, m, 1) - 330 * 60000);

    const expenses = await Expense.find({
      project: { $in: await getAccessibleProjectIds(req.user!) },
      'gst.invoiceDate': { $gte: from, $lt: to },
      status: { $in: ['PENDING', 'APPROVED'] },
    })
      .populate('project', 'name code')
      .sort({ 'gst.invoiceDate': 1 });

    const company = await CompanySettings.findOne({ owner: req.user!.userId });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BKR INFRA';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(`GST ${month}`);

    sheet.addRow([`${company?.legalName || 'BKR INFRA'} — GST purchase register`]).font = { bold: true, size: 13 };
    sheet.addRow([`GSTIN: ${company?.gstin || 'not set (add it in Company & GST settings)'}`, '', `Month: ${month}`]);
    sheet.addRow([]);

    const header = sheet.addRow([
      'Invoice date', 'Invoice no.', 'Vendor', 'Vendor GSTIN', 'Project', 'Description',
      'Taxable value (₹)', 'GST %', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)', 'Invoice total (₹)', 'Status', 'Bill attached',
    ]);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF142B4A' } };
    [14, 16, 26, 18, 22, 32, 16, 8, 12, 12, 12, 16, 12, 12].forEach((w, i) => (sheet.getColumn(i + 1).width = w));

    const totals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    expenses.forEach((e: any) => {
      const g = e.gst;
      totals.taxable += g.taxablePaise;
      totals.cgst += g.cgstPaise;
      totals.sgst += g.sgstPaise;
      totals.igst += g.igstPaise;
      totals.total += e.amount;
      sheet.addRow([
        new Date(g.invoiceDate).toISOString().slice(0, 10),
        g.invoiceNumber,
        e.vendor,
        g.vendorGstin,
        e.project ? `${e.project.code} – ${e.project.name}` : '',
        e.description,
        paiseToRupees(g.taxablePaise),
        g.ratePercent,
        paiseToRupees(g.cgstPaise),
        paiseToRupees(g.sgstPaise),
        paiseToRupees(g.igstPaise),
        paiseToRupees(e.amount),
        e.status === 'APPROVED' ? 'Approved' : 'Pending approval',
        e.receiptUrl ? 'Yes' : 'NO',
      ]);
    });

    sheet.addRow([]);
    const totalRow = sheet.addRow([
      'TOTAL', `${expenses.length} invoice(s)`, '', '', '', '',
      paiseToRupees(totals.taxable), '', paiseToRupees(totals.cgst), paiseToRupees(totals.sgst),
      paiseToRupees(totals.igst), paiseToRupees(totals.total),
    ]);
    totalRow.font = { bold: true };
    sheet.addRow(['Input tax credit (CGST + SGST + IGST)', '', '', '', '', '', '', '', '', '', paiseToRupees(totals.cgst + totals.sgst + totals.igst)]).font = { bold: true, color: { argb: 'FF15803D' } };
    [7, 9, 10, 11, 12].forEach((c) => (sheet.getColumn(c).numFmt = '#,##0.00'));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="BKR-INFRA-GST-Register-${month}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to export GST register' });
  }
}
