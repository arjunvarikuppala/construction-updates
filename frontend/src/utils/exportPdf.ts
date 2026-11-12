import { Expense, Project, DailyReport, WorkItem } from '../types/index.js';
import { formatDate } from './dates.js';
import { materialCost, machineCost, labourCost } from './reportOptions.js';
import { createDoc, getCompany, PdfWriter, rupees, paise, statusColour, titleCase } from './pdfKit.js';

const qty = (n: number | undefined | null) => (n === undefined || n === null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

/** Project expense statement (all bills for one site). */
export async function exportProjectExpensesPdf(project: Project, expenses: Expense[]) {
  const [doc, company] = await Promise.all([createDoc(), getCompany()]);
  const w = new PdfWriter(doc, `${company.legalName} · Expense statement · ${project.code}`);

  const approved = expenses.filter((e) => e.status === 'APPROVED').reduce((s, e) => s + e.amount, 0);
  const pending = expenses.filter((e) => e.status === 'PENDING').reduce((s, e) => s + e.amount, 0);
  const rejected = expenses.filter((e) => e.status === 'REJECTED').reduce((s, e) => s + e.amount, 0);
  const sorted = [...expenses].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const period = sorted.length
    ? `${formatDate(sorted[0].date, 'dd MMM yyyy')} – ${formatDate(sorted[sorted.length - 1].date, 'dd MMM yyyy')}`
    : '—';

  w.letterhead(company, 'Expense Statement', [`Project ${project.code}`, `Period ${period}`]);
  w.infoGrid([
    ['Project', `${project.name} (${project.code})`],
    ['Location', project.location || '—'],
    ['Site In-Charge', project.assignedInCharge?.name || '—'],
    ['Status', titleCase(project.status)],
  ]);
  w.tiles([
    { label: 'Approved', value: paise(approved), accent: true },
    { label: 'Pending approval', value: paise(pending) },
    { label: 'Rejected', value: paise(rejected) },
    ...(project.budget ? [{ label: 'Project budget', value: paise(project.budget) }] : []),
  ]);

  w.heading('Expenses', `${expenses.length} entr${expenses.length === 1 ? 'y' : 'ies'}`);
  w.table({
    head: ['Date', 'Category', 'Vendor / payee', 'Description', 'Status', 'Amount'],
    body: sorted.map((e) => [
      formatDate(e.date, 'dd MMM yyyy'),
      titleCase(e.category),
      e.vendor || '—',
      e.description,
      titleCase(e.status),
      paise(e.amount),
    ]),
    foot: [['', '', '', 'Total (approved + pending)', '', paise(approved + pending)]],
    money: [5],
    widths: { 0: 25, 1: 30, 4: 20, 5: 28 },
    didParseCell: (d) => statusColour(d, 4),
  });

  w.paragraph('Approval confirms that the expense was verified at site. It is not proof of payment — payments are recorded separately in the Payments register.');
  w.signatures(['Prepared by', 'Verified by (Site In-Charge)', 'Approved by (Managing Director)']);
  w.finish(`BKR-INFRA-${project.code}-Expenses.pdf`);
}

/** Daily progress report for one site and day. */
export async function exportDailyReportPdf(report: DailyReport) {
  const [doc, company] = await Promise.all([createDoc(), getCompany()]);
  const date = formatDate(report.workDate, 'dd MMM yyyy');
  const w = new PdfWriter(doc, `${company.legalName} · Daily progress report · ${report.project?.code || ''} · ${date}`);

  w.letterhead(company, 'Daily Progress Report', [
    `${report.project?.code || ''}  ·  ${formatDate(report.workDate, 'EEEE, dd MMMM yyyy')}`,
    `Status: ${titleCase(report.status)}${report.version && report.version > 1 ? `  ·  Revision ${report.version}` : ''}`,
  ]);

  w.infoGrid([
    ['Project', `${report.project?.name || ''} (${report.project?.code || ''})`],
    ['Work date', formatDate(report.workDate, 'EEEE, dd MMM yyyy')],
    ['Title of work', report.titleOfWork || '—'],
    ['Shift / location', `${report.shift ? titleCase(report.shift) : '—'}${report.workLocation ? ` · ${report.workLocation}` : ''}`],
    ['Prepared by', report.submittedBy?.name || 'Site In-Charge'],
    ['Submitted', report.status === 'DRAFT' ? 'Draft (not submitted)' : formatDate(report.submittedAt || report.createdAt, 'dd MMM yyyy, hh:mm a')],
  ]);

  // ----- figures -----
  const items = report.workItems || [];
  const labour = report.labourBreakdown || [];
  const materials = report.materials || [];
  const machinery = report.machinery || [];
  const expenses = report.expenses || [];
  const workTotal = report.totalWorkBudget ?? items.reduce((s, i) => s + (i.budget || 0), 0);
  const labourTotal = labour.reduce((s, l) => s + labourCost(l), 0);
  const materialTotal = materials.reduce((s, m) => s + materialCost(m), 0);
  const machineTotal = machinery.reduce((s, m) => s + machineCost(m), 0);
  const expenseRupees = expenses.filter((e) => e.status !== 'REJECTED').reduce((s, e) => s + (e.amount || 0), 0) / 100;
  // Same lines and grand total as the Cost summary on screen
  const grandTotal = Math.round((workTotal + labourTotal + materialTotal + machineTotal + expenseRupees) * 100) / 100;

  w.tiles([
    { label: 'Workers on site', value: String(report.totalLabourCount || 0) },
    { label: 'Work items value', value: rupees(workTotal) },
    { label: 'Grand total', value: rupees(grandTotal), accent: true },
  ]);

  if (report.workSummary) {
    w.heading('Work summary');
    w.paragraph(report.workSummary);
  }

  if (items.length) {
    const hasStatus = items.some((i) => !!i.status);
    const itemStatus = (item: WorkItem) =>
      item.status
        ? `${titleCase(item.status)}${item.status === 'IN_PROGRESS' && item.progressPercent !== undefined ? ` (${item.progressPercent}%)` : ''}`
        : '—';
    w.heading('Work done', `${items.length} item${items.length === 1 ? '' : 's'}`);
    const amountCol = hasStatus ? 6 : 5;
    w.table({
      head: ['Activity', 'Location', 'Qty', 'Unit', 'Rate', ...(hasStatus ? ['Status'] : []), 'Amount'],
      body: items.map((i) => [
        i.description,
        i.location || '—',
        qty(i.quantity),
        i.unit,
        i.rate ? `${rupees(i.rate)} / ${i.unit}` : '—',
        ...(hasStatus ? [itemStatus(i)] : []),
        i.budget ? rupees(i.budget) : '—',
      ]),
      foot: [['Total work value (estimated)', '', '', '', '', ...(hasStatus ? [''] : []), rupees(workTotal)]],
      money: [2, 4, amountCol],
      widths: { [amountCol]: 28 },
    });
  }

  if (labour.length) {
    const hasHours = labour.some((l) => l.hours !== undefined && l.hours !== null);
    w.heading('Labour', `${report.totalLabourCount || 0} worker${report.totalLabourCount === 1 ? '' : 's'}`);
    const costCol = hasHours ? 5 : 4;
    w.table({
      head: ['Trade / role', 'Category', 'Workers', ...(hasHours ? ['Hours'] : []), 'Wage / day', 'Cost'],
      body: labour.map((l) => [
        l.role,
        l.category ? titleCase(l.category) : '—',
        String(l.count),
        ...(hasHours ? [l.hours !== undefined && l.hours !== null ? String(l.hours) : '—'] : []),
        l.wagePerDay ? rupees(l.wagePerDay) : '—',
        l.wagePerDay ? rupees(labourCost(l)) : '—',
      ]),
      foot: [['Total labour', '', String(report.totalLabourCount || 0), ...(hasHours ? [''] : []), '', labourTotal ? rupees(labourTotal) : '—']],
      money: [costCol - 1, costCol],
      center: [2],
      widths: { [costCol]: 28 },
    });
  }

  if (materials.length) {
    w.heading('Materials used / received');
    w.table({
      head: ['Material', 'Quantity', 'Unit', 'Rate', 'Cost'],
      body: materials.map((m) => [m.name, qty(m.quantity), m.unit, m.rate ? `${rupees(m.rate)} / ${m.unit}` : '—', m.rate ? rupees(materialCost(m)) : '—']),
      foot: [['Total materials', '', '', '', materialTotal ? rupees(materialTotal) : '—']],
      money: [1, 3, 4],
      widths: { 4: 28 },
    });
  }

  if (machinery.length) {
    w.heading('Machinery & equipment');
    w.table({
      head: ['Machine', 'Nos', 'Hours used', 'Rate', 'Cost'],
      body: machinery.map((m) => [
        m.name,
        String(m.quantity),
        m.hoursUsed !== undefined && m.hoursUsed !== null ? String(m.hoursUsed) : '—',
        m.rate ? `${rupees(m.rate)} / ${m.rateBasis === 'HOUR' ? 'hour' : 'day'}` : '—',
        m.rate ? rupees(machineCost(m)) : '—',
      ]),
      foot: [['Total machinery', '', '', '', machineTotal ? rupees(machineTotal) : '—']],
      money: [3, 4],
      center: [1, 2],
      widths: { 4: 28 },
    });
  } else if (report.equipmentDetails) {
    w.heading('Machinery & equipment');
    w.paragraph(report.equipmentDetails);
  }

  if (expenses.length) {
    w.heading('Bills & expenses', 'Rejected bills are not counted');
    w.table({
      head: ['Expense', 'Category', 'Vendor', 'Bill', 'Status', 'Amount'],
      body: expenses.map((e) => [
        e.description,
        titleCase(e.category),
        e.vendor || '—',
        e.gst ? `GST ${e.gst.invoiceNumber}` : e.receiptUrl ? 'Attached' : '—',
        titleCase(e.status),
        paise(e.amount),
      ]),
      foot: [['Total (excluding rejected)', '', '', '', '', rupees(expenseRupees)]],
      money: [5],
      widths: { 5: 28 },
      didParseCell: (d) => {
        statusColour(d, 4);
        if (d.section === 'body' && String((d.row.raw as any[])[4]).toUpperCase() === 'REJECTED' && d.column.index === 5) {
          d.cell.styles.textColor = [148, 163, 184];
        }
      },
    });
  }

  // ----- cost summary -----
  const gstPaid =
    expenses
      .filter((e) => e.status !== 'REJECTED')
      .reduce((s, e) => s + (e.gst ? e.gst.cgstPaise + e.gst.sgstPaise + e.gst.igstPaise : 0), 0) / 100;
  const rows: Array<{ label: string; value: string; strong?: boolean; muted?: boolean }> = [
    { label: 'Work items', value: rupees(workTotal) },
    { label: 'Labour (daily wages)', value: rupees(labourTotal) },
    { label: 'Materials', value: rupees(materialTotal) },
    { label: 'Machinery & equipment', value: rupees(machineTotal) },
    { label: 'Bills & expenses', value: rupees(expenseRupees) },
    { label: 'GRAND TOTAL', value: rupees(grandTotal), strong: true },
  ];
  if (gstPaid > 0) {
    rows.push({ label: 'of which GST on bills (input credit)', value: rupees(gstPaid), muted: true });
    rows.push({ label: 'Total after GST credit', value: rupees(grandTotal - gstPaid) });
  }
  w.totals(rows);

  if (report.issuesAndDelays) {
    w.heading('Issues & delays');
    w.paragraph(report.issuesAndDelays);
  }
  if (report.nextDayPlan) {
    w.heading('Plan for tomorrow');
    w.paragraph(report.nextDayPlan);
  }
  if (report.remarks) {
    w.heading('Remarks');
    w.paragraph(report.remarks);
  }
  if (report.photos?.length) {
    w.paragraph(`${report.photos.length} site photo(s)/video(s) are attached to this report in the BKR INFRA app.`);
  }

  w.signatures(['Prepared by (Site In-Charge)', 'Reviewed by (Managing Director)']);
  w.finish(`BKR-INFRA-DailyReport-${report.project?.code || 'site'}-${formatDate(report.workDate, 'yyyy-MM-dd')}.pdf`);
}
