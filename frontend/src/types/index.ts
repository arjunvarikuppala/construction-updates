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
  remainingPaise?: number;
  burnPercentage?: number;
  pendingCount?: number;
  approvedCount?: number;
}

export interface Project {
  _id: string;
  id?: string;
  name: string;
  code: string;
  description?: string;
  location: string;
  startDate: string;
  endDate?: string;
  expectedCompletionDate?: string;
  budget: number; // Stored in paise
  status: ProjectStatus;
  activeAssignments?: ProjectAssignment[];
  assignedInCharge?: {
    _id: string;
    id?: string;
    name: string;
    email: string;
    phone?: string;
    salary?: number;
    salaryFrequency?: 'MONTHLY' | 'DAILY' | 'PER_PROJECT';
  };
  assignedInCharges?: Array<{
    _id: string;
    id?: string;
    name: string;
    email: string;
    phone?: string;
    salary?: number;
    salaryFrequency?: 'MONTHLY' | 'DAILY' | 'PER_PROJECT';
  }>;
  financials?: ProjectFinancials;
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

export interface ReadReceiptInfo {
  status: 'NOT_VIEWED' | 'SEEN_BY_MD' | 'REVISION_NOT_VIEWED';
  lastViewedAt?: string;
  lastViewedByName?: string;
  lastViewedById?: string;
  isCurrentRevisionSeen?: boolean;
  viewedBy?: Array<{
    viewerId: string;
    viewerName: string;
    firstViewedAt: string;
    lastViewedAt: string;
  }>;
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
  readReceipt?: ReadReceiptInfo;
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
  paymentStatus?: 'UNPAID' | 'PAYMENT_REQUESTED' | 'PAID';
  paymentRequestId?: string;
  paidAt?: string;
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

// ==========================================
// PAYMENTS & BENEFICIARIES
// ==========================================

export type PayeeType = 'CONTRACTOR' | 'SUPPLIER' | 'LABOUR';
export type BeneficiaryVerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'FAILED';

export interface Beneficiary {
  _id: string;
  id?: string;
  name: string;
  payeeType: PayeeType;
  accountNumberMasked?: string;
  ifsc?: string;
  bankName?: string;
  branchName?: string;
  vpa?: string; // UPI ID (e.g. contractor@okhdfcbank)
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
    verifiedAt?: string;
    failureReason?: string;
  };
  isActive: boolean;
  createdAt: string;
}

export type PaymentMethod = 'NEFT' | 'RTGS' | 'UPI';

export type PaymentRequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'AWAITING_AUTHORIZATION'
  | 'AUTHORIZED'
  | 'PROCESSING'
  | 'PAID'
  | 'REJECTED'
  | 'FAILED'
  | 'REVERSED'
  | 'UNKNOWN';

export interface PaymentAuditEntry {
  timestamp: string;
  action: string;
  performedBy: {
    _id?: string;
    name?: string;
    email?: string;
    role?: string;
  } | string;
  note?: string;
  ip?: string;
}

export interface PaymentRequest {
  _id: string;
  id?: string;
  paymentReference: string;
  referenceNumber?: string;
  idempotencyKey: string;
  project: {
    _id: string;
    name: string;
    code: string;
    location?: string;
    budget?: number;
  };
  projectSnapshot?: {
    code: string;
    name: string;
  };
  expense?: {
    _id: string;
    category: ExpenseCategory;
    description: string;
    amount: number;
    vendor: string;
    date: string;
  };
  beneficiary?: Beneficiary | string;
  payeeNameSnapshot: string;
  accountNumberMaskedSnapshot?: string;
  ifscSnapshot?: string;
  bankNameSnapshot?: string;
  vpaSnapshot?: string;
  beneficiarySnapshot?: {
    name: string;
    payeeType?: PayeeType;
    accountNumberMasked?: string;
    ifsc?: string;
    bankName?: string;
    vpa?: string;
  };
  payeeType: PayeeType;
  amount: number; // integer paise
  amountPaise?: number;
  paymentMethod: PaymentMethod;
  preferredMethod?: PaymentMethod;
  purpose: string;
  description?: string;
  invoiceUrl?: string;
  requestedPaymentDate?: string;
  requestedDate?: string;
  inchargeRemarks?: string;
  remarks?: string;
  mdReviewRemarks?: string;
  rejectionReason?: string;
  status: PaymentRequestStatus;
  requiresHighValueAuth: boolean;
  isHighValue?: boolean;
  authorizedBy?: {
    _id: string;
    name: string;
    email: string;
    role: string;
  };
  authorizedAt?: string;
  authorizationNotes?: string;
  initiatedBy?: {
    _id: string;
    name: string;
    email: string;
  };
  initiatedAt?: string;
  providerName?: string;
  providerTransactionId?: string;
  providerUtr?: string;
  razorpayxUtr?: string;
  providerStatus?: string;
  razorpayxPayoutId?: string;
  razorpayxContactId?: string;
  razorpayxFundAccountId?: string;
  razorpayxStatus?: string;
  fees?: number;
  tax?: number;
  reversalReason?: string;
  reversedAt?: string;
  failureReason?: string;
  reconciledAt?: string;
  createdBy: {
    _id: string;
    name: string;
    email: string;
    role?: string;
  };
  auditTrail: PaymentAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSummary {
  totalDisbursedPaise: number;
  awaitingAuthCount: number;
  awaitingAuthPaise: number;
  processingPaise: number;
  highValueThresholdPaise: number;
}

// ==========================================
// TWO-WAY COMMUNICATION
// ==========================================

export type MessageContextType = 'GENERAL' | 'DAILY_REPORT' | 'EXPENSE' | 'PAYMENT_REQUEST';

export interface MessageAttachment {
  url: string;
  name: string;
  type: string;
  size?: number;
}

export interface ProjectMessage {
  _id: string;
  id?: string;
  project: string;
  sender: {
    _id: string;
    id?: string;
    name: string;
    email: string;
    role: string;
  };
  content: string;
  attachments: MessageAttachment[];
  contextType: MessageContextType;
  contextId?: string;
  contextSummary?: string;
  readBy: Array<{
    user: string;
    readAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// NOTIFICATIONS
// ==========================================

export type NotificationType =
  | 'PAYMENT_REQUEST_NEW'
  | 'PAYMENT_REQUEST_REVIEW'
  | 'PAYMENT_REQUEST_AUTHORIZED'
  | 'PAYMENT_REQUEST_REJECTED'
  | 'PAYMENT_REQUEST_PAID'
  | 'PROJECT_MESSAGE'
  | 'DAILY_REPORT_SUBMITTED'
  | 'DAILY_REPORT_VIEWED'
  | 'SYSTEM';

export type NotificationRelatedEntity =
  | 'PAYMENT_REQUEST'
  | 'PROJECT_MESSAGE'
  | 'DAILY_REPORT'
  | 'EXPENSE'
  | 'PROJECT';

export interface Notification {
  _id: string;
  id?: string;
  recipient: string;
  sender?: {
    _id: string;
    name: string;
    email: string;
    role: string;
  };
  project?: {
    _id: string;
    name: string;
    code: string;
  };
  type: NotificationType;
  title: string;
  message: string;
  relatedEntity?: NotificationRelatedEntity;
  relatedId?: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}
