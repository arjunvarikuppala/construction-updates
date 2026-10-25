import mongoose, { Schema, Document } from 'mongoose';
import { ExpenseCategory, ExpenseStatus } from '../types/index.js';

export interface IExpense extends Document {
  project: mongoose.Types.ObjectId;
  submittedBy: mongoose.Types.ObjectId;
  date: Date;
  category: ExpenseCategory;
  description: string;
  amount: number; // Stored as integer PAISE (e.g., ₹5,000 = 500000 paise)
  vendor: string;
  receiptUrl?: string;
  status: ExpenseStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  resubmissionCount: number;
  previousNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

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
  },
  {
    timestamps: true,
  }
);

ExpenseSchema.index({ project: 1, status: 1 });
ExpenseSchema.index({ project: 1, date: -1 });

export const Expense = mongoose.model<IExpense>('Expense', ExpenseSchema);
