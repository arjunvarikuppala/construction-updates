import mongoose, { Schema, Document } from 'mongoose';

/**
 * Ownership record for locally stored uploads. Lets the uploader preview a file
 * (e.g. a receipt on an unsaved draft) before it is attached to any record.
 * Access for everyone else is derived from the record that references the file.
 */
export interface IUploadedFile extends Document {
  filename: string;
  url: string;
  uploadedBy: mongoose.Types.ObjectId;
  mimetype?: string;
  size?: number;
  createdAt: Date;
}

const UploadedFileSchema = new Schema<IUploadedFile>(
  {
    filename: { type: String, required: true, index: true },
    url: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mimetype: { type: String },
    size: { type: Number },
  },
  { timestamps: true }
);

export const UploadedFile = mongoose.model<IUploadedFile>('UploadedFile', UploadedFileSchema);
