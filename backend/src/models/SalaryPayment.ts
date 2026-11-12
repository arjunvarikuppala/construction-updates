import mongoose, { Schema, Document } from 'mongoose';
import { SETTLEMENT_MODES, SettlementMode } from './PaymentRequest.js';

/**
 * One salary payment the MD made to a Site In-Charge, against a salary month.
 * A month can be paid in parts (advance + balance); wrong entries are voided,
 * never deleted, so the history stays complete. Kept apart from site payment
 * requests and expenses: salaries are not a project cost line.
 */
export interface ISalaryPayment extends Document {
  /** The MD who owns the company (tenant scope) */
  company: mongoose.Types.ObjectId;
  employee: mongoose.Types.ObjectId;
  /** Salary month, YYYY-MM */
  month: string;
  /** Monthly salary at the time of payment (paise); 0 when not on a monthly salary */
  monthlySalaryPaise: number;
  /** Client-generated key so a double tap never records the same payment twice */
  settlementKey: string;
  amountPaise: number;
  mode: SettlementMode;
  reference?: string;
  referenceKey?: string;
  paidOn: Date;
  proofUrl?: string;
  note?: string;
  recordedBy: mongoose.Types.ObjectId;
  receivedConfirmedAt?: Date;
  voided?: boolean;
  voidedBy?: mongoose.Types.ObjectId;
  voidedAt?: Date;
  voidReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SalaryPaymentSchema = new Schema<ISalaryPayment>(
  {
    company: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    monthlySalaryPaise: { type: Number, default: 0, min: 0 },
    settlementKey: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    amountPaise: {
      type: Number,
      required: true,
      min: 100,
      validate: { validator: Number.isInteger, message: '{VALUE} is not an integer paise value' },
    },
    mode: { type: String, enum: SETTLEMENT_MODES, required: true },
    reference: { type: String, trim: true, maxlength: 40 },
    referenceKey: { type: String, trim: true, maxlength: 40 },
    paidOn: { type: Date, required: true },
    proofUrl: { type: String, trim: true, maxlength: 2048 },
    note: { type: String, trim: true, maxlength: 300 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receivedConfirmedAt: { type: Date },
    voided: { type: Boolean, default: false },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidedAt: { type: Date },
    voidReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

SalaryPaymentSchema.index({ company: 1, month: 1 });
SalaryPaymentSchema.index({ employee: 1, month: -1 });
SalaryPaymentSchema.index({ company: 1, referenceKey: 1 });

export const SalaryPayment = mongoose.model<ISalaryPayment>('SalaryPayment', SalaryPaymentSchema);
