import mongoose, { Schema, Document } from 'mongoose';
import { ReportStatus, WorkItem, LabourCountItem, SitePhoto } from '../types/index.js';

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
  equipmentDetails?: string;
  issuesAndDelays?: string;
  nextDayPlan?: string;
  photos: SitePhoto[];
  status: ReportStatus;
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
      required: [true, 'Work summary is required'],
      trim: true,
      maxlength: 2000,
    },
    workItems: [
      {
        description: { type: String, required: true, trim: true },
        quantity: { type: Number, required: true, min: 0 },
        unit: { type: String, required: true, trim: true },
      },
    ],
    labourBreakdown: [
      {
        role: { type: String, required: true, trim: true },
        count: { type: Number, required: true, min: 0 },
      },
    ],
    totalLabourCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
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
  },
  {
    timestamps: true,
  }
);

// Compound index for querying project reports by date
DailyReportSchema.index({ project: 1, workDate: -1 });

export const DailyReport = mongoose.model<IDailyReport>('DailyReport', DailyReportSchema);
