import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Expense, Project, DailyReport, WorkItem } from '../types/index.js';
import { formatINR, formatRupees, paiseToRupees } from './currency.js';
import { formatDate } from './dates.js';
import { materialCost, machineCost } from './reportOptions.js';

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

  if (project.budget !== undefined && project.budget !== null) {
    doc.text(`Allocated Budget: ${formatINR(project.budget)}`, 115, 57);
  } else {
    doc.text(`Project Code: ${project.code}`, 115, 57);
  }
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
  doc.roundedRect(14, 42, 182, 30, 2, 2, 'F');
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(9);
  doc.text(`Title of Work: ${report.titleOfWork || 'N/A'}`, 18, 50);
  doc.text(`Submitted By: ${report.submittedBy?.name || 'In-Charge'}`, 18, 57);
  doc.text(`Report Status: ${report.status}`, 18, 64);
  doc.text(`Total Labour Count: ${report.totalLabourCount} workers`, 115, 50);
  const totalBudget = report.totalWorkBudget ?? report.workItems?.reduce((s, i) => s + (i.budget || 0), 0) ?? 0;
  doc.text(`Shift / Location: ${report.shift || '—'} / ${(report.workLocation || '—').slice(0, 38)}`, 115, 57);
  doc.text(
    `Progress: ${typeof report.overallProgressPercent === 'number' ? `${report.overallProgressPercent}%` : 'not reported'} | Submitted: ${
      report.status === 'SUBMITTED' ? formatDate(report.submittedAt || report.createdAt, 'dd MMM yyyy, h:mm a') : 'draft'
    }`,
    115,
    64
  );

  const PAGE_BOTTOM = 280;
  let currentY = 80;
  const ensureSpace = (needed: number) => {
    if (currentY + needed > PAGE_BOTTOM) {
      doc.addPage();
      currentY = 18;
    }
  };
  const textBlock = (title: string, body?: string) => {
    if (!body) return;
    const lines = doc.splitTextToSize(body, 182) as string[];
    ensureSpace(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 43, 74);
    doc.text(title, 14, currentY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    currentY += 6;
    for (const line of lines) {
      ensureSpace(5);
      doc.text(line, 14, currentY);
      currentY += 4.5;
    }
    currentY += 6;
  };
  const table = (head: string[], body: string[][], color: [number, number, number], textColor: [number, number, number] = [255, 255, 255], foot?: string[][]) => {
    if (!body.length) return;
    ensureSpace(20);
    autoTable(doc, {
      startY: currentY,
      head: [head],
      body,
      foot,
      headStyles: { fillColor: color, textColor, fontSize: 9 },
      footStyles: { fillColor: [240, 243, 246], textColor: [20, 43, 74], fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8.5 },
    });
    currentY = (doc as any).lastAutoTable.finalY + 10;
  };

  textBlock('Work Summary & Details:', report.workSummary || 'No summary provided.');

  const hasItemStatus = (report.workItems || []).some((i) => !!i.status);
  const itemStatus = (item: WorkItem) =>
    item.status
      ? `${item.status.replace('_', ' ')}${item.status === 'IN_PROGRESS' && item.progressPercent !== undefined ? ` ${item.progressPercent}%` : ''}`
      : '—';
  table(
    ['Work Item / Activity', 'Location', 'Qty', 'Unit', 'Rate (INR)', ...(hasItemStatus ? ['Status'] : []), 'Amount (INR)'],
    (report.workItems || []).map((item) => [
      item.description,
      item.location || '—',
      item.quantity.toString(),
      item.unit,
      item.rate ? `${formatRupees(item.rate)} / ${item.unit}` : '—',
      ...(hasItemStatus ? [itemStatus(item)] : []),
      formatRupees(item.budget || 0),
    ]),
    [20, 43, 74],
    [255, 255, 255],
    [['Total Work Budget (Estimated)', '', '', '', '', ...(hasItemStatus ? [''] : []), formatRupees(totalBudget)]]
  );

  const labour = report.labourBreakdown || [];
  const hasHours = labour.some((l) => l.hours !== undefined && l.hours !== null);
  const labourCost = labour.reduce((s, l) => s + (l.count || 0) * (l.wagePerDay || 0), 0);
  table(
    ['Labour Trade / Role', 'Category', 'Headcount', ...(hasHours ? ['Hours'] : []), 'Wage / day (INR)', 'Cost (INR)'],
    labour.map((l) => [
      l.role,
      l.category || '—',
      l.count.toString(),
      ...(hasHours ? [l.hours !== undefined ? String(l.hours) : '—'] : []),
      l.wagePerDay ? formatRupees(l.wagePerDay) : '—',
      l.wagePerDay ? formatRupees(l.count * l.wagePerDay) : '—',
    ]),
    [245, 166, 35],
    [20, 43, 74],
    labourCost > 0
      ? [['Total Labour Cost', '', String(report.totalLabourCount), ...(hasHours ? [''] : []), '', formatRupees(labourCost)]]
      : undefined
  );

  const materialTotal = (report.materials || []).reduce((s, m) => s + materialCost(m), 0);
  table(
    ['Material', 'Quantity', 'Unit', 'Rate (INR)', 'Cost (INR)'],
    (report.materials || []).map((m) => [
      m.name,
      String(m.quantity),
      m.unit,
      m.rate ? `${formatRupees(m.rate)} / ${m.unit}` : '—',
      m.rate ? formatRupees(materialCost(m)) : '—',
    ]),
    [20, 43, 74],
    [255, 255, 255],
    materialTotal > 0 ? [['Total Material Cost', '', '', '', formatRupees(materialTotal)]] : undefined
  );

  if (report.machinery && report.machinery.length > 0) {
    const machineryTotal = report.machinery.reduce((s, m) => s + machineCost(m), 0);
    table(
      ['Machinery / Equipment', 'Nos', 'Hours used', 'Rate (INR)', 'Cost (INR)'],
      report.machinery.map((m) => [
        m.name,
        String(m.quantity),
        m.hoursUsed !== undefined ? String(m.hoursUsed) : '—',
        m.rate ? `${formatRupees(m.rate)} / ${m.rateBasis === 'HOUR' ? 'hour' : 'day'}` : '—',
        m.rate ? formatRupees(machineCost(m)) : '—',
      ]),
      [20, 43, 74],
      [255, 255, 255],
      machineryTotal > 0 ? [['Total Machinery Cost', '', '', '', formatRupees(machineryTotal)]] : undefined
    );
  } else {
    textBlock('Machinery & Equipment:', report.equipmentDetails);
  }

  const expenses = report.expenses || [];
  table(
    ['Expense', 'Category', 'Vendor', 'Status', 'Amount', 'Bill'],
    expenses.map((e) => [e.description, e.category.replace(/_/g, ' '), e.vendor, e.status, formatINR(e.amount), e.receiptUrl ? 'Attached' : '—']),
    [20, 43, 74],
    [255, 255, 255],
    expenses.length ? [['Total', '', '', '', formatINR(expenses.reduce((s, e) => s + e.amount, 0)), '']] : undefined
  );

  // Grand total of every section (expenses are stored in paise)
  const labourTotal = (report.labourBreakdown || []).reduce((s, l) => s + (l.count || 0) * (l.wagePerDay || 0), 0);
  const machineTotal = (report.machinery || []).reduce((s, m) => s + machineCost(m), 0);
  const expenseRupees = expenses.reduce((s, e) => s + (e.amount || 0), 0) / 100;
  const sections: Array<[string, number]> = [
    ['Work items', totalBudget],
    ['Labour (daily wages)', labourTotal],
    ['Materials', materialTotal],
    ['Machinery & equipment', machineTotal],
    ['Expenses & bills', expenseRupees],
  ];
  const grandTotal = Math.round(sections.reduce((s, [, v]) => s + v, 0) * 100) / 100;
  table(
    ['Cost summary', 'Amount (INR)'],
    sections.map(([label, v]) => [label, v > 0 ? formatRupees(v) : '—']),
    [20, 43, 74],
    [255, 255, 255],
    [['GRAND TOTAL', formatRupees(grandTotal)]]
  );

  textBlock('Issues & Delays:', report.issuesAndDelays);
  textBlock('Next Day Plan:', report.nextDayPlan);
  textBlock('Remarks:', report.remarks);
  if (report.photos?.length) textBlock('Site Photos:', `${report.photos.length} photo(s)/video(s) attached — view them in SiteTrack.`);

  doc.save(`SiteTrack-DailyReport-${formatDate(report.workDate, 'yyyy-MM-dd')}.pdf`);
}
