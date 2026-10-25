export function paiseToRupees(paise: number): number {
  return (paise || 0) / 100;
}

export function rupeesToPaise(rupees: number | string): number {
  const numeric = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (isNaN(numeric) || numeric < 0) return 0;
  return Math.round(numeric * 100);
}

export function formatINR(paise: number): string {
  const rupees = paiseToRupees(paise);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(rupees);
}

export function formatCompactINR(paise: number): string {
  const rupees = paiseToRupees(paise);
  if (rupees >= 10000000) {
    return `₹${(rupees / 10000000).toFixed(2).replace(/\.00$/, '')} Cr`;
  }
  if (rupees >= 100000) {
    return `₹${(rupees / 100000).toFixed(2).replace(/\.00$/, '')} L`;
  }
  if (rupees >= 1000) {
    return `₹${(rupees / 1000).toFixed(1).replace(/\.0$/, '')} k`;
  }
  return formatINR(paise);
}
