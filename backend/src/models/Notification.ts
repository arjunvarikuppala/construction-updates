import mongoose, { Schema, Document } from 'mongoose';

export type NotificationType =
  | 'PAYMENT_REQUEST_NEW'
  | 'PAYMENT_REQUEST_REVIEW'
  | 'PAYMENT_REQUEST_AUTHORIZED'
  | 'PAYMENT_REQUEST_REJECTED'
  | 'PAYMENT_REQUEST_PAID'
  | 'PROJECT_MESSAGE'
  | 'DAILY_REPORT_SUBMITTED'
  | 'DAILY_REPORT_VIEWED'
  | 'SYSTEM';

export type NotificationRelatedEntity =
  | 'PAYMENT_REQUEST'
  | 'PROJECT_MESSAGE'
  | 'DAILY_REPORT'
  | 'EXPENSE'
  | 'PROJECT';

export interface INotification extends Document {
  recipient: mongoose.Types.ObjectId;
  sender?: mongoose.Types.ObjectId;
  project?: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntity?: NotificationRelatedEntity;
  relatedId?: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Notification recipient is required'],
      index: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      index: true,
    },
    type: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    relatedEntity: {
      type: String,
      enum: ['PAYMENT_REQUEST', 'PROJECT_MESSAGE', 'DAILY_REPORT', 'EXPENSE', 'PROJECT'],
    },
    relatedId: {
      type: String,
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
