import mongoose, { Schema, Document } from 'mongoose';

/** Company profile (BKR INFRA) owned by its MD: legal name, GSTIN, address. */
export interface ICompanySettings extends Document {
  owner: mongoose.Types.ObjectId;
  legalName?: string;
  gstin?: string;
  address?: string;
  /** Daily report reminders: remind the In-Charge, then tell the MD if still missing */
  reportReminders?: {
    enabled: boolean;
    reminderTime: string; // "HH:MM" IST
    escalationTime: string; // "HH:MM" IST
    workDays: number[]; // 0 = Sunday … 6 = Saturday
  };
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CompanySettingsSchema = new Schema<ICompanySettings>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    legalName: { type: String, trim: true, maxlength: 150 },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 15 },
    address: { type: String, trim: true, maxlength: 500 },
    reportReminders: {
      enabled: { type: Boolean, default: true },
      reminderTime: { type: String, default: '18:00' },
      escalationTime: { type: String, default: '20:00' },
      workDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const CompanySettings = mongoose.model<ICompanySettings>('CompanySettings', CompanySettingsSchema);
