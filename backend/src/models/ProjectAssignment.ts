import mongoose, { Schema, Document } from 'mongoose';

export type AssignmentStatus = 'ACTIVE' | 'REVOKED';

export interface IProjectAssignment extends Document {
  project: mongoose.Types.ObjectId;
  siteInCharge: mongoose.Types.ObjectId;
  assignmentStatus: AssignmentStatus;
  assignedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectAssignmentSchema = new Schema<IProjectAssignment>(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project reference is required'],
      index: true,
    },
    siteInCharge: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Site In-Charge user reference is required'],
      index: true,
    },
    assignmentStatus: {
      type: String,
      enum: ['ACTIVE', 'REVOKED'],
      default: 'ACTIVE',
      index: true,
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Assigned by user reference is required'],
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for fast lookup and assignment tracking
ProjectAssignmentSchema.index({ project: 1, siteInCharge: 1 });
ProjectAssignmentSchema.index({ siteInCharge: 1, assignmentStatus: 1 });

export const ProjectAssignment = mongoose.model<IProjectAssignment>(
  'ProjectAssignment',
  ProjectAssignmentSchema
);
