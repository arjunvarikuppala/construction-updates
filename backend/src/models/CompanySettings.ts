import mongoose, { Schema, Document } from 'mongoose';

/** Company profile (BKR INFRA) owned by its MD: legal name, GSTIN, address. */
export interface ICompanySettings extends Document {
  owner: mongoose.Types.ObjectId;
  legalName?: string;
  gstin?: string;
  address?: string;
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
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const CompanySettings = mongoose.model<ICompanySettings>('CompanySettings', CompanySettingsSchema);
