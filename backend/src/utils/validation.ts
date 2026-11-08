import mongoose from 'mongoose';

/** Escape user input before using it inside a MongoDB $regex. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 200);
}

export function isObjectId(value: unknown): boolean {
  return typeof value === 'string' || value instanceof mongoose.Types.ObjectId
    ? mongoose.Types.ObjectId.isValid(String(value))
    : false;
}

/** Trim a value to a string of bounded length, or undefined when empty/not a string. */
export function cleanText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const s = String(value).trim();
  return s ? s.slice(0, maxLength) : undefined;
}

/** Non-negative finite number, else the fallback. */
export function nonNegativeNumber(value: unknown, fallback = 0, max = 1e12): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

/** Parse a date string; returns null for invalid dates. */
export function parseDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}
