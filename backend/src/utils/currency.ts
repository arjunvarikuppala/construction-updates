/**
 * SiteTrack Monetary Helpers
 * All monetary values are strictly stored as integer paise to avoid IEEE-754 floating-point inaccuracies.
 * ₹1 = 100 paise.
 */

export function rupeesToPaise(rupees: number | string): number {
  const numeric = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (isNaN(numeric) || numeric < 0) {
    throw new Error('Invalid monetary amount');
  }
  return Math.round(numeric * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

export function formatIndianCurrency(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(rupees);
}
