import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserRole } from '../types/index.js';

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  phone?: string;
  salary?: number; // Integer paise (₹50,000 = 5000000 paise)
  salaryFrequency?: 'MONTHLY' | 'DAILY' | 'PER_PROJECT';
  assignedProjects: mongoose.Types.ObjectId[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false, // Don't return password in normal queries
    },
    role: {
      type: String,
      enum: ['MD', 'SITE_INCHARGE', 'OWNER', 'IN_CHARGE'],
      required: true,
      default: 'SITE_INCHARGE',
      index: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    salary: {
      type: Number,
      default: 0,
      min: [0, 'Salary must be non-negative'],
    },
    salaryFrequency: {
      type: String,
      enum: ['MONTHLY', 'DAILY', 'PER_PROJECT'],
      default: 'MONTHLY',
    },
    assignedProjects: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Project',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err: any) {
    next(err);
  }
});

UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
