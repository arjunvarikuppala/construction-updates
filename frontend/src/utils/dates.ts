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
