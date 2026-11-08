/**
 * Shared look for every BKR INFRA PDF: Noto Sans (has the ₹ sign — the
 * built-in PDF fonts do not), letterhead, section headings, tables, totals,
 * signature lines and a footer with page numbers.
 */
import jsPDF from 'jspdf';
import autoTable, { RowInput, CellHookData } from 'jspdf-autotable';
import { api } from '../api/client.js';
import { formatDate } from './dates.js';

export const FONT = 'NotoSans';
export const C = {
  navy: [20, 43, 74] as [number, number, number],
  navySoft: [234, 239, 246] as [number, number, number],
  amber: [245, 166, 35] as [number, number, number],
  text: [30, 41, 59] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  line: [226, 232, 240] as [number, number, number],
  zebra: [248, 250, 252] as [number, number, number],
  green: [21, 128, 61] as [number, number, number],
  red: [185, 28, 28] as [number, number, number],
  orange: [180, 83, 9] as [number, number, number],
};

export const PAGE = { w: 210, h: 297, margin: 14, bottom: 278 };
const CONTENT_W = PAGE.w - PAGE.margin * 2;

// ---------- money ----------
const inrFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** ₹1,23,456.00 (rupees) */
export const rupees = (v: number | undefined | null) => `₹${inrFmt.format(Number(v) || 0)}`;
/** ₹1,23,456.00 (from paise) */
export const paise = (v: number | undefined | null) => rupees((Number(v) || 0) / 100);

// ---------- fonts ----------
let fontCache: Promise<{ regular: string; bold: string }> | null = null;
async function toBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font ${url} failed to load`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function loadFonts() {
  if (!fontCache) {
    fontCache = Promise.all([toBase64('/fonts/NotoSans-Regular.ttf'), toBase64('/fonts/NotoSans-Bold.ttf')])
      .then(([regular, bold]) => ({ regular, bold }))
      .catch((e) => {
        fontCache = null;
        throw e;
      });
  }
  return fontCache;
}

/** New A4 document with Noto Sans registered as the default font. */
export async function createDoc(): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const f = await loadFonts();
  doc.addFileToVFS('NotoSans-Regular.ttf', f.regular);
  doc.addFont('NotoSans-Regular.ttf', FONT, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', f.bold);
  doc.addFont('NotoSans-Bold.ttf', FONT, 'bold');
  doc.setFont(FONT, 'normal');
  doc.setLineHeightFactor(1.35);
  return doc;
}

// ---------- company ----------
export interface CompanyInfo {
  legalName: string;
  gstin?: string;
  address?: string;
}
export async function getCompany(): Promise<CompanyInfo> {
  const s = await api
    .get<{ settings: CompanyInfo }>('/company-settings')
    .then((r) => r.settings)
    .catch(() => null);
  return { legalName: s?.legalName || 'BKR INFRA', gstin: s?.gstin || '', address: s?.address || '' };
}

// ---------- layout helpers ----------
export class PdfWriter {
  y = PAGE.margin;
  constructor(public doc: jsPDF, private footerLabel: string) {}

  ensure(space: number) {
    if (this.y + space > PAGE.bottom) {
      this.doc.addPage();
      this.y = PAGE.margin + 4;
    }
  }

  /** Letterhead: company on the left, document title + reference on the right. */
  letterhead(company: CompanyInfo, title: string, rightLines: string[]) {
    const { doc } = this;
    doc.setFillColor(...C.navy);
    doc.rect(0, 0, PAGE.w, 4, 'F');
    doc.setFillColor(...C.amber);
    doc.rect(0, 4, PAGE.w, 1.2, 'F');

    let y = 15;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(17);
    doc.setTextColor(...C.navy);
    doc.text(company.legalName, PAGE.margin, y);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.muted);
    y += 5;
    const sub: string[] = [];
    if (company.address) sub.push(...(doc.splitTextToSize(company.address.replace(/\s*\n\s*/g, ', '), 105) as string[]).slice(0, 2));
    if (company.gstin) sub.push(`GSTIN: ${company.gstin}`);
    if (!sub.length) sub.push('Civil construction & infrastructure');
    sub.forEach((l) => {
      doc.text(l, PAGE.margin, y);
      y += 4;
    });

    doc.setFont(FONT, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...C.navy);
    doc.text(title.toUpperCase(), PAGE.w - PAGE.margin, 15, { align: 'right' });
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.muted);
    rightLines.forEach((l, i) => doc.text(l, PAGE.w - PAGE.margin, 20 + i * 4, { align: 'right' }));

    this.y = Math.max(y, 20 + rightLines.length * 4) + 3;
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.3);
    doc.line(PAGE.margin, this.y, PAGE.w - PAGE.margin, this.y);
    this.y += 6;
  }

  /** Grid of label / value pairs in a light box (2 columns). */
  infoGrid(pairs: Array<[string, string]>) {
    const { doc } = this;
    const colW = CONTENT_W / 2;
    const rows = Math.ceil(pairs.length / 2);
    const rowH = 10;
    const h = rows * rowH + 4;
    this.ensure(h + 4);
    doc.setFillColor(...C.zebra);
    doc.setDrawColor(...C.line);
    doc.roundedRect(PAGE.margin, this.y, CONTENT_W, h, 2, 2, 'FD');
    pairs.forEach(([label, value], i) => {
      const x = PAGE.margin + 5 + (i % 2) * colW;
      const y = this.y + 6 + Math.floor(i / 2) * rowH;
      doc.setFont(FONT, 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...C.muted);
      doc.text(label.toUpperCase(), x, y);
      doc.setFont(FONT, 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...C.text);
      const v = (doc.splitTextToSize(value || '—', colW - 8) as string[])[0];
      doc.text(v, x, y + 4.5);
    });
    this.y += h + 7;
  }

  /** Small KPI tiles in a row. */
  tiles(items: Array<{ label: string; value: string; accent?: boolean }>) {
    const { doc } = this;
    const gap = 3;
    const w = (CONTENT_W - gap * (items.length - 1)) / items.length;
    this.ensure(20);
    items.forEach((t, i) => {
      const x = PAGE.margin + i * (w + gap);
      doc.setFillColor(...(t.accent ? C.navy : C.navySoft));
      doc.roundedRect(x, this.y, w, 15, 2, 2, 'F');
      doc.setFont(FONT, 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(...(t.accent ? ([203, 213, 225] as [number, number, number]) : C.muted));
      doc.text(t.label.toUpperCase(), x + 3.5, this.y + 5);
      doc.setFont(FONT, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...(t.accent ? ([255, 255, 255] as [number, number, number]) : C.navy));
      doc.text(t.value, x + 3.5, this.y + 11.5);
    });
    this.y += 15 + 8;
  }

  heading(text: string, note?: string) {
    const { doc } = this;
    this.ensure(18);
    doc.setFillColor(...C.amber);
    doc.rect(PAGE.margin, this.y - 3.6, 1.2, 4.8, 'F');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...C.navy);
    doc.text(text, PAGE.margin + 3.5, this.y);
    if (note) {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(note, PAGE.w - PAGE.margin, this.y, { align: 'right' });
    }
    this.y += 3.5;
  }

  paragraph(text: string) {
    const { doc } = this;
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
    const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
    this.y += 1.5;
    for (const line of lines) {
      this.ensure(5);
      doc.text(line, PAGE.margin, this.y + 3);
      this.y += 4.6;
    }
    this.y += 7;
  }

  /**
   * Table. `money` = column indexes holding amounts (right-aligned).
   * `foot` rows are printed bold on a light band.
   */
  table(opts: {
    head: string[];
    body: RowInput[];
    foot?: RowInput[];
    money?: number[];
    center?: number[];
    widths?: Record<number, number>;
    didParseCell?: (d: CellHookData) => void;
  }) {
    if (!opts.body.length) return;
    this.ensure(22);
    const columnStyles: Record<number, any> = {};
    (opts.money || []).forEach((i) => (columnStyles[i] = { halign: 'right' }));
    (opts.center || []).forEach((i) => (columnStyles[i] = { ...(columnStyles[i] || {}), halign: 'center' }));
    Object.entries(opts.widths || {}).forEach(([i, w]) => (columnStyles[Number(i)] = { ...(columnStyles[Number(i)] || {}), cellWidth: w }));
    autoTable(this.doc, {
      startY: this.y + 1,
      margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.margin + 4, bottom: PAGE.h - PAGE.bottom },
      head: [opts.head],
      body: opts.body,
      foot: opts.foot,
      showFoot: 'lastPage',
      theme: 'plain',
      styles: { font: FONT, fontSize: 8.6, textColor: C.text, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, lineColor: C.line, overflow: 'linebreak' },
      headStyles: { font: FONT, fontStyle: 'bold', fillColor: C.navy, textColor: [255, 255, 255], fontSize: 8.2 },
      footStyles: { font: FONT, fontStyle: 'bold', fillColor: C.navySoft, textColor: C.navy, fontSize: 8.8 },
      alternateRowStyles: { fillColor: C.zebra },
      bodyStyles: { lineWidth: { bottom: 0.1 } as any },
      columnStyles,
      didParseCell: (d) => {
        // Keep the head / foot alignment in line with the amount columns
        if ((d.section === 'head' || d.section === 'foot') && (opts.money || []).includes(d.column.index)) d.cell.styles.halign = 'right';
        if ((d.section === 'head' || d.section === 'foot') && (opts.center || []).includes(d.column.index)) d.cell.styles.halign = 'center';
        opts.didParseCell?.(d);
      },
    });
    this.y = (this.doc as any).lastAutoTable.finalY + 9;
  }

  /** Right-aligned totals box: label / amount rows, last one highlighted. */
  totals(rows: Array<{ label: string; value: string; strong?: boolean; muted?: boolean }>, title = 'Cost summary') {
    const { doc } = this;
    const w = 98;
    const x = PAGE.w - PAGE.margin - w;
    const rowH = 7;
    const h = 9 + rows.length * rowH + (rows.some((r) => r.strong) ? 4 : 2);
    this.ensure(h + 4);
    doc.setDrawColor(...C.line);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, this.y, w, h, 2, 2, 'S');
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.navy);
    doc.text(title.toUpperCase(), x + 4, this.y + 6);
    let y = this.y + 9;
    rows.forEach((r) => {
      if (r.strong) {
        doc.setFillColor(...C.navy);
        doc.rect(x + 0.3, y, w - 0.6, rowH + 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont(FONT, 'bold');
        doc.setFontSize(10);
      } else {
        doc.setTextColor(...(r.muted ? C.muted : C.text));
        doc.setFont(FONT, 'normal');
        doc.setFontSize(8.8);
        doc.setDrawColor(...C.line);
        doc.line(x + 4, y + rowH, x + w - 4, y + rowH);
      }
      doc.text(r.label, x + 4, y + 5);
      doc.text(r.value, x + w - 4, y + 5, { align: 'right' });
      y += rowH + (r.strong ? 1 : 0);
    });
    this.y += h + 8;
  }

  signatures(labels: string[]) {
    const { doc } = this;
    this.ensure(30);
    this.y += 14;
    const w = (CONTENT_W - 10 * (labels.length - 1)) / labels.length;
    labels.forEach((l, i) => {
      const x = PAGE.margin + i * (w + 10);
      doc.setDrawColor(...C.muted);
      doc.setLineWidth(0.3);
      doc.line(x, this.y, x + w, this.y);
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(l, x, this.y + 4.5);
    });
    this.y += 10;
  }

  /** Footer on every page: label, generated time, page x of y. */
  finish(fileName: string) {
    const { doc } = this;
    const pages = doc.getNumberOfPages();
    const stamp = `Generated ${formatDate(new Date(), 'dd MMM yyyy, hh:mm a')}`;
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.3);
      doc.line(PAGE.margin, PAGE.h - 13, PAGE.w - PAGE.margin, PAGE.h - 13);
      doc.setFont(FONT, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      doc.text(`${this.footerLabel}  ·  ${stamp}`, PAGE.margin, PAGE.h - 8.5);
      doc.text(`Page ${i} of ${pages}`, PAGE.w - PAGE.margin, PAGE.h - 8.5, { align: 'right' });
    }
    doc.save(fileName);
  }
}

/** Colour a status cell (Approved green, Pending amber, Rejected red). */
export function statusColour(d: CellHookData, column: number) {
  if (d.section !== 'body' || d.column.index !== column) return;
  const v = String(d.cell.raw || '').toUpperCase();
  d.cell.styles.fontStyle = 'bold';
  if (v.startsWith('APPROVED') || v === 'PAID') d.cell.styles.textColor = C.green;
  else if (v.startsWith('PENDING')) d.cell.styles.textColor = C.orange;
  else if (v.startsWith('REJECTED')) d.cell.styles.textColor = C.red;
}

const SMALL_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'to', 'in']);
export const titleCase = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
