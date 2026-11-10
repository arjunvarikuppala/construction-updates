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
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
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
  observationTime: string;
  alerts: WeatherAlert[];
}

export interface ProjectWeatherResponse {
  success: boolean;
  project: {
    id: string;
    name: string;
    code: string;
    location: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    coordinates: {
      latitude: number | null;
      longitude: number | null;
    };
  };
  isConfigured: boolean;
  weather?: WeatherData;
  cached?: boolean;
  isStale?: boolean;
  fetchedAt?: string;
  statusMessage?: string;
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
  fetchedAt?: string;
  statusMessage?: string;
}

export type WorkItemStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface WorkItem {
  description: string;
  quantity: number;
  unit: string;
  rate?: number; // ₹ per unit
  budget?: number;
  location?: string;
  status?: WorkItemStatus;
  progressPercent?: number;
  remarks?: string;
}

export type LabourCategory = 'SKILLED' | 'UNSKILLED' | 'SUPERVISOR' | 'OTHER';

export interface LabourCountItem {
  role: string;
  count: number;
  category?: LabourCategory;
  hours?: number;
  wagePerDay?: number; // ₹ per worker per day
}

export interface MaterialItem {
  name: string;
  quantity: number;
  unit: string;
  rate?: number; // ₹ per unit
  remarks?: string;
}

export interface MachineryItem {
  name: string;
  quantity: number;
  hoursUsed?: number;
  rate?: number; // ₹ per machine, per day or per hour
  rateBasis?: 'DAY' | 'HOUR';
  remarks?: string;
}

export type ReportShift = 'DAY' | 'NIGHT' | 'GENERAL' | 'DOUBLE';

/** An expense row inside the daily report form (amount entered in rupees). */
/** GST bill details as entered in a form (rupees as strings). */
export interface GstBillDraft {
  isGstBill: boolean;
  vendorGstin: string;
  invoiceNumber: string;
  invoiceDate: string; // yyyy-mm-dd
  taxable: string; // ₹, before GST
  ratePercent: number;
}

/** GST details stored on an expense (paise). */
export interface ExpenseGst {
  vendorGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxablePaise: number;
  ratePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  interState: boolean;
}

export interface ReportExpenseDraft {
  _id?: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
  vendor: string;
  receiptUrl?: string;
  status?: ExpenseStatus;
  gst?: GstBillDraft;
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
  reportVersion?: number;
  viewedVersion?: number;
  viewedBy?: Array<{
    viewerId: string;
    viewerName: string;
    firstViewedAt: string;
    lastViewedAt: string;
    reportVersion?: number;
  }>;
}

export interface ReportComment {
  _id?: string;
  author: string | { _id: string; name: string; role: string };
  authorName: string;
  authorRole: string;
  message: string;
  type: 'COMMENT' | 'CHANGES_REQUESTED' | 'CORRECTION_REQUIRED';
  createdAt: string;
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
  totalLabourCost?: number;
  totalMaterialCost?: number;
  totalMachineryCost?: number;
  totalWorkBudget?: number;
  equipmentDetails?: string;
  issuesAndDelays?: string;
  nextDayPlan?: string;
  photos: SitePhoto[];
  status: ReportStatus;
  version?: number;
  comments?: ReportComment[];
  readReceipt?: ReadReceiptInfo;
  shift?: ReportShift;
  workLocation?: string;
  remarks?: string;
  overallProgressPercent?: number;
  materials?: MaterialItem[];
  machinery?: MachineryItem[];
  submittedAt?: string;
  /** Present on the detail endpoint: expenses recorded within this report */
  expenses?: Expense[];
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
  gst?: ExpenseGst | null;
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
  dailyReport?: string;
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
  completedProjectsCount?: number;
  onHoldProjectsCount?: number;
  todayReportsSubmitted?: number;
  activeProjectsMissingTodayReport?: number;
  todayExpenditurePaise?: number;
  todayLabourCount?: number;
  averageReportedProgress?: number | null;
  delayedReportsLast7Days?: number;
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
  latestProgressPercent?: number | null;
  reportedToday?: boolean;
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
  delayedWork?: Array<Pick<DailyReport, '_id' | 'titleOfWork' | 'workDate' | 'issuesAndDelays' | 'project' | 'submittedBy'>>;
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

export type PayeeType = 'CONTRACTOR' | 'SUPPLIER' | 'LABOUR' | 'SITE_INCHARGE';
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
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED'
  | 'UNKNOWN';

/** How the MD paid: own UPI app, bank transfer, cheque, cash — or a RazorpayX payout */
export type SettlementMode = 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'CASH' | 'RAZORPAYX';
/** Who receives the money */
export type PayeeKind = 'INCHARGE' | 'VENDOR';
/** RazorpayX payout rails */
export type PayoutMode = 'UPI' | 'IMPS' | 'NEFT' | 'RTGS';

export interface PayoutOptions {
  enabled: boolean;
  mode: 'off' | 'test' | 'live';
  reason?: string;
  modes: PayoutMode[];
  limits: Record<PayoutMode, { min: number; max: number }>;
  balancePaise: number;
}

export interface PaymentSettlement {
  _id: string;
  settlementKey: string;
  amountPaise: number;
  mode: SettlementMode;
  reference?: string;
  paidOn: string;
  proofUrl?: string;
  note?: string;
  recordedBy?: { _id: string; name: string } | string;
  recordedAt: string;
  receivedConfirmedBy?: { _id: string; name: string } | string;
  receivedConfirmedAt?: string;
  voided?: boolean;
  voidedBy?: { _id: string; name: string } | string;
  voidedAt?: string;
  voidReason?: string;
}

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
  payeeKind?: PayeeKind;
  payeeUser?: { _id: string; name: string; email?: string; phone?: string } | string;
  amount: number; // integer paise
  paidPaise?: number;
  settlements?: PaymentSettlement[];
  /** RazorpayX payout sent but not final yet */
  pendingPayout?: {
    payoutId?: string;
    amountPaise: number;
    mode: PayoutMode;
    providerStatus?: string;
    initiatedAt: string;
  } | null;
  lastPaidAt?: string;
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
  payoutsEnabled?: boolean;
  payoutsMode?: 'off' | 'test' | 'live';
}

export interface PaymentDashboardSummary {
  awaitingCount: number;
  awaitingPaise: number;
  partialCount: number;
  partialBalancePaise: number;
  dueThisWeekCount: number;
  paidThisMonthPaise: number;
  paidToInChargesPaise: number;
  paidToVendorsPaise: number;
  unconfirmedReceipts: number;
  bySite: { project: { _id: string; name: string; code: string } | null; paidPaise: number; duePaise: number }[];
}

// ==========================================
// TWO-WAY COMMUNICATION
// ==========================================

export type MessageContextType = 'GENERAL' | 'DAILY_REPORT' | 'EXPENSE' | 'PAYMENT_REQUEST';

export interface MessageAttachment {
  url: string;
  name: string;
  type: 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'other' | string;
  mimeType?: string;
  size?: number;
  storageKey?: string;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
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
  messageType?: 'TEXT' | 'ATTACHMENT' | 'MIXED';
  replyTo?: Partial<ProjectMessage> | string | null;
  clientMessageId?: string;
  contextType: MessageContextType;
  contextId?: string;
  contextSummary?: string;
  readBy: Array<{
    user:
      | string
      | {
          _id?: string;
          id?: string;
          name?: string;
          email?: string;
          role?: string;
        };
    readAt: string;
  }>;
  reactions?: Array<{
    emoji: string;
    user: string | { _id?: string; id?: string; name?: string; role?: string };
    createdAt?: string;
  }>;
  editedAt?: string | null;
  deletedAt?: string | null;
  pinnedAt?: string | null;
  pinnedBy?: string | { _id?: string; name?: string; role?: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectParticipantPresence {
  userId: string;
  name: string;
  role: string;
  phone?: string;
  isOnline: boolean;
  isInChannel: boolean;
  isMD?: boolean;
  isInCharge?: boolean;
  lastSeen?: string;
}

export interface ProjectPresenceData {
  projectId: string;
  project?: {
    id: string;
    name: string;
    code: string;
  };
  participants: ProjectParticipantPresence[];
  linkedMD?: ProjectParticipantPresence | null;
  linkedInCharges?: ProjectParticipantPresence[];
  hasAssignedInCharge?: boolean;
  onlineCount: number;
  inChannelCount?: number;
  isChannelActive?: boolean;
  isOtherPartyOnline?: boolean;
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
  | 'DAILY_REPORT_COMMENT'
  | 'DAILY_REPORT_CHANGES_REQUESTED'
  | 'DAILY_REPORT_REJECTED'
  | 'EXPENSE_SUBMITTED'
  | 'EXPENSE_APPROVED'
  | 'EXPENSE_REJECTED'
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
