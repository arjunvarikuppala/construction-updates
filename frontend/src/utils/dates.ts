import { format, parseISO, isValid } from 'date-fns';

export function formatDate(dateVal: string | Date | undefined | null, formatStr = 'dd MMM yyyy'): string {
  if (!dateVal) return 'N/A';
  try {
    const d = typeof dateVal === 'string' ? parseISO(dateVal) : dateVal;
    if (!isValid(d)) return 'N/A';
    return format(d, formatStr);
  } catch {
    return 'N/A';
  }
}

export function formatDateTime(dateVal: string | Date | undefined | null): string {
  return formatDate(dateVal, 'dd MMM yyyy, hh:mm a');
}

/** yyyy-mm-dd in the device's local time zone (India), not UTC. */
export function localDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** yyyy-mm in the device's local time zone. */
export function localMonthString(d: Date = new Date()): string {
  return localDateString(d).slice(0, 7);
}
