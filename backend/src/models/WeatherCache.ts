import mongoose, { Schema, Document } from 'mongoose';

export interface IWeatherAlert {
  type: 'HEAVY_RAIN' | 'THUNDERSTORM' | 'EXCESSIVE_HEAT' | 'STRONG_WINDS';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  headline: string;
  description: string;
  actionableAdvice: string;
}

export interface IWeatherData {
  temperature: number; // °C
  feelsLike: number; // °C
  condition: string;
  conditionCode: number;
  icon: string;
  humidity: number; // %
  windSpeed: number; // km/h
  windDirection?: number;
  precipitationProbability?: number; // %
  precipitation?: number; // mm
  observationTime: Date;
  alerts: IWeatherAlert[];
}

export interface IWeatherCache extends Document {
  projectId: mongoose.Types.ObjectId;
  locationName: string;
  latitude: number;
  longitude: number;
  weather: IWeatherData;
  provider: string;
  fetchedAt: Date;
  expiresAt: Date;
  isStale: boolean;
  lastError?: string;
}

const WeatherCacheSchema = new Schema<IWeatherCache>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      unique: true,
      index: true,
    },
    locationName: {
      type: String,
      required: true,
      trim: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    weather: {
      temperature: { type: Number, required: true },
      feelsLike: { type: Number, required: true },
      condition: { type: String, required: true },
      conditionCode: { type: Number, required: true },
      icon: { type: String, required: true },
      humidity: { type: Number, required: true },
      windSpeed: { type: Number, required: true },
      windDirection: { type: Number },
      precipitationProbability: { type: Number, default: 0 },
      precipitation: { type: Number, default: 0 },
      observationTime: { type: Date, required: true },
      alerts: [
        {
          type: {
            type: String,
            enum: ['HEAVY_RAIN', 'THUNDERSTORM', 'EXCESSIVE_HEAT', 'STRONG_WINDS'],
            required: true,
          },
          severity: {
            type: String,
            enum: ['INFO', 'WARNING', 'CRITICAL'],
            required: true,
          },
          headline: { type: String, required: true },
          description: { type: String, required: true },
          actionableAdvice: { type: String, required: true },
        },
      ],
    },
    provider: {
      type: String,
      default: 'Open-Meteo',
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    isStale: {
      type: Boolean,
      default: false,
    },
    lastError: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

export const WeatherCache = mongoose.model<IWeatherCache>('WeatherCache', WeatherCacheSchema);
