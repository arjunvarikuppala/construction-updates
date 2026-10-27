import mongoose, { Schema, Document } from 'mongoose';
import { PayeeType } from './Beneficiary.js';

export type PaymentMethod = 'NEFT' | 'RTGS' | 'UPI';

export type PaymentRequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'AWAITING_AUTHORIZATION'
  | 'AUTHORIZED'
  | 'PROCESSING'
  | 'PAID'
  | 'REJECTED'
  | 'FAILED'
  | 'REVERSED'
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
  beneficiary?: mongoose.Types.ObjectId;

  // Beneficiary snapshots sealed at payment creation to prevent tampering
  payeeNameSnapshot: string;
  accountNumberMaskedSnapshot?: string;
  ifscSnapshot?: string;
  bankNameSnapshot?: string;
  vpaSnapshot?: string; // UPI ID (e.g. contractor@okhdfcbank)
  payeeType: PayeeType;

  // Stored strictly in integer paise (₹1 = 100 paise)
  amount: number;
  paymentMethod: PaymentMethod;
  purpose: string;
  description?: string;
  invoiceUrl?: string;
  requestedPaymentDate?: Date;
  inchargeRemarks?: string;
  mdReviewRemarks?: string;
  rejectionReason?: string;

  status: PaymentRequestStatus;
  requiresHighValueAuth: boolean;
  authorizedBy?: mongoose.Types.ObjectId;
  authorizedAt?: Date;
  authorizationNotes?: string;
  initiatedBy?: mongoose.Types.ObjectId;
  initiatedAt?: Date;

  // Provider tracking (RazorpayX Payouts Engine)
  providerName: string; // 'RAZORPAYX'
  providerTransactionId?: string; // Payout ID (pout_...)
  providerUtr?: string;
  providerStatus?: string;
  failureReason?: string;
  reconciledAt?: Date;

  // RazorpayX specific metadata
  razorpayxPayoutId?: string;
  razorpayxContactId?: string;
  razorpayxFundAccountId?: string;
  razorpayxStatus?: string;
  fees?: number; // In paise
  tax?: number; // In paise
  reversalReason?: string;
  reversedAt?: Date;

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
      required: [true, 'Project link is required'],
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
      index: true,
    },

    payeeNameSnapshot: {
      type: String,
      required: [true, 'Payee snapshot is required'],
      trim: true,
    },
    accountNumberMaskedSnapshot: {
      type: String,
      trim: true,
    },
    ifscSnapshot: {
      type: String,
      trim: true,
      uppercase: true,
    },
    bankNameSnapshot: {
      type: String,
      trim: true,
    },
    vpaSnapshot: {
      type: String,
      trim: true,
      lowercase: true,
    },
    payeeType: {
      type: String,
      enum: ['CONTRACTOR', 'SUPPLIER', 'LABOUR'],
      required: true,
    },

    amount: {
      type: Number,
      required: [true, 'Amount in paise is required'],
      min: [100, 'Minimum disbursement is ₹1 (100 paise)'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer paise value',
      },
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['NEFT', 'RTGS', 'UPI'],
      default: 'NEFT',
      required: true,
    },
    purpose: {
      type: String,
      required: [true, 'Payment purpose is required'],
      trim: true,
      maxlength: 300,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    invoiceUrl: {
      type: String,
      trim: true,
    },
    requestedPaymentDate: {
      type: Date,
    },
    inchargeRemarks: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    mdReviewRemarks: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    status: {
      type: String,
      enum: [
        'DRAFT',
        'SUBMITTED',
        'UNDER_REVIEW',
        'AWAITING_AUTHORIZATION',
        'AUTHORIZED',
        'PROCESSING',
        'PAID',
        'REJECTED',
        'FAILED',
        'REVERSED',
        'UNKNOWN',
      ],
      default: 'SUBMITTED',
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
      default: 'RAZORPAYX',
      index: true,
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
    },
    reconciledAt: {
      type: Date,
    },

    razorpayxPayoutId: {
      type: String,
      trim: true,
      index: true,
    },
    razorpayxContactId: {
      type: String,
      trim: true,
    },
    razorpayxFundAccountId: {
      type: String,
      trim: true,
    },
    razorpayxStatus: {
      type: String,
      trim: true,
    },
    fees: {
      type: Number,
      default: 0,
    },
    tax: {
      type: Number,
      default: 0,
    },
    reversalReason: {
      type: String,
      trim: true,
    },
    reversedAt: {
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

PaymentRequestSchema.index({ project: 1, status: 1 });
PaymentRequestSchema.index({ project: 1, createdAt: -1 });

export const PaymentRequest = mongoose.model<IPaymentRequest>('PaymentRequest', PaymentRequestSchema);
