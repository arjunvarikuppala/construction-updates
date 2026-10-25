import mongoose, { Schema, Document } from 'mongoose';

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED';

export interface IInvitation extends Document {
  email: string;
  name: string;
  token: string;
  role: 'SITE_INCHARGE';
  project?: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InvitationSchema = new Schema<IInvitation>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 100,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['SITE_INCHARGE'],
      default: 'SITE_INCHARGE',
    },
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: false,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'EXPIRED'],
      default: 'PENDING',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days validity
    },
  },
  {
    timestamps: true,
  }
);

export const Invitation = mongoose.model<IInvitation>('Invitation', InvitationSchema);
