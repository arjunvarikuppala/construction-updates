import mongoose, { Schema, Document } from 'mongoose';

export interface IReportView extends Document {
  report: mongoose.Types.ObjectId;
  project: mongoose.Types.ObjectId;
  viewer: mongoose.Types.ObjectId;
  viewerRole: string;
  reportVersion: number;
  firstViewedAt: Date;
  lastViewedAt: Date;
  reportUpdatedAtSnapshot: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReportViewSchema = new Schema<IReportView>(
  {
    report: {
      type: Schema.Types.ObjectId,
      ref: 'DailyReport',
      required: [true, 'Report reference is required'],
      index: true,
    },
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project reference is required'],
      index: true,
    },
    viewer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Viewer user reference is required'],
      index: true,
    },
    viewerRole: {
      type: String,
      required: true,
      default: 'MD',
      index: true,
    },
    reportVersion: {
      type: Number,
      required: true,
      default: 1,
    },
    firstViewedAt: {
      type: Date,
      default: Date.now,
    },
    lastViewedAt: {
      type: Date,
      default: Date.now,
    },
    reportUpdatedAtSnapshot: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

ReportViewSchema.index({ report: 1, viewer: 1 }, { unique: true });
ReportViewSchema.index({ report: 1, lastViewedAt: -1 });

export const ReportView = mongoose.model<IReportView>('ReportView', ReportViewSchema);
