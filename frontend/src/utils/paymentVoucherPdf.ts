import type { PaymentRequest, PaymentSettlement } from '../types/index.js';
import { formatDate } from './dates.js';
import { MODE_LABEL, balancePaiseOf, nameOf, paidPaiseOf, payeeKindOf } from './payments.js';
import { createDoc, getCompany, PdfWriter, paise, titleCase } from './pdfKit.js';

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
/** Indian numbering in words: 1,25,000 → "One Lakh Twenty Five Thousand Rupees Only" */
export function rupeesInWords(amountPaise: number): string {
  let n = Math.floor(amountPaise / 100);
  const p = amountPaise % 100;
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
  const r = parts.length ? `${parts.join(' ')} Rupees` : '';
  return `${r}${p ? `${r ? ' and ' : ''}${twoDigits(p)} Paise` : ''} Only`;
}

/** Receipt number for one payment entry: stable, because entries are never removed (only undone). */
export const receiptNumberOf = (payment: PaymentRequest, settlement: PaymentSettlement) => {
  const i = (payment.settlements || []).findIndex((s) => s._id === settlement._id);
  return `${payment.paymentReference}-R${i >= 0 ? i + 1 : 1}`;
};

/**
 * Proof-of-payment receipt for one payment entry: what the in-charge (or
 * vendor) keeps to show the MD approved and paid this amount.
 */
export async function exportPaymentReceiptPdf(payment: PaymentRequest, settlement: PaymentSettlement) {
  const [doc, company] = await Promise.all([createDoc(), getCompany()]);
  const number = receiptNumberOf(payment, settlement);
  const w = new PdfWriter(doc, `${company.legalName} · Payment receipt · ${number}`);
  const project = payment.project as any;
  const isInCharge = payeeKindOf(payment) === 'INCHARGE';
  const approver = nameOf(payment.authorizedBy, '') || nameOf(settlement.recordedBy, 'Managing Director');

  w.letterhead(company, 'Payment Receipt', [`Receipt ${number}`, `Paid on ${formatDate(settlement.paidOn, 'dd MMM yyyy')}`]);

  w.tiles([
    { label: 'Amount paid', value: paise(settlement.amountPaise), accent: true },
    { label: 'Mode', value: MODE_LABEL[settlement.mode] },
    { label: 'Status', value: 'Approved & paid' },
  ]);

  const payTo = [payment.vpaSnapshot && `UPI ${payment.vpaSnapshot}`, payment.accountNumberMaskedSnapshot && `A/C ${payment.accountNumberMaskedSnapshot} · ${payment.ifscSnapshot || ''}`]
    .filter(Boolean)
    .join('  ·  ');
  w.infoGrid([
    ['Paid to', payment.payeeNameSnapshot],
    ['Payee type', isInCharge ? 'Site In-Charge' : titleCase(payment.payeeType || 'Vendor')],
    ['Site', project ? `${project.code} – ${project.name}` : '—'],
    ['Purpose', payment.purpose],
    [settlement.mode === 'CHEQUE' ? 'Cheque no.' : 'UTR / reference', settlement.reference || (settlement.mode === 'CASH' ? 'Cash' : '—')],
    ['Account / UPI', payTo || '—'],
    ['Request', `${payment.paymentReference} · raised ${formatDate(payment.createdAt, 'dd MMM yyyy')}`],
    ['Approved & paid by', `${approver} (Managing Director)`],
  ]);

  const paid = paidPaiseOf(payment);
  const balance = balancePaiseOf(payment);
  w.paragraph(`Received the sum of ${rupeesInWords(settlement.amountPaise)} (${paise(settlement.amountPaise)}) towards "${payment.purpose}".`);
  w.paragraph(
    balance > 0
      ? `Request total ${paise(payment.amount)} · paid so far ${paise(paid)} · balance due ${paise(balance)}.`
      : `Request total ${paise(payment.amount)} — fully paid.`
  );
  if (settlement.note) w.paragraph(`Note: ${settlement.note}`);
  if (settlement.proofUrl) w.paragraph('The payment screenshot / proof is attached to this request in the BKR INFRA app.');
  if (settlement.receivedConfirmedAt) {
    w.paragraph(`Receipt of money confirmed by ${nameOf(settlement.receivedConfirmedBy, payment.payeeNameSnapshot)} on ${formatDate(settlement.receivedConfirmedAt, 'dd MMM yyyy')}.`);
  }
  w.signatures(['Approved by (Managing Director)', "Receiver's signature"]);
  w.finish(`Receipt-${number}.pdf`);
}

/** Printable payment voucher with every payment entry, for the file and for signatures. */
export async function exportPaymentVoucherPdf(payment: PaymentRequest) {
  const [doc, company] = await Promise.all([createDoc(), getCompany()]);
  const w = new PdfWriter(doc, `${company.legalName} · Payment voucher · ${payment.paymentReference}`);
  const entries = (payment.settlements || []).filter((s) => !s.voided);
  const project = payment.project as any;
  const isInCharge = payeeKindOf(payment) === 'INCHARGE';
  const paid = paidPaiseOf(payment);
  const balance = balancePaiseOf(payment);

  w.letterhead(company, 'Payment Voucher', [`Voucher ${payment.paymentReference}`, `Date ${formatDate(payment.lastPaidAt || new Date(), 'dd MMM yyyy')}`]);

  const payTo = [payment.vpaSnapshot && `UPI ${payment.vpaSnapshot}`, payment.accountNumberMaskedSnapshot && `A/C ${payment.accountNumberMaskedSnapshot} · ${payment.ifscSnapshot || ''}`]
    .filter(Boolean)
    .join('  ·  ');
  w.infoGrid([
    ['Paid to', payment.payeeNameSnapshot],
    ['Payee type', isInCharge ? 'Site In-Charge' : titleCase(payment.payeeType || 'Vendor')],
    ['Site', project ? `${project.code} – ${project.name}` : '—'],
    ['Account / UPI', payTo || '—'],
    ['Purpose', payment.purpose],
    ['Requested by', `${nameOf(payment.createdBy, '—')} on ${formatDate(payment.createdAt, 'dd MMM yyyy')}`],
  ]);

  w.tiles([
    { label: 'Request amount', value: paise(payment.amount) },
    { label: 'Paid', value: paise(paid), accent: true },
    { label: 'Balance due', value: paise(balance) },
  ]);

  w.heading('Payments made', `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
  w.table({
    head: ['Date', 'Mode', 'UTR / cheque no.', ...(isInCharge ? ['Received'] : []), 'Amount'],
    body: entries.length
      ? entries.map((s) => [
          formatDate(s.paidOn, 'dd MMM yyyy'),
          MODE_LABEL[s.mode],
          s.reference || (s.mode === 'CASH' ? 'Cash' : '—'),
          ...(isInCharge ? [s.receivedConfirmedAt ? `Confirmed ${formatDate(s.receivedConfirmedAt, 'dd MMM')}` : 'Not confirmed'] : []),
          paise(s.amountPaise),
        ])
      : [['—', '—', 'No payment recorded yet', ...(isInCharge ? ['—'] : []), '—']],
    foot: [['', '', 'Total paid', ...(isInCharge ? [''] : []), paise(paid)]],
    money: [isInCharge ? 4 : 3],
    widths: { [isInCharge ? 4 : 3]: 32 },
  });

  w.paragraph(`Amount paid in words: ${rupeesInWords(paid)}.`);
  w.signatures(['Prepared by', 'Approved by (Managing Director)', "Receiver's signature"]);
  w.finish(`Voucher-${payment.paymentReference}.pdf`);
}
