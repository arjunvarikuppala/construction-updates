import mongoose, { Schema, Document } from 'mongoose';
import { PayeeType } from './Beneficiary.js';

export type PaymentMethod = 'NEFT' | 'RTGS';

export type PaymentRequestStatus =
  | 'DRAFT'
  | 'AWAITING_AUTHORIZATION'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'UNKNOWN';

export interface IPaymentAuditEntry {
  timestamp: Date;
  action: string;
  performedBy: mongoose.Types.ObjectId;
  note?: string;
  ip?: string;
}

export interface IPaymentRequest extends Document {
  paymentReference: string;
  idempotencyKey: string;
  project: mongoose.Types.ObjectId;
  expense?: mongoose.Types.ObjectId;
  beneficiary: mongoose.Types.ObjectId;
  payeeNameSnapshot: string;
  accountNumberMaskedSnapshot: string;
  ifscSnapshot: string;
  bankNameSnapshot: string;
  payeeType: PayeeType;
  amount: number; // Stored as integer PAISE (e.g. ₹1,00,000 = 10000000 paise)
  paymentMethod: PaymentMethod;
  invoiceNumber?: string;
  purpose: string;
  status: PaymentRequestStatus;
  requiresHighValueAuth: boolean;
  authorizedBy?: mongoose.Types.ObjectId;
  authorizedAt?: Date;
  authorizationNotes?: string;
  initiatedBy?: mongoose.Types.ObjectId;
  initiatedAt?: Date;
  providerName?: string;
  providerTransactionId?: string;
  providerUtr?: string;
  providerStatus?: string;
  failureReason?: string;
  reconciledAt?: Date;
  createdBy: mongoose.Types.ObjectId;
  auditTrail: IPaymentAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const PaymentAuditEntrySchema = new Schema<IPaymentAuditEntry>(
  {
    timestamp: { type: Date, default: Date.now },
    action: { type: String, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String },
    ip: { type: String },
  },
  { _id: false }
);

const PaymentRequestSchema = new Schema<IPaymentRequest>(
  {
    paymentReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project is required'],
      index: true,
    },
    expense: {
      type: Schema.Types.ObjectId,
      ref: 'Expense',
      index: true,
    },
    beneficiary: {
      type: Schema.Types.ObjectId,
      ref: 'Beneficiary',
      required: [true, 'Beneficiary is required'],
      index: true,
    },
    payeeNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    accountNumberMaskedSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    ifscSnapshot: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    bankNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    payeeType: {
      type: String,
      enum: ['CONTRACTOR', 'SUPPLIER', 'LABOUR'],
      required: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount in paise is required'],
      min: [100, 'Minimum payment amount is ₹1 (100 paise)'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer paise value',
      },
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['NEFT', 'RTGS'],
      default: 'NEFT',
      required: true,
    },
    invoiceNumber: {
      type: String,
      trim: true,
    },
    purpose: {
      type: String,
      required: [true, 'Payment purpose is required'],
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: [
        'DRAFT',
        'AWAITING_AUTHORIZATION',
        'SUBMITTED',
        'PROCESSING',
        'PAID',
        'FAILED',
        'UNKNOWN',
      ],
      default: 'DRAFT',
      index: true,
    },
    requiresHighValueAuth: {
      type: Boolean,
      default: false,
      index: true,
    },
    authorizedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    authorizedAt: {
      type: Date,
    },
    authorizationNotes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    initiatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    initiatedAt: {
      type: Date,
    },
    providerName: {
      type: String,
      trim: true,
    },
    providerTransactionId: {
      type: String,
      trim: true,
      index: true,
    },
    providerUtr: {
      type: String,
      trim: true,
      index: true,
    },
    providerStatus: {
      type: String,
      trim: true,
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    reconciledAt: {
      type: Date,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    auditTrail: [PaymentAuditEntrySchema],
  },
  {
    timestamps: true,
  }
);

// Compound index for querying payments per project by status
PaymentRequestSchema.index({ project: 1, status: 1 });

export const PaymentRequest = mongoose.model<IPaymentRequest>(
  'PaymentRequest',
  PaymentRequestSchema
);
