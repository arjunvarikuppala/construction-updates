import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  action: string;
  performedBy: mongoose.Types.ObjectId;
  entityType: 'PROJECT' | 'DAILY_REPORT' | 'EXPENSE' | 'USER';
  entityId: mongoose.Types.ObjectId;
  details?: Record<string, any>;
  ip?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: {
      type: String,
      required: true,
      index: true,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ['PROJECT', 'DAILY_REPORT', 'EXPENSE', 'USER'],
      required: true,
      index: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    details: {
      type: Schema.Types.Mixed,
    },
    ip: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
