import { ExpenseCategory, LabourCategory, ReportShift, WorkItemStatus } from '../types/index.js';

export const EXPENSE_CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'CONSTRUCTION_MATERIALS', label: 'Construction Materials' },
  { value: 'LABOUR', label: 'Labour' },
  { value: 'DIESEL_AND_FUEL', label: 'Diesel and Fuel' },
  { value: 'MACHINERY_AND_EQUIPMENT', label: 'Machinery and Equipment' },
  { value: 'TRANSPORTATION', label: 'Transportation' },
  { value: 'FOOD_AND_ACCOMMODATION', label: 'Food and Accommodation' },
  { value: 'REPAIRS_AND_MAINTENANCE', label: 'Repairs and Maintenance' },
  { value: 'OTHER', label: 'Other' },
];

export const expenseCategoryLabel = (c?: string) =>
  EXPENSE_CATEGORY_OPTIONS.find((o) => o.value === c)?.label || c || '—';

export const UNIT_OPTIONS = ['sq.m', 'sq.ft', 'cu.m', 'cu.ft', 'r.m', 'meters', 'Tons', 'kg', 'bags', 'nos', 'units', 'trips', 'litres', 'hours'];

export const WORK_STATUS_OPTIONS: Array<{ value: WorkItemStatus; label: string; tone: string }> = [
  { value: 'COMPLETED', label: 'Completed', tone: 'emerald' },
  { value: 'IN_PROGRESS', label: 'In progress', tone: 'amber' },
  { value: 'NOT_STARTED', label: 'Not started', tone: 'slate' },
];

export const LABOUR_CATEGORY_OPTIONS: Array<{ value: LabourCategory; label: string }> = [
  { value: 'SKILLED', label: 'Skilled' },
  { value: 'UNSKILLED', label: 'Unskilled' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'OTHER', label: 'Other' },
];

export const labourCategoryLabel = (c?: string) =>
  LABOUR_CATEGORY_OPTIONS.find((o) => o.value === c)?.label || 'Uncategorised';

/** Common trades with their default category so most rows need one tap. */
export const LABOUR_PRESETS: Array<{ role: string; category: LabourCategory }> = [
  { role: 'Mason', category: 'SKILLED' },
  { role: 'Helper (Male)', category: 'UNSKILLED' },
  { role: 'Helper (Female)', category: 'UNSKILLED' },
  { role: 'Bar Bender', category: 'SKILLED' },
  { role: 'Carpenter / Shuttering', category: 'SKILLED' },
  { role: 'Plumber', category: 'SKILLED' },
  { role: 'Electrician', category: 'SKILLED' },
  { role: 'Painter', category: 'SKILLED' },
  { role: 'Welder', category: 'SKILLED' },
  { role: 'Machine Operator', category: 'SKILLED' },
  { role: 'Site Supervisor', category: 'SUPERVISOR' },
  { role: 'Foreman', category: 'SUPERVISOR' },
  { role: 'Other', category: 'OTHER' },
];

export const SHIFT_OPTIONS: Array<{ value: ReportShift; label: string }> = [
  { value: 'DAY', label: 'Day shift' },
  { value: 'NIGHT', label: 'Night shift' },
  { value: 'GENERAL', label: 'General (9–6)' },
  { value: 'DOUBLE', label: 'Double shift' },
];

export const shiftLabel = (s?: string) => SHIFT_OPTIONS.find((o) => o.value === s)?.label;

export const MATERIAL_SUGGESTIONS = [
  'Cement (OPC 53)',
  'Cement (PPC)',
  'TMT Steel',
  'River Sand',
  'M-Sand',
  'Aggregate 20mm',
  'Aggregate 10mm',
  'Red Bricks',
  'AAC Blocks',
  'Ready-Mix Concrete',
  'Binding Wire',
  'Shuttering Plywood',
];

export const MACHINERY_SUGGESTIONS = [
  'JCB / Backhoe',
  'Concrete Mixer',
  'Transit Mixer',
  'Concrete Pump',
  'Tower Crane',
  'Needle Vibrator',
  'Excavator',
  'Tipper Truck',
  'DG Set',
  'Bar Bending Machine',
];

/** ₹ cost of a material row: quantity × rate per unit. */
export const materialCost = (m: { quantity?: number; rate?: number }) => (Number(m.quantity) || 0) * (Number(m.rate) || 0);

type MachineCostInput = {
  quantity?: number;
  rate?: number;
  rateBasis?: 'DAY' | 'HOUR' | 'TRIP';
  hoursUsed?: number;
  trips?: number;
  dieselLitres?: number;
  dieselRate?: number;
  bata?: number;
};
const n = (v: unknown) => Number(v) || 0;

/** ₹ hire of a machinery row: per day = machines × rate; per hour = machines × hours × rate; per trip = trips × rate. */
export const machineHire = (m: MachineCostInput) =>
  m.rateBasis === 'TRIP' ? n(m.trips) * n(m.rate) : n(m.quantity) * n(m.rate) * (m.rateBasis === 'HOUR' ? n(m.hoursUsed) : 1);

/** ₹ total of a machinery row: hire + diesel + operator bata (same rule as the server). */
export const machineCost = (m: MachineCostInput) => machineHire(m) + n(m.dieselLitres) * n(m.dieselRate) + n(m.bata);

/** ₹ cost of a labour row: workers × daily wage + workers × overtime hours × overtime rate. */
export const labourCost = (l: { count?: number; wagePerDay?: number; otHours?: number; otRate?: number }) =>
  n(l.count) * n(l.wagePerDay) + n(l.count) * n(l.otHours) * n(l.otRate);
