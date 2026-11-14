/**
 * Indian mobile numbers, stored one way everywhere: +91 followed by 10 digits
 * (e.g. +919876543210), so the same number typed two ways is still one number.
 */

/** "+91 98765 43210", "098765-43210", "9876543210" → "+919876543210"; anything else → null. */
export function normalizeIndianMobile(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let digits = String(input).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('+')) return null; // other countries are not supported
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export const MOBILE_REQUIRED_MESSAGE = 'Enter a 10-digit Indian mobile number.';
