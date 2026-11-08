import mongoose, { Schema, Document } from 'mongoose';
import {
  ReportStatus,
  WorkItem,
  LabourCountItem,
  SitePhoto,
  MaterialItem,
  MachineryItem,
  ReportShift,
} from '../types/index.js';

export interface IReportComment {
  _id?: mongoose.Types.ObjectId;
  author: mongoose.Types.ObjectId;
  authorName: string;
  authorRole: string;
  message: string;
  type: 'COMMENT' | 'CHANGES_REQUESTED' | 'CORRECTION_REQUIRED';
  createdAt: Date;
}

export interface IDailyReport extends Document {
  project: mongoose.Types.ObjectId;
  submittedBy: mongoose.Types.ObjectId;
  lastEditedBy?: mongoose.Types.ObjectId;
  titleOfWork: string;
  workDate: Date;
  workSummary: string;
  workItems: WorkItem[];
  labourBreakdown: LabourCountItem[];
  totalLabourCount: number;
  totalLabourCost?: number;
  totalWorkBudget?: number;
  equipmentDetails?: string;
  issuesAndDelays?: string;
  nextDayPlan?: string;
  photos: SitePhoto[];
  status: ReportStatus;
  version: number;
  // ---- Detailed site register fields (all optional; older reports simply lack them) ----
  shift?: ReportShift;
  workLocation?: string;
  remarks?: string;
  /** Overall site completion % reported by the In-Charge on this date */
  overallProgressPercent?: number;
  materials: MaterialItem[];
  machinery: MachineryItem[];
  submittedAt?: Date;
  /** Client-generated idempotency key; prevents duplicate creation on double-tap / retry */
  clientRequestId?: string;
  comments?: IReportComment[];
  createdAt: Date;
  updatedAt: Date;
}

const DailyReportSchema = new Schema<IDailyReport>(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project is required'],
      index: true,
    },
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Submitted by user is required'],
      index: true,
    },
    lastEditedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    titleOfWork: {
      type: String,
      required: [true, 'Title of work is required'],
      trim: true,
      maxlength: 200,
      index: true,
    },
    workDate: {
      type: Date,
      required: [true, 'Work date is required'],
      index: true,
    },
    workSummary: {
      type: String,
      // Drafts may be saved before the description is written; submission requires it.
      required: [
        function (this: any) {
          return this.status === 'SUBMITTED';
        },
        'Work summary is required',
      ],
      default: '',
      trim: true,
      maxlength: 2000,
    },
    workItems: [
      {
        description: { type: String, required: true, trim: true, maxlength: 300 },
        quantity: { type: Number, required: true, min: 0 },
        unit: { type: String, required: true, trim: true, maxlength: 30 },
        rate: { type: Number, min: 0 }, // ₹ per unit (per hour, per ton, ...)
        budget: { type: Number, default: 0, min: 0 },
        location: { type: String, trim: true, maxlength: 150 },
        status: { type: String, enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] },
        progressPercent: { type: Number, min: 0, max: 100 },
        remarks: { type: String, trim: true, maxlength: 500 },
      },
    ],
    labourBreakdown: [
      {
        role: { type: String, required: true, trim: true, maxlength: 80 },
        count: { type: Number, required: true, min: 0 },
        category: { type: String, enum: ['SKILLED', 'UNSKILLED', 'SUPERVISOR', 'OTHER'] },
        hours: { type: Number, min: 0, max: 24 },
        wagePerDay: { type: Number, min: 0 }, // ₹ per worker per day
      },
    ],
    materials: {
      type: [
        {
          name: { type: String, required: true, trim: true, maxlength: 150 },
          quantity: { type: Number, required: true, min: 0 },
          unit: { type: String, required: true, trim: true, maxlength: 30 },
          remarks: { type: String, trim: true, maxlength: 300 },
        },
      ],
      default: [],
    },
    machinery: {
      type: [
        {
          name: { type: String, required: true, trim: true, maxlength: 150 },
          quantity: { type: Number, required: true, min: 0 },
          hoursUsed: { type: Number, min: 0, max: 24 },
          remarks: { type: String, trim: true, maxlength: 300 },
        },
      ],
      default: [],
    },
    shift: { type: String, enum: ['DAY', 'NIGHT', 'GENERAL', 'DOUBLE'] },
    workLocation: { type: String, trim: true, maxlength: 200 },
    remarks: { type: String, trim: true, maxlength: 1000 },
    overallProgressPercent: { type: Number, min: 0, max: 100 },
    submittedAt: { type: Date },
    clientRequestId: { type: String, trim: true, maxlength: 64 },
    totalLabourCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    totalWorkBudget: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalLabourCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    equipmentDetails: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    issuesAndDelays: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    nextDayPlan: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    photos: [
      {
        url: { type: String, required: true },
        caption: { type: String, trim: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    status: {
      type: String,
      enum: ['DRAFT', 'SUBMITTED'],
      default: 'SUBMITTED',
      index: true,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    comments: [
      {
        author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        authorName: { type: String, required: true },
        authorRole: { type: String, required: true },
        message: { type: String, required: true, trim: true },
        type: {
          type: String,
          enum: ['COMMENT', 'CHANGES_REQUESTED', 'CORRECTION_REQUIRED'],
          default: 'COMMENT',
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Compound index for querying project reports by date
DailyReportSchema.index({ project: 1, workDate: -1 });
// Idempotency: one report per (author, clientRequestId). Sparse so legacy rows are unaffected.
DailyReportSchema.index(
  { submittedBy: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } }
);

export const DailyReport = mongoose.model<IDailyReport>('DailyReport', DailyReportSchema);
