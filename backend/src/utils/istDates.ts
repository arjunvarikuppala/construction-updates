/** BKR INFRA works in India: calendar days are IST (UTC+5:30). */
const IST_OFFSET_MS = 330 * 60 * 1000;

/** End of today in IST (23:59:59.999), as a Date. Anything after this is "in the future". */
export function localDayEnd(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const endIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 23, 59, 59, 999);
  return new Date(endIst - IST_OFFSET_MS);
}

/** [from, to) window for an IST calendar month given as YYYY-MM, or null if invalid. */
export function istMonthWindow(month: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS), to: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS) };
}

/** YYYY-MM-DD for a Date in IST */
export function istDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM for now in IST */
export function istMonthString(now: Date = new Date()): string {
  return istDateString(now).slice(0, 7);
}
