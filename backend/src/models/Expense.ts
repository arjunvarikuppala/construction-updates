import mongoose, { Schema, Document } from 'mongoose';
import { ExpenseCategory, ExpenseStatus } from '../types/index.js';
import type { GstDetails } from '../services/gstService.js';

export interface IExpense extends Document {
  project: mongoose.Types.ObjectId;
  submittedBy: mongoose.Types.ObjectId;
  date: Date;
  category: ExpenseCategory;
  description: string;
  amount: number; // Stored as integer PAISE (e.g., ₹5,000 = 500000 paise)
  vendor: string;
  receiptUrl?: string;
  /** Present only for GST bills; amount = taxable + GST (all in paise) */
  gst?: GstDetails;
  status: ExpenseStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  resubmissionCount: number;
  previousNotes?: string;
  paymentStatus?: 'UNPAID' | 'PAYMENT_REQUESTED' | 'PAID';
  paymentRequestId?: mongoose.Types.ObjectId;
  paidAt?: Date;
  /** Daily report this expense was recorded in (optional; standalone expenses have none) */
  dailyReport?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const GstSchema = new Schema(
  {
    vendorGstin: { type: String, required: true, uppercase: true, trim: true, maxlength: 15 },
    invoiceNumber: { type: String, required: true, trim: true, maxlength: 40 },
    invoiceDate: { type: Date, required: true },
    taxablePaise: { type: Number, required: true, min: 0 },
    ratePercent: { type: Number, required: true, enum: [0, 5, 12, 18, 28] },
    cgstPaise: { type: Number, default: 0, min: 0 },
    sgstPaise: { type: Number, default: 0, min: 0 },
    igstPaise: { type: Number, default: 0, min: 0 },
    interState: { type: Boolean, default: false },
  },
  { _id: false }
);

const ExpenseSchema = new Schema<IExpense>(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project is required'],
      index: true,
    },
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Submitted by is required'],
      index: true,
    },
    date: {
      type: Date,
      required: [true, 'Expense date is required'],
      index: true,
    },
    category: {
      type: String,
      enum: [
        'LABOUR',
        'CONSTRUCTION_MATERIALS',
        'DIESEL_AND_FUEL',
        'MACHINERY_AND_EQUIPMENT',
        'TRANSPORTATION',
        'FOOD_AND_ACCOMMODATION',
        'REPAIRS_AND_MAINTENANCE',
        'OTHER',
      ],
      required: [true, 'Expense category is required'],
      index: true,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: 1000,
    },
    amount: {
      type: Number,
      required: [true, 'Amount in paise is required'],
      min: [100, 'Minimum amount is ₹1 (100 paise)'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer value for paise',
      },
    },
    vendor: {
      type: String,
      required: [true, 'Vendor / Payee name is required'],
      trim: true,
      maxlength: 200,
    },
    gst: { type: GstSchema, default: undefined },
    receiptUrl: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    resubmissionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    previousNotes: {
      type: String,
      trim: true,
    },
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PAYMENT_REQUESTED', 'PAID'],
      default: 'UNPAID',
      index: true,
    },
    paymentRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'PaymentRequest',
    },
    paidAt: {
      type: Date,
    },
    dailyReport: {
      type: Schema.Types.ObjectId,
      ref: 'DailyReport',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

ExpenseSchema.index({ project: 1, status: 1 });
ExpenseSchema.index({ 'gst.invoiceDate': 1 });
ExpenseSchema.index({ project: 1, date: -1 });

export const Expense = mongoose.model<IExpense>('Expense', ExpenseSchema);
