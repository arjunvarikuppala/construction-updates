import { Request } from 'express';
import { Types } from 'mongoose';

export type UserRole = 'MD' | 'SITE_INCHARGE' | 'OWNER' | 'IN_CHARGE';

export function isMD(role?: string): boolean {
  return role === 'MD' || role === 'OWNER';
}

export function isSiteInCharge(role?: string): boolean {
  return role === 'SITE_INCHARGE' || role === 'IN_CHARGE';
}

export function normalizeRole(role: string): 'MD' | 'SITE_INCHARGE' {
  return isMD(role) ? 'MD' : 'SITE_INCHARGE';
}

export type AssignmentStatus = 'ACTIVE' | 'REVOKED';

export type ExpenseCategory =
  | 'LABOUR'
  | 'CONSTRUCTION_MATERIALS'
  | 'DIESEL_AND_FUEL'
  | 'MACHINERY_AND_EQUIPMENT'
  | 'TRANSPORTATION'
  | 'FOOD_AND_ACCOMMODATION'
  | 'REPAIRS_AND_MAINTENANCE'
  | 'OTHER';

export type ExpenseStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type ProjectStatus = 'PLANNING' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED';

export type ReportStatus = 'DRAFT' | 'SUBMITTED';

export interface AuthUserPayload {
  userId: string;
  role: UserRole;
  email: string;
  name: string;
  assignedProjects?: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUserPayload;
}

export type WorkItemStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface WorkItem {
  description: string;
  quantity: number;
  unit: string;
  budget?: number;
  /** Floor / block / section where this item was executed */
  location?: string;
  status?: WorkItemStatus;
  /** 0-100 completion of this item */
  progressPercent?: number;
  remarks?: string;
  /** Machine(s) that did this job */
  machineUsed?: string;
}

export type LabourCategory = 'SKILLED' | 'UNSKILLED' | 'SUPERVISOR' | 'OTHER';

export interface LabourCountItem {
  role: string;
  count: number;
  category?: LabourCategory;
  /** Hours worked per person for this trade (older reports) */
  hours?: number;
  /** Daily wage per worker in rupees */
  wagePerDay?: number;
  contractor?: string;
  inTime?: string;
  outTime?: string;
  otHours?: number;
  otRate?: number;
  workDone?: string;
}

export interface MaterialItem {
  name: string;
  quantity: number;
  unit: string;
  /** ₹ per unit */
  rate?: number;
  remarks?: string;
  spec?: string;
  received?: number;
  supplier?: string;
  billNo?: string;
  usedFor?: string;
}

export interface MachineryItem {
  name: string;
  quantity: number;
  hoursUsed?: number;
  /** ₹ per machine, per day / per hour / per trip (see rateBasis) */
  rate?: number;
  rateBasis?: 'DAY' | 'HOUR' | 'TRIP';
  remarks?: string;
  model?: string;
  regNo?: string;
  ownership?: 'OWN' | 'HIRED';
  supplier?: string;
  operator?: string;
  startTime?: string;
  endTime?: string;
  meterStart?: number;
  meterEnd?: number;
  idleHours?: number;
  workDone?: string;
  workQty?: number;
  workUnit?: string;
  trips?: number;
  dieselLitres?: number;
  dieselRate?: number;
  bata?: number;
}

export type ReportShift = 'DAY' | 'NIGHT' | 'GENERAL' | 'DOUBLE';

export interface SitePhoto {
  url: string;
  caption?: string;
  uploadedAt: Date;
}

export interface WeatherAlert {
  type: 'HEAVY_RAIN' | 'THUNDERSTORM' | 'EXCESSIVE_HEAT' | 'STRONG_WINDS';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  headline: string;
  description: string;
  actionableAdvice: string;
}

export interface WeatherData {
  temperature: number;
  feelsLike: number;
  condition: string;
  conditionCode: number;
  icon: string;
  humidity: number;
  windSpeed: number;
  windDirection?: number;
  precipitationProbability?: number;
  precipitation?: number;
  observationTime: Date;
  alerts: WeatherAlert[];
}

export interface ProjectWeatherSummary {
  projectId: string;
  projectName: string;
  projectCode: string;
  location: string;
  coordinates: {
    latitude: number | null;
    longitude: number | null;
  };
  isConfigured: boolean;
  weather?: WeatherData;
  isStale?: boolean;
  cached?: boolean;
  fetchedAt?: Date;
  statusMessage?: string;
}
