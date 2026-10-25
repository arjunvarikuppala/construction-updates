import * as XLSX from 'xlsx';
import { Expense } from '../types/index.js';
import { paiseToRupees } from './currency.js';
import { formatDate } from './dates.js';

export async function downloadExpensesExcel(filterParams: Record<string, string> = {}) {
  const query = new URLSearchParams(filterParams).toString();
  const token = localStorage.getItem('sitetrack_token');

  try {
    const res = await fetch(`/api/v1/export/expenses/excel?${query}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SiteTrack-Expenses-${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      return;
    }
  } catch (err) {
    console.warn('Backend excel export failed, using client SheetJS fallback:', err);
  }
}

export function exportClientExpensesExcel(expenses: Expense[], fileName = 'SiteTrack-Expenses') {
  const data = expenses.map((e) => ({
    'Project Code': e.project?.code || '',
    'Project Name': e.project?.name || '',
    Date: formatDate(e.date, 'yyyy-MM-dd'),
    Category: e.category.replace(/_/g, ' '),
    'Vendor / Payee': e.vendor,
    Description: e.description,
    'Amount (INR)': paiseToRupees(e.amount),
    Status: e.status,
    'Submitted By': e.submittedBy?.name || '',
    'Reviewed By': e.reviewedBy?.name || '',
    'Rejection Reason': e.rejectionReason || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Expenses Register');
  XLSX.writeFile(workbook, `${fileName}-${Date.now()}.xlsx`);
}
