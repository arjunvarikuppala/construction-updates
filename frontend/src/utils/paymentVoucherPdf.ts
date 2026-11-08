import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PaymentRequest } from '../types/index.js';
import { formatDate } from './dates.js';
import { MODE_LABEL, balancePaiseOf, nameOf, paidPaiseOf, payeeKindOf } from './payments.js';

// The built-in PDF font has no ₹ glyph, so vouchers print "Rs."
const rs = (paise: number) => `Rs. ${((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigits(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}
function threeDigits(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return `${h ? `${ONES[h]} Hundred${r ? ' ' : ''}` : ''}${r ? twoDigits(r) : ''}`;
}
/** Indian numbering in words: 1,25,000 → "One Lakh Twenty Five Thousand" */
export function rupeesInWords(paise: number): string {
  let n = Math.floor(paise / 100);
  const p = paise % 100;
  if (n === 0 && p === 0) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  const rupees = parts.length ? `${parts.join(' ')} Rupees` : '';
  return `${rupees}${p ? `${rupees ? ' and ' : ''}${twoDigits(p)} Paise` : ''} Only`;
}

/** Printable payment voucher with every payment entry, for the file and for signatures. */
export function exportPaymentVoucherPdf(payment: PaymentRequest, companyName = 'BKR INFRA') {
  const doc = new jsPDF();
  const entries = (payment.settlements || []).filter((s) => !s.voided);

  doc.setFillColor(20, 43, 74);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(companyName, 14, 14);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('PAYMENT VOUCHER', 14, 22);
  doc.text(payment.paymentReference, 196, 14, { align: 'right' });
  doc.text(`Printed ${formatDate(new Date(), 'dd MMM yyyy')}`, 196, 22, { align: 'right' });

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  const project = payment.project as any;
  const rows: [string, string][] = [
    ['Paid to', `${payment.payeeNameSnapshot} (${payeeKindOf(payment) === 'INCHARGE' ? 'Site In-Charge' : payment.payeeType || 'Vendor'})`],
    ['Site', project ? `${project.code} - ${project.name}` : ''],
    ['Purpose', payment.purpose],
    ['Requested by', `${nameOf(payment.createdBy, '')} on ${formatDate(payment.createdAt, 'dd MMM yyyy')}`],
    ['Request amount', rs(payment.amount)],
    ['Paid', rs(paidPaiseOf(payment))],
    ['Balance due', rs(balancePaiseOf(payment))],
  ];
  if (payment.vpaSnapshot) rows.splice(1, 0, ['UPI ID', payment.vpaSnapshot]);
  if (payment.accountNumberMaskedSnapshot) rows.splice(1, 0, ['Bank A/C', `${payment.accountNumberMaskedSnapshot}  IFSC ${payment.ifscSnapshot || ''}`]);

  autoTable(doc, {
    startY: 38,
    body: rows,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1.8 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40, textColor: [100, 116, 139] } },
  });

  const afterInfo = (doc as any).lastAutoTable.finalY + 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Payments made', 14, afterInfo);
  autoTable(doc, {
    startY: afterInfo + 3,
    head: [['Date', 'Mode', 'UTR / Cheque no.', 'Amount', 'Received']],
    body: entries.length
      ? entries.map((s) => [
          formatDate(s.paidOn, 'dd MMM yyyy'),
          MODE_LABEL[s.mode],
          s.reference || (s.mode === 'CASH' ? 'Cash' : '-'),
          rs(s.amountPaise),
          payeeKindOf(payment) === 'INCHARGE' ? (s.receivedConfirmedAt ? `Confirmed ${formatDate(s.receivedConfirmedAt, 'dd MMM')}` : 'Not confirmed') : '-',
        ])
      : [['-', '-', 'No payment recorded yet', '-', '-']],
    foot: [['', '', 'Total paid', rs(paidPaiseOf(payment)), '']],
    headStyles: { fillColor: [20, 43, 74] },
    footStyles: { fillColor: [241, 245, 249], textColor: [20, 43, 74], fontStyle: 'bold' },
    styles: { fontSize: 9 },
    columnStyles: { 3: { halign: 'right' } },
  });

  let y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Amount paid in words: ${rupeesInWords(paidPaiseOf(payment))}`, 14, y, { maxWidth: 182 });
  y += 26;
  doc.setDrawColor(148, 163, 184);
  [14, 82, 150].forEach((x) => doc.line(x, y, x + 46, y));
  doc.setFontSize(8);
  doc.text('Prepared by', 14, y + 5);
  doc.text('Approved by (MD)', 82, y + 5);
  doc.text("Receiver's signature", 150, y + 5);

  doc.save(`Voucher-${payment.paymentReference}.pdf`);
}
