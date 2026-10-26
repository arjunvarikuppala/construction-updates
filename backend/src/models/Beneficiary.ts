import mongoose, { Schema, Document } from 'mongoose';

export type PayeeType = 'CONTRACTOR' | 'SUPPLIER' | 'LABOUR';
export type BeneficiaryVerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'FAILED';

export interface IBeneficiary extends Document {
  name: string;
  payeeType: PayeeType;
  accountNumber: string;
  accountNumberMasked: string;
  ifsc: string;
  bankName: string;
  branchName?: string;
  phone?: string;
  email?: string;
  verificationStatus: BeneficiaryVerificationStatus;
  verifiedName?: string;
  verificationDetails?: {
    accountExists?: boolean;
    providerRef?: string;
    verifiedAt?: Date;
    failureReason?: string;
  };
  providerBeneficiaryId?: string;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BeneficiarySchema = new Schema<IBeneficiary>(
  {
    name: {
      type: String,
      required: [true, 'Beneficiary name is required'],
      trim: true,
      maxlength: 200,
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
      required: [true, 'Bank account number is required'],
      trim: true,
      minlength: 8,
      maxlength: 22,
    },
    accountNumberMasked: {
      type: String,
      required: true,
      trim: true,
    },
    ifsc: {
      type: String,
      required: [true, 'IFSC code is required'],
      uppercase: true,
      trim: true,
      match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid Indian Financial System Code (IFSC) format'],
      index: true,
    },
    bankName: {
      type: String,
      required: [true, 'Bank name is required'],
      trim: true,
    },
    branchName: {
      type: String,
      trim: true,
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
    verificationDetails: {
      accountExists: Boolean,
      providerRef: String,
      verifiedAt: Date,
      failureReason: String,
    },
    providerBeneficiaryId: {
      type: String,
      trim: true,
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
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Helper to mask account number keeping only last 4 digits visible
export function maskAccountNumber(acc: string): string {
  const clean = acc.replace(/\s+/g, '');
  if (clean.length <= 4) return clean;
  const last4 = clean.slice(-4);
  const stars = '•'.repeat(Math.min(clean.length - 4, 8));
  return `${stars} ${last4}`;
}

export const Beneficiary = mongoose.model<IBeneficiary>('Beneficiary', BeneficiarySchema);
