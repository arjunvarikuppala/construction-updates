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
  | 'DAILY_REPORT_COMMENT'
  | 'DAILY_REPORT_CHANGES_REQUESTED'
  | 'DAILY_REPORT_REJECTED'
  | 'EXPENSE_SUBMITTED'
  | 'EXPENSE_APPROVED'
  | 'EXPENSE_REJECTED'
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

/**
 * Every new notification also goes to the recipient's phone / computer as a
 * Web Push (works with the website closed). Notes to yourself
 * ("Report submitted successfully") stay in-app only.
 */
NotificationSchema.post('save', function (doc) {
  if (!(doc as any).$__wasNew) return;
  if (doc.sender && String(doc.sender) === String(doc.recipient)) return;
  import('../services/pushService.js')
    .then(({ sendPushToUser, notificationUrl }) =>
      sendPushToUser(doc.recipient, {
        title: doc.title,
        body: doc.message,
        url: notificationUrl(doc as any),
        // One notification per chat / request on the lock screen, updated in place
        tag: doc.relatedEntity === 'PROJECT_MESSAGE' ? `chat-${String(doc.project || '')}` : `${doc.relatedEntity || 'n'}-${doc.relatedId || doc._id}`,
        id: String(doc._id),
      })
    )
    .catch((err) => console.error('Push dispatch failed:', err?.message));
});
NotificationSchema.pre('save', function (next) {
  (this as any).$__wasNew = this.isNew;
  next();
});

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
