export type UserRole = 'MD' | 'SITE_INCHARGE' | 'OWNER' | 'IN_CHARGE';

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

export interface User {
  id: string;
  _id?: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  salary?: number;
  salaryFrequency?: 'MONTHLY' | 'DAILY' | 'PER_PROJECT';
  assignedProjects?: any[];
}

export interface ProjectAssignment {
  _id: string;
  project: string;
  siteInCharge: {
    _id: string;
    id?: string;
    name: string;
    email: string;
    phone?: string;
    role: string;
    salary?: number;
    salaryFrequency?: 'MONTHLY' | 'DAILY' | 'PER_PROJECT';
    isActive?: boolean;
  };
  assignmentStatus: 'ACTIVE' | 'REVOKED';
  assignedBy?: {
    _id: string;
    name: string;
    email: string;
    role?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFinancials {
  budget: number; // in paise
  approvedPaise: number;
  pendingPaise: number;
  rejectedPaise: number;
  pendingCount?: number;
  remainingPaise: number;
  burnPercentage: number;
}

export interface Project {
  _id: string;
  id?: string;
  name: string;
  code: string;
  location: string;
  description?: string;
  budget: number; // in paise
  assignedInCharge?: {
    _id: string;
    id?: string;
    name: string;
    email: string;
    phone?: string;
    role?: string;
  } | null;
  activeAssignments?: ProjectAssignment[];
  startDate?: string;
  expectedCompletionDate?: string;
  status: ProjectStatus;
  financials?: ProjectFinancials;
  latestReportDate?: string | null;
  reportCount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkItem {
  description: string;
  quantity: number;
  unit: string;
}

export interface LabourCountItem {
  role: string;
  count: number;
}

export interface SitePhoto {
  url: string;
  caption?: string;
  uploadedAt?: string;
}

export interface DailyReport {
  _id: string;
  id?: string;
  project: {
    _id: string;
    name: string;
    code: string;
    location?: string;
    budget?: number;
  };
  submittedBy: {
    _id: string;
    name: string;
    email: string;
    role?: string;
  };
  lastEditedBy?: {
    _id: string;
    name: string;
    email?: string;
    role?: string;
  };
  titleOfWork: string;
  workDate: string;
  workSummary: string;
  workItems: WorkItem[];
  labourBreakdown: LabourCountItem[];
  totalLabourCount: number;
  equipmentDetails?: string;
  issuesAndDelays?: string;
  nextDayPlan?: string;
  photos: SitePhoto[];
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  _id: string;
  id?: string;
  project: {
    _id: string;
    name: string;
    code: string;
    location?: string;
    budget?: number;
    assignedInCharge?: string;
  };
  submittedBy: {
    _id: string;
    name: string;
    email: string;
    role?: string;
  };
  lastEditedBy?: {
    _id: string;
    name: string;
    email?: string;
    role?: string;
  };
  date: string;
  category: ExpenseCategory;
  description: string;
  amount: number; // in paise
  vendor: string;
  receiptUrl?: string;
  status: ExpenseStatus;
  reviewedBy?: {
    _id: string;
    name: string;
    email: string;
    role?: string;
  };
  reviewedAt?: string;
  rejectionReason?: string;
  resubmissionCount: number;
  previousNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerDashboardKPIs {
  activeProjectsCount: number;
  totalProjectsCount: number;
  unassignedProjectsCount?: number;
  totalBudgetPaise: number;
  approvedPaise: number;
  approvedCount: number;
  pendingPaise: number;
  pendingCount: number;
  rejectedPaise: number;
  rejectedCount: number;
  remainingBudgetPaise: number;
  budgetBurnPercentage: number;
  submittedReportsLast7Days: number;
  expectedReportsLast7Days: number;
  missingReportsCount: number;
}

export interface CategoryBreakdownItem {
  category: ExpenseCategory;
  amount: number; // paise
  count: number;
}

export interface ProjectExpenditureItem {
  id: string;
  name: string;
  code: string;
  location: string;
  status: ProjectStatus;
  inCharge: string;
  budget: number;
  approved: number;
  pending: number;
  rejected: number;
  remaining: number;
  burnRate: number;
  requiresAttention: boolean;
}

export interface ExpenditureTrendItem {
  label: string;
  approved: number;
  pending: number;
}

export interface OwnerDashboardData {
  kpis: OwnerDashboardKPIs;
  categoryBreakdown: CategoryBreakdownItem[];
  projectExpenditures: ProjectExpenditureItem[];
  expenditureTrend: ExpenditureTrendItem[];
  recentlyUpdatedProjects?: Array<{
    id: string;
    name: string;
    code: string;
    location: string;
    status: ProjectStatus;
    updatedAt: string;
    inCharge: string;
    budget?: number;
  }>;
  recentReports?: DailyReport[];
  recentExpenses?: Expense[];
  recentActivity: any[];
}

export interface InChargeDashboardData {
  assignedProjects: Array<{
    id: string;
    name: string;
    code: string;
    location: string;
    budget?: number;
    approved: number;
    pending: number;
    rejected: number;
    remaining?: number;
  }>;
  todayReportStatus: 'SUBMITTED' | 'DRAFT' | 'NOT_SUBMITTED' | 'NO_PROJECT_ASSIGNED';
  todayReportId?: string | null;
  unassigned?: boolean;
  message?: string;
  recentReports: DailyReport[];
  pendingExpenses: Expense[];
  rejectedExpenses: Expense[];
  approvedExpenses: Expense[];
}
