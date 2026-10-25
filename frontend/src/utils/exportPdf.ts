import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Expense, Project, DailyReport } from '../types/index.js';
import { formatINR, paiseToRupees } from './currency.js';
import { formatDate } from './dates.js';

export function exportProjectExpensesPdf(project: Project, expenses: Expense[]) {
  const doc = new jsPDF();

  // Primary Navy Header Banner
  doc.setFillColor(20, 43, 74); // #142B4A
  doc.rect(0, 0, 210, 36, 'F');

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('SiteTrack Construction Management', 14, 16);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Official Project Expense & Financial Verification Audit Report', 14, 25);
  doc.text(`Generated: ${formatDate(new Date(), 'dd MMM yyyy, hh:mm a')}`, 14, 31);

  // Project Information Card
  doc.setFillColor(246, 248, 251);
  doc.roundedRect(14, 42, 182, 38, 3, 3, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 42, 182, 38, 3, 3, 'S');

  doc.setTextColor(20, 43, 74);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`${project.name} (${project.code})`, 18, 50);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`Location: ${project.location}`, 18, 57);
  doc.text(`Site In-Charge: ${project.assignedInCharge?.name || 'N/A'}`, 18, 64);
  doc.text(`Status: ${project.status}`, 18, 71);

  // Financial summary box on right
  const approvedTotal = expenses
    .filter((e) => e.status === 'APPROVED')
    .reduce((sum, e) => sum + e.amount, 0);

  const pendingTotal = expenses
    .filter((e) => e.status === 'PENDING')
    .reduce((sum, e) => sum + e.amount, 0);

  doc.text(`Allocated Budget: ${formatINR(project.budget)}`, 115, 57);
  doc.setTextColor(21, 128, 61); // Green
  doc.setFont('helvetica', 'bold');
  doc.text(`Verified Approved: ${formatINR(approvedTotal)}`, 115, 64);
  doc.setTextColor(180, 83, 9); // Amber
  doc.text(`Pending Approval: ${formatINR(pendingTotal)}`, 115, 71);

  // Table Data
  const tableRows = expenses.map((e) => [
    formatDate(e.date, 'dd/MM/yyyy'),
    e.category.replace(/_/g, ' '),
    e.vendor,
    e.description.length > 40 ? `${e.description.substring(0, 38)}...` : e.description,
    formatINR(e.amount),
    e.status,
  ]);

  autoTable(doc, {
    startY: 86,
    head: [['Date', 'Category', 'Vendor / Payee', 'Description', 'Amount (INR)', 'Status']],
    body: tableRows,
    headStyles: {
      fillColor: [20, 43, 74],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    styles: {
      fontSize: 8.5,
      textColor: [30, 41, 59],
      cellPadding: 3,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      4: { halign: 'right', fontStyle: 'bold' },
      5: { halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        if (data.cell.raw === 'APPROVED') {
          data.cell.styles.textColor = [21, 128, 61];
          data.cell.styles.fontStyle = 'bold';
        } else if (data.cell.raw === 'PENDING') {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fontStyle = 'bold';
        } else if (data.cell.raw === 'REJECTED') {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  // Disclaimer footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'Notice: Expense approval confirms site verification and does not constitute proof of payment. SiteTrack Construction PM.',
      14,
      290
    );
    doc.text(`Page ${i} of ${pageCount}`, 190, 290, { align: 'right' });
  }

  doc.save(`SiteTrack-${project.code}-Expenses.pdf`);
}

export function exportDailyReportPdf(report: DailyReport) {
  const doc = new jsPDF();

  // Header Banner
  doc.setFillColor(20, 43, 74);
  doc.rect(0, 0, 210, 36, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SiteTrack — Daily Construction Progress Report', 14, 13);

  doc.setFontSize(12);
  doc.setTextColor(245, 166, 35); // Amber
  doc.text(`Work Title: ${report.titleOfWork || 'Daily Construction Work'}`, 14, 22);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(226, 232, 240);
  doc.text(`Project: ${report.project?.name} (${report.project?.code}) | Date: ${formatDate(report.workDate, 'EEEE, dd MMMM yyyy')}`, 14, 30);

  // Meta info
  doc.setFillColor(246, 248, 251);
  doc.roundedRect(14, 42, 182, 28, 2, 2, 'F');
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(9);
  doc.text(`Title of Work: ${report.titleOfWork || 'N/A'}`, 18, 50);
  doc.text(`Submitted By: ${report.submittedBy?.name || 'In-Charge'}`, 18, 57);
  doc.text(`Total Labour Count: ${report.totalLabourCount} workers`, 115, 50);
  doc.text(`Report Status: ${report.status}`, 115, 57);

  // Work Summary
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 43, 74);
  doc.text('Work Summary & Details:', 14, 78);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(doc.splitTextToSize(report.workSummary || 'No summary provided.', 182), 14, 84);

  let currentY = 104;

  // Work Items Table
  if (report.workItems && report.workItems.length > 0) {
    const itemsData = report.workItems.map((item) => [
      item.description,
      item.quantity.toString(),
      item.unit,
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [['Work Item / Activity', 'Quantity', 'Unit']],
      body: itemsData,
      headStyles: { fillColor: [20, 43, 74], fontSize: 9 },
      styles: { fontSize: 8.5 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 12;
  }

  // Labour Breakdown Table
  if (report.labourBreakdown && report.labourBreakdown.length > 0) {
    const labourData = report.labourBreakdown.map((l) => [l.role, l.count.toString()]);

    autoTable(doc, {
      startY: currentY,
      head: [['Labour Trade / Role', 'Headcount']],
      body: labourData,
      headStyles: { fillColor: [245, 166, 35], textColor: [20, 43, 74], fontSize: 9 },
      styles: { fontSize: 8.5 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 12;
  }

  // Equipment & Next Day Plan
  if (report.equipmentDetails) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 43, 74);
    doc.text('Machinery & Equipment:', 14, currentY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.text(doc.splitTextToSize(report.equipmentDetails, 182), 14, currentY + 6);
    currentY += 16;
  }

  if (report.nextDayPlan) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 43, 74);
    doc.text('Next Day Plan:', 14, currentY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.text(doc.splitTextToSize(report.nextDayPlan, 182), 14, currentY + 6);
  }

  doc.save(`SiteTrack-DailyReport-${formatDate(report.workDate, 'yyyy-MM-dd')}.pdf`);
}
