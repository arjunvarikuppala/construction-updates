/**
 * Project material stock (the "material log").
 *
 * ProjectMaterial   one row per material kept on a project's site (River sand · tons).
 * MaterialLogEntry  every change to its stock: stock added, used in a daily report,
 *                   or a count correction. Balance = sum of `change`.
 *
 * Entries that come from a daily report carry `report`; they are rebuilt whenever
 * the report is saved and cannot be edited on their own.
 */
import mongoose, { Schema, Document } from 'mongoose';

export type MaterialEntryType = 'IN' | 'OUT' | 'ADJUST';
export type MaterialEntrySource = 'MANUAL' | 'REPORT';

export interface IProjectMaterial extends Document {
  project: mongoose.Types.ObjectId;
  name: string;
  unit: string;
  /** lower-cased name|unit, unique per project */
  key: string;
  /** Show "Low stock" at or below this balance */
  lowStockLevel?: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMaterialLogEntry extends Document {
  project: mongoose.Types.ObjectId;
  material: mongoose.Types.ObjectId;
  type: MaterialEntryType;
  /** Signed: + adds to stock, − takes from it */
  change: number;
  date: Date;
  source: MaterialEntrySource;
  report?: mongoose.Types.ObjectId;
  reportTitle?: string;
  supplier?: string;
  billNo?: string;
  rate?: number;
  note?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectMaterialSchema = new Schema<IProjectMaterial>(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    unit: { type: String, required: true, trim: true, maxlength: 30 },
    key: { type: String, required: true },
    lowStockLevel: { type: Number, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
ProjectMaterialSchema.index({ project: 1, key: 1 }, { unique: true });

const MaterialLogEntrySchema = new Schema<IMaterialLogEntry>(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    material: { type: Schema.Types.ObjectId, ref: 'ProjectMaterial', required: true, index: true },
    type: { type: String, enum: ['IN', 'OUT', 'ADJUST'], required: true },
    change: { type: Number, required: true },
    date: { type: Date, required: true },
    source: { type: String, enum: ['MANUAL', 'REPORT'], required: true },
    report: { type: Schema.Types.ObjectId, ref: 'DailyReport', index: true },
    reportTitle: { type: String, trim: true, maxlength: 200 },
    supplier: { type: String, trim: true, maxlength: 150 },
    billNo: { type: String, trim: true, maxlength: 60 },
    rate: { type: Number, min: 0 },
    note: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
MaterialLogEntrySchema.index({ project: 1, date: 1, createdAt: 1 });

export const ProjectMaterial = mongoose.model<IProjectMaterial>('ProjectMaterial', ProjectMaterialSchema);
export const MaterialLogEntry = mongoose.model<IMaterialLogEntry>('MaterialLogEntry', MaterialLogEntrySchema);
