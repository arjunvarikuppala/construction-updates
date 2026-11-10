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

export type MessageType = 'TEXT' | 'ATTACHMENT' | 'MIXED';

export interface IProjectMessage extends Document {
  project: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  content: string;
  messageType: MessageType;
  replyTo?: mongoose.Types.ObjectId;
  clientMessageId?: string;
  attachments: IMessageAttachment[];
  contextType: MessageContextType;
  contextId?: string;
  contextSummary?: string;
  readBy: Array<{
    user: mongoose.Types.ObjectId;
    readAt: Date;
  }>;
  reactions: Array<{
    emoji: string;
    user: mongoose.Types.ObjectId;
    createdAt: Date;
  }>;
  editedAt?: Date;
  deletedAt?: Date;
  deletedBy?: mongoose.Types.ObjectId;
  pinnedAt?: Date;
  pinnedBy?: mongoose.Types.ObjectId;
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
    messageType: {
      type: String,
      enum: ['TEXT', 'ATTACHMENT', 'MIXED'],
      default: 'TEXT',
    },
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: 'ProjectMessage',
    },
    // Client-generated idempotency key: retries / reconnects never create duplicates
    clientMessageId: {
      type: String,
      trim: true,
      maxlength: 64,
    },
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
    reactions: [
      {
        emoji: { type: String, required: true, maxlength: 16 },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        createdAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    editedAt: { type: Date },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    pinnedAt: { type: Date, index: true },
    pinnedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  }
);

ProjectMessageSchema.pre('validate', function (next) {
  // A message "deleted for everyone" keeps its slot in the thread but carries no content
  if (this.deletedAt) return next();
  const hasContent = Boolean(this.content && this.content.trim().length > 0);
  const hasAttachments = Array.isArray(this.attachments) && this.attachments.length > 0;
  if (!hasContent && !hasAttachments) {
    this.invalidate('content', 'Message must contain either text or at least one attachment.');
  }
  this.messageType = hasAttachments ? (hasContent ? 'MIXED' : 'ATTACHMENT') : 'TEXT';
  next();
});

ProjectMessageSchema.index({ project: 1, createdAt: -1 });
ProjectMessageSchema.index(
  { sender: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } }
);

export const ProjectMessage = mongoose.model<IProjectMessage>('ProjectMessage', ProjectMessageSchema);
