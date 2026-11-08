import mongoose, { Schema, Document } from 'mongoose';

/** Small server-side key/value store (e.g. the generated Web Push VAPID key pair). */
export interface IAppConfig extends Document {
  key: string;
  value: any;
}

const AppConfigSchema = new Schema<IAppConfig>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export const AppConfig = mongoose.model<IAppConfig>('AppConfig', AppConfigSchema);
