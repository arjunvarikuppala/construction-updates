import mongoose, { Schema, Document } from 'mongoose';

/**
 * One row per site, day and kind of alert, so a reminder or escalation is sent
 * at most once a day even if the server restarts or the job runs again.
 */
export interface IReportReminderLog extends Document {
  project: mongoose.Types.ObjectId;
  day: string; // YYYY-MM-DD (IST)
  kind: 'REMINDER' | 'ESCALATION';
  sentAt: Date;
}

const ReportReminderLogSchema = new Schema<IReportReminderLog>({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  day: { type: String, required: true },
  kind: { type: String, enum: ['REMINDER', 'ESCALATION'], required: true },
  sentAt: { type: Date, default: Date.now },
});

ReportReminderLogSchema.index({ project: 1, day: 1, kind: 1 }, { unique: true });
// Old rows are only needed for a few days
ReportReminderLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

export const ReportReminderLog = mongoose.model<IReportReminderLog>('ReportReminderLog', ReportReminderLogSchema);
