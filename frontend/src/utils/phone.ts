/** Indian mobile numbers, same rule as the server: 10 digits starting 6–9, with an optional +91 / 91 / 0 in front. */
export function normalizeIndianMobile(input: string): string | null {
  let digits = String(input || '').replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('+')) return null;
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export const MOBILE_HELP = 'Every account needs a mobile number.';
export const MOBILE_ERROR = 'Enter a 10-digit Indian mobile number.';

/** "+919876543210" → "+91 98765 43210" */
export function formatMobile(phone?: string | null): string {
  const n = phone ? normalizeIndianMobile(phone) : null;
  return n ? `+91 ${n.slice(3, 8)} ${n.slice(8)}` : phone || '';
}
