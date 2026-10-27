import mongoose, { Schema, Document } from 'mongoose';

export type MessageContextType = 'GENERAL' | 'DAILY_REPORT' | 'EXPENSE' | 'PAYMENT_REQUEST';

export interface IMessageAttachment {
  url: string;
  name: string;
  type: 'image' | 'video' | 'pdf' | 'document' | 'other' | string;
  mimeType?: string;
  size?: number;
  storageKey?: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
}

export interface IProjectMessage extends Document {
  project: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  content: string;
  attachments: IMessageAttachment[];
  contextType: MessageContextType;
  contextId?: string;
  contextSummary?: string;
  readBy: Array<{
    user: mongoose.Types.ObjectId;
    readAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const MessageAttachmentSchema = new Schema<IMessageAttachment>(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, default: 'image' },
    mimeType: { type: String },
    size: { type: Number },
    storageKey: { type: String },
    width: { type: Number },
    height: { type: Number },
    duration: { type: Number },
    thumbnailUrl: { type: String },
  },
  { _id: false }
);

const ProjectMessageSchema = new Schema<IProjectMessage>(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project reference is required'],
      index: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Sender is required'],
      index: true,
    },
    content: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: '',
    },
    attachments: [MessageAttachmentSchema],
    contextType: {
      type: String,
      enum: ['GENERAL', 'DAILY_REPORT', 'EXPENSE', 'PAYMENT_REQUEST'],
      default: 'GENERAL',
      index: true,
    },
    contextId: {
      type: String,
      index: true,
    },
    contextSummary: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    readBy: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
  },
  {
    timestamps: true,
  }
);

ProjectMessageSchema.pre('validate', function (next) {
  const hasContent = Boolean(this.content && this.content.trim().length > 0);
  const hasAttachments = Array.isArray(this.attachments) && this.attachments.length > 0;
  if (!hasContent && !hasAttachments) {
    this.invalidate('content', 'Message must contain either text or at least one attachment.');
  }
  next();
});

ProjectMessageSchema.index({ project: 1, createdAt: -1 });

export const ProjectMessage = mongoose.model<IProjectMessage>('ProjectMessage', ProjectMessageSchema);
