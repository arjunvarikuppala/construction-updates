/**
 * Material stock per project.
 *
 * Stock goes up when the MD or the in-charge adds stock (or a daily report records
 * material "received"), and goes down when a daily report records material "used".
 * Report entries are rebuilt every time the report is saved, so editing a report
 * corrects the stock too.
 *
 * Tracking starts on MATERIAL_LOG_START: reports for work done before that date
 * never touch the stock (the client chose to start every project from zero).
 */
import mongoose from 'mongoose';
import { ProjectMaterial, MaterialLogEntry, IProjectMaterial } from '../models/MaterialStock.js';

const IST_OFFSET_MS = 330 * 60 * 1000;

/** First IST calendar day whose daily reports change the stock. Override with MATERIAL_LOG_START=YYYY-MM-DD. */
export const MATERIAL_LOG_START_DAY = /^\d{4}-\d{2}-\d{2}$/.test(process.env.MATERIAL_LOG_START || '')
  ? process.env.MATERIAL_LOG_START!
  : '2026-11-14';
export const MATERIAL_LOG_START = new Date(`${MATERIAL_LOG_START_DAY}T00:00:00+05:30`);

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function cleanMaterialName(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
}

export function cleanUnit(unit: unknown): string {
  return String(unit ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

export function materialKey(name: string, unit: string): string {
  return `${cleanMaterialName(name).toLowerCase()}|${cleanUnit(unit).toLowerCase()}`;
}

/** The project's material with this name + unit, created if it is new. */
export async function findOrCreateMaterial(
  projectId: mongoose.Types.ObjectId | string,
  name: string,
  unit: string,
  userId: mongoose.Types.ObjectId | string
): Promise<IProjectMaterial> {
  const key = materialKey(name, unit);
  const filter = { project: projectId, key };
  try {
    return (await ProjectMaterial.findOneAndUpdate(
      filter,
      { $setOnInsert: { project: projectId, key, name: cleanMaterialName(name), unit: cleanUnit(unit), createdBy: userId } },
      { upsert: true, new: true }
    ))!;
  } catch (err: any) {
    // Two saves racing to create the same material: the other one won
    if (err?.code === 11000) {
      const existing = await ProjectMaterial.findOne(filter);
      if (existing) return existing;
    }
    throw err;
  }
}

/** True when a report's work date falls inside stock tracking. */
export function reportCountsForStock(report: { status?: string; workDate?: Date | string }): boolean {
  if (report.status !== 'SUBMITTED' || !report.workDate) return false;
  return new Date(report.workDate).getTime() >= MATERIAL_LOG_START.getTime();
}

/**
 * Rebuild the stock entries of one daily report from its materials rows:
 * "received" adds stock, "used" (quantity) takes it away.
 */
export async function syncReportMaterials(report: {
  _id: mongoose.Types.ObjectId;
  project: mongoose.Types.ObjectId;
  submittedBy: mongoose.Types.ObjectId;
  status?: string;
  workDate?: Date;
  titleOfWork?: string;
  materials?: Array<{ name: string; unit: string; quantity?: number; received?: number; supplier?: string; billNo?: string; rate?: number }>;
}): Promise<void> {
  await MaterialLogEntry.deleteMany({ report: report._id });
  if (!reportCountsForStock(report)) return;

  const docs: any[] = [];
  for (const m of report.materials || []) {
    const name = cleanMaterialName(m.name);
    const unit = cleanUnit(m.unit) || 'units';
    const used = Number(m.quantity) || 0;
    const received = Number(m.received) || 0;
    if (!name || (used <= 0 && received <= 0)) continue;
    const material = await findOrCreateMaterial(report.project, name, unit, report.submittedBy);
    const base = {
      project: report.project,
      material: material._id,
      date: report.workDate,
      source: 'REPORT',
      report: report._id,
      reportTitle: report.titleOfWork,
      createdBy: report.submittedBy,
    };
    if (received > 0) {
      docs.push({ ...base, type: 'IN', change: round3(received), supplier: m.supplier, billNo: m.billNo, rate: m.rate });
    }
    if (used > 0) docs.push({ ...base, type: 'OUT', change: -round3(used), rate: m.rate });
  }
  if (docs.length) await MaterialLogEntry.insertMany(docs);
}

export interface MaterialStockRow {
  _id: string;
  name: string;
  unit: string;
  lowStockLevel: number | null;
  balance: number;
  totalIn: number;
  totalOut: number;
  isLow: boolean;
  lastEntryAt: string | null;
}

/** Every material on the project with its current balance. */
export async function getProjectStock(projectId: mongoose.Types.ObjectId): Promise<MaterialStockRow[]> {
  const [materials, sums] = await Promise.all([
    ProjectMaterial.find({ project: projectId }).sort({ name: 1 }).lean(),
    MaterialLogEntry.aggregate([
      { $match: { project: projectId } },
      {
        $group: {
          _id: '$material',
          balance: { $sum: '$change' },
          totalIn: { $sum: { $cond: [{ $gt: ['$change', 0] }, '$change', 0] } },
          totalOut: { $sum: { $cond: [{ $lt: ['$change', 0] }, '$change', 0] } },
          last: { $max: '$date' },
        },
      },
    ]),
  ]);
  const byId = new Map(sums.map((s: any) => [String(s._id), s]));
  return materials.map((m: any) => {
    const s: any = byId.get(String(m._id)) || {};
    const balance = round3(s.balance || 0);
    const low = typeof m.lowStockLevel === 'number' ? m.lowStockLevel : null;
    return {
      _id: String(m._id),
      name: m.name,
      unit: m.unit,
      lowStockLevel: low,
      balance,
      totalIn: round3(s.totalIn || 0),
      totalOut: round3(-(s.totalOut || 0)),
      isLow: balance < 0 || (low !== null && balance <= low),
      lastEntryAt: s.last ? new Date(s.last).toISOString() : null,
    };
  });
}

/** Current balance of one material. */
export async function getMaterialBalance(materialId: mongoose.Types.ObjectId): Promise<number> {
  const [row] = await MaterialLogEntry.aggregate([
    { $match: { material: materialId } },
    { $group: { _id: null, balance: { $sum: '$change' } } },
  ]);
  return round3(row?.balance || 0);
}

/** Calendar day (IST) to a Date: today's entries keep the current time so they sort in order. */
export function entryDateFor(day: unknown, now = new Date()): Date | null {
  if (day === undefined || day === null || day === '') return now;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const todayIst = new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  if (day === todayIst) return now;
  const d = new Date(`${day}T12:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > now.getTime()) return null; // no future-dated stock
  return d;
}

export { round3 };
