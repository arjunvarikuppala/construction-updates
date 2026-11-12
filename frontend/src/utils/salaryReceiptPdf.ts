import { formatDate } from './dates.js';
import { MODE_LABEL, nameOf } from './payments.js';
import { rupeesInWords } from './paymentVoucherPdf.js';
import { createDoc, getCompany, PdfWriter, paise } from './pdfKit.js';
import { monthLabel, type SalaryEmployee, type SalaryMonth, type SalaryPaymentEntry } from './salary.js';

/** Receipt number: stable per entry (month + position among that month's entries). */
export const salaryReceiptNumber = (employee: SalaryEmployee, month: SalaryMonth, entry: SalaryPaymentEntry) => {
  const i = month.entries.findIndex((e) => e._id === entry._id);
  return `SAL-${month.month.replace('-', '')}-${employee._id.slice(-4).toUpperCase()}-${i >= 0 ? i + 1 : 1}`;
};

/** Proof-of-payment receipt the in-charge keeps for one salary payment. */
export async function exportSalaryReceiptPdf(employee: SalaryEmployee, month: SalaryMonth, entry: SalaryPaymentEntry) {
  const [doc, company] = await Promise.all([createDoc(), getCompany()]);
  const number = salaryReceiptNumber(employee, month, entry);
  const w = new PdfWriter(doc, `${company.legalName} · Salary receipt · ${number}`);
  const label = monthLabel(month.month);

  w.letterhead(company, 'Salary Receipt', [`Receipt ${number}`, `Paid on ${formatDate(entry.paidOn, 'dd MMM yyyy')}`]);
  w.tiles([
    { label: 'Amount paid', value: paise(entry.amountPaise), accent: true },
    { label: 'Salary month', value: label },
    { label: 'Mode', value: MODE_LABEL[entry.mode] },
  ]);
  w.infoGrid([
    ['Paid to', employee.name],
    ['Role', 'Site In-Charge'],
    ['Monthly salary', month.duePaise ? paise(month.duePaise) : '—'],
    [entry.mode === 'CHEQUE' ? 'Cheque no.' : 'UTR / reference', entry.reference || (entry.mode === 'CASH' ? 'Cash' : '—')],
    ['Paid by', `${nameOf(entry.recordedBy, 'Managing Director')} (Managing Director)`],
    ['Payment date', formatDate(entry.paidOn, 'dd MMM yyyy')],
  ]);
  w.paragraph(`Received the sum of ${rupeesInWords(entry.amountPaise)} (${paise(entry.amountPaise)}) towards salary for ${label}.`);
  w.paragraph(
    month.duePaise
      ? month.balancePaise > 0
        ? `${label}: salary ${paise(month.duePaise)} · paid so far ${paise(month.paidPaise)} · balance due ${paise(month.balancePaise)}.`
        : `${label}: salary ${paise(month.duePaise)} — fully paid.`
      : `${label}: total paid ${paise(month.paidPaise)}.`
  );
  if (entry.note) w.paragraph(`Note: ${entry.note}`);
  if (entry.proofUrl) w.paragraph('The payment screenshot / proof is attached to this salary entry in the BKR INFRA app.');
  if (entry.receivedConfirmedAt) w.paragraph(`Receipt of money confirmed by ${employee.name} on ${formatDate(entry.receivedConfirmedAt, 'dd MMM yyyy')}.`);
  w.signatures(['Paid by (Managing Director)', "Employee's signature"]);
  w.finish(`Salary-${number}.pdf`);
}
