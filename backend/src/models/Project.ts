import mongoose, { Schema, Document } from 'mongoose';
import { ProjectStatus } from '../types/index.js';

export interface IProject extends Document {
  name: string;
  code: string;
  location: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
  description?: string;
  budget: number; // Stored as integer PAISE (e.g. ₹50,00,000 = 500000000 paise)
  assignedInCharge?: mongoose.Types.ObjectId;
  startDate?: Date;
  expectedCompletionDate?: Date;
  status: ProjectStatus;
  owner?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: 120,
    },
    code: {
      type: String,
      required: [true, 'Project code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
      maxlength: 200,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },
    state: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },
    country: {
      type: String,
      trim: true,
      maxlength: 100,
      default: 'India',
    },
    latitude: {
      type: Number,
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90'],
      default: null,
    },
    longitude: {
      type: Number,
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180'],
      default: null,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    budget: {
      type: Number,
      default: 0,
      min: [0, 'Budget must be non-negative'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not an integer value for paise',
      },
    },
    assignedInCharge: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true,
    },
    startDate: {
      type: Date,
      required: false,
    },
    expectedCompletionDate: {
      type: Date,
      required: false,
    },
    status: {
      type: String,
      enum: ['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'],
      default: 'IN_PROGRESS',
      index: true,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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

export const Project = mongoose.model<IProject>('Project', ProjectSchema);
