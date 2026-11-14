/** Material stock (material log) shapes and helpers shared by the project tab and the report form. */

export interface MaterialStockRow {
  _id: string;
  name: string;
  unit: string;
  lowStockLevel: number | null;
  balance: number;
  totalIn: number;
  totalOut: number;
  isLow: boolean;
  lastEntryAt: string | null;
}

export interface MaterialStockResponse {
  success: boolean;
  /** First day (YYYY-MM-DD) whose daily reports change the stock */
  startDate: string;
  materials: MaterialStockRow[];
}

export interface MaterialLogRow {
  _id: string;
  materialId: string;
  materialName: string;
  unit: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  change: number;
  balanceAfter: number;
  date: string;
  source: 'MANUAL' | 'REPORT';
  reportId: string | null;
  reportTitle: string | null;
  supplier: string | null;
  billNo: string | null;
  rate: number | null;
  note: string | null;
  createdBy: { _id: string; name: string; role: string } | null;
  createdAt: string;
}

/** Same rule as the server: case and spacing don't matter. */
export function materialKey(name: string, unit: string): string {
  const clean = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return `${clean(name)}|${clean(unit)}`;
}

/** Quantities rounded for display (up to 3 decimals, Indian grouping). */
export function formatQty(n: number): string {
  return (Math.round(n * 1000) / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}
