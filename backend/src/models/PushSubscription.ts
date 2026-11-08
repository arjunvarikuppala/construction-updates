import mongoose, { Schema, Document } from 'mongoose';

/** One browser / phone that asked for push notifications for a user. */
export interface IPushSubscription extends Document {
  user: mongoose.Types.ObjectId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  lastSuccessAt?: Date;
  failures: number;
  createdAt: Date;
  updatedAt: Date;
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true, maxlength: 2048 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 256 },
      auth: { type: String, required: true, maxlength: 128 },
    },
    userAgent: { type: String, maxlength: 300 },
    lastSuccessAt: { type: Date },
    failures: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const PushSubscription = mongoose.model<IPushSubscription>('PushSubscription', PushSubscriptionSchema);
