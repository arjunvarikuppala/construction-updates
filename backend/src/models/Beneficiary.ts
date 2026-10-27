import mongoose, { Schema, Document } from 'mongoose';

export type PayeeType = 'CONTRACTOR' | 'SUPPLIER' | 'LABOUR';
export type BeneficiaryVerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'FAILED';

export interface IBeneficiary extends Document {
  name: string;
  payeeType: PayeeType;
  accountNumber?: string;
  accountNumberMasked?: string;
  ifsc?: string;
  bankName?: string;
  branchName?: string;
  vpa?: string; // UPI ID (e.g. vendor@okhdfcbank)
  phone?: string;
  email?: string;
  verificationStatus: BeneficiaryVerificationStatus;
  verifiedName?: string;
  razorpayxContactId?: string;
  razorpayxFundAccountId?: string;
  pennyDropValidationId?: string;
  verificationDetails?: {
    accountExists?: boolean;
    providerRef?: string;
    verifiedAt?: Date;
    failureReason?: string;
  };
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export function maskAccountNumber(acc: string): string {
  if (!acc || acc.length < 4) return '••••';
  const last4 = acc.slice(-4);
  return `•••• •••• ${last4}`;
}

const BeneficiarySchema = new Schema<IBeneficiary>(
  {
    name: {
      type: String,
      required: [true, 'Beneficiary legal name is required'],
      trim: true,
      maxlength: 150,
      index: true,
    },
    payeeType: {
      type: String,
      enum: ['CONTRACTOR', 'SUPPLIER', 'LABOUR'],
      required: [true, 'Payee type is required'],
      index: true,
    },
    accountNumber: {
      type: String,
      trim: true,
      select: false, // Hidden by default from JSON outputs for banking security
    },
    accountNumberMasked: {
      type: String,
      trim: true,
    },
    ifsc: {
      type: String,
      trim: true,
      uppercase: true,
    },
    bankName: {
      type: String,
      trim: true,
    },
    branchName: {
      type: String,
      trim: true,
    },
    vpa: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    verificationStatus: {
      type: String,
      enum: ['UNVERIFIED', 'VERIFIED', 'FAILED'],
      default: 'UNVERIFIED',
      index: true,
    },
    verifiedName: {
      type: String,
      trim: true,
    },
    razorpayxContactId: {
      type: String,
      trim: true,
    },
    razorpayxFundAccountId: {
      type: String,
      trim: true,
    },
    pennyDropValidationId: {
      type: String,
      trim: true,
    },
    verificationDetails: {
      accountExists: Boolean,
      providerRef: String,
      verifiedAt: Date,
      failureReason: String,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

BeneficiarySchema.index({ name: 'text', bankName: 'text', ifsc: 'text', vpa: 'text' });

export const Beneficiary = mongoose.model<IBeneficiary>('Beneficiary', BeneficiarySchema);
