import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { DailyReport } from '../models/DailyReport.js';
import { Expense } from '../models/Expense.js';
import { AuditLog } from '../models/AuditLog.js';
import { rupeesToPaise } from '../utils/currency.js';

export async function seedInitialData(): Promise<void> {
  const existingUsers = await User.countDocuments();
  if (existingUsers > 0) {
    console.log('Database already populated. Skipping automatic seeding.');
    return;
  }

  console.log('Seeding initial SiteTrack demo database...');

  // 1. Create Users
  const owner = await User.create({
    name: 'Vikram Singhania',
    email: 'owner@sitetrack.com',
    password: 'SiteTrack@123',
    role: 'OWNER',
    phone: '+91 98765 43210',
    isActive: true,
  });

  const inCharge1 = await User.create({
    name: 'Rajesh Kumar',
    email: 'rajesh.incharge@sitetrack.com',
    password: 'SiteTrack@123',
    role: 'IN_CHARGE',
    phone: '+91 98111 22334',
    isActive: true,
  });

  const inCharge2 = await User.create({
    name: 'Amit Sharma',
    email: 'amit.incharge@sitetrack.com',
    password: 'SiteTrack@123',
    role: 'IN_CHARGE',
    phone: '+91 98222 33445',
    isActive: true,
  });

  // 2. Create Projects
  const project1 = await Project.create({
    name: 'Metro Heights Commercial Complex',
    code: 'PRJ-MHC-01',
    location: 'Sector 62, Noida, NCR',
    description: '14-storey commercial office towers with double basement and retail podium.',
    budget: rupeesToPaise(15000000), // ₹1.5 Crore = 15,000,000 * 100 paise
    assignedInCharge: inCharge1._id,
    startDate: new Date('2026-01-10'),
    expectedCompletionDate: new Date('2027-06-30'),
    status: 'IN_PROGRESS',
    createdBy: owner._id,
  });

  const project2 = await Project.create({
    name: 'Greenfield Luxury Villas Phase 2',
    code: 'PRJ-GLV-02',
    location: 'Whitefield, Bengaluru',
    description: '24 gated luxury duplex villas with clubhouse and landscaping.',
    budget: rupeesToPaise(8500000), // ₹85 Lakhs = 8,500,000 * 100 paise
    assignedInCharge: inCharge2._id,
    startDate: new Date('2026-02-01'),
    expectedCompletionDate: new Date('2026-12-15'),
    status: 'IN_PROGRESS',
    createdBy: owner._id,
  });

  const project3 = await Project.create({
    name: 'Highland Elevated Flyover & Junction',
    code: 'PRJ-HEF-03',
    location: 'Gachibowli, Hyderabad',
    description: '1.8 km 4-lane elevated corridor with seismic-resistant piers.',
    budget: rupeesToPaise(32000000), // ₹3.2 Crore
    assignedInCharge: inCharge1._id,
    startDate: new Date('2025-11-15'),
    expectedCompletionDate: new Date('2027-03-31'),
    status: 'IN_PROGRESS',
    createdBy: owner._id,
  });

  // Link projects to users
  await User.findByIdAndUpdate(inCharge1._id, {
    $set: { assignedProjects: [project1._id, project3._id] },
  });
  await User.findByIdAndUpdate(inCharge2._id, {
    $set: { assignedProjects: [project2._id] },
  });

  // 3. Create Daily Reports
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(today.getDate() - 2);

  // Daily Report 1 (Yesterday - Metro Heights)
  await DailyReport.create({
    project: project1._id,
    submittedBy: inCharge1._id,
    titleOfWork: 'RCC Slab Casting & Level 4 Rebar Tie-Up',
    workDate: yesterday,
    workSummary: 'Level 4 slab reinforcement tie-up and conduit piping completed. Ready for concrete pour tomorrow.',
    workItems: [
      { description: 'Fe 550D TMT Steel Reinforcement tied', quantity: 4.5, unit: 'Tons' },
      { description: 'Film-faced shuttering plywood installed', quantity: 340, unit: 'sq.m' },
      { description: 'Electrical PVC conduits and junction boxes fixed', quantity: 480, unit: 'meters' },
    ],
    labourBreakdown: [
      { role: 'Mason', count: 6 },
      { role: 'Bar Bender', count: 14 },
      { role: 'Carpenter', count: 8 },
      { role: 'Helper', count: 22 },
      { role: 'Electrician', count: 4 },
    ],
    totalLabourCount: 54,
    equipmentDetails: 'Tower Crane operational (8.5 hrs). Batching plant calibration done. Vibrators serviced.',
    issuesAndDelays: 'Brief morning rain caused 45-minute delay; resumed under clear skies.',
    nextDayPlan: 'M25 grade ready-mix concrete batching and pour for slab 4B beginning 07:00 AM.',
    photos: [
      {
        url: 'https://images.unsplash.com/photo-1541888946425-d0fbb186156f?w=800&auto=format&fit=crop&q=60',
        caption: 'Tower crane lifting rebar bundle to 4th floor slab',
        uploadedAt: yesterday,
      },
      {
        url: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=800&auto=format&fit=crop&q=60',
        caption: 'Rebar binding inspection by site engineer',
        uploadedAt: yesterday,
      },
    ],
    status: 'SUBMITTED',
  });

  // Daily Report 2 (Two days ago - Greenfield Villas)
  await DailyReport.create({
    project: project2._id,
    submittedBy: inCharge2._id,
    titleOfWork: 'Brickwork & Underground Drainage Piping',
    workDate: twoDaysAgo,
    workSummary: 'Villa #4 and #5 brickwork up to lintel level completed. Plumbing drainage pipeline laid.',
    workItems: [
      { description: 'Red clay brick masonry (1:4 cement mortar)', quantity: 45, unit: 'cu.m' },
      { description: 'UPVC drainage pipes underground laying', quantity: 120, unit: 'meters' },
      { description: 'Plinth backfilling with river sand', quantity: 60, unit: 'cu.m' },
    ],
    labourBreakdown: [
      { role: 'Mason', count: 10 },
      { role: 'Plumber', count: 3 },
      { role: 'Helper', count: 16 },
    ],
    totalLabourCount: 29,
    equipmentDetails: 'Mini backhoe loader operated for 4 hours; 1 bag concrete mixer active.',
    issuesAndDelays: 'Cement delivery truck delayed by 2 hours due to local traffic.',
    nextDayPlan: 'RCC lintel beam casting and curing of wall masonry.',
    photos: [
      {
        url: 'https://images.unsplash.com/photo-1590381105924-c72589b9ef3f?w=800&auto=format&fit=crop&q=60',
        caption: 'Villa #4 lintel shuttering alignment check',
        uploadedAt: twoDaysAgo,
      },
    ],
    status: 'SUBMITTED',
  });

  // 4. Create Expenses
  // Expense 1: Approved Steel (Metro Heights)
  await Expense.create({
    project: project1._id,
    submittedBy: inCharge1._id,
    date: yesterday,
    category: 'CONSTRUCTION_MATERIALS',
    description: '15 MT Fe 550D TMT Steel Reinforcement Bars (12mm and 16mm)',
    amount: rupeesToPaise(825000), // ₹8,25,000 = 82,500,000 paise
    vendor: 'Tata Tiscon Authorized Distributor',
    receiptUrl: 'https://images.unsplash.com/photo-1607344645866-009c320c5ab8?w=800&auto=format&fit=crop&q=60',
    status: 'APPROVED',
    reviewedBy: owner._id,
    reviewedAt: new Date(),
    resubmissionCount: 0,
  });

  // Expense 2: Approved Fuel (Metro Heights)
  await Expense.create({
    project: project1._id,
    submittedBy: inCharge1._id,
    date: yesterday,
    category: 'DIESEL_AND_FUEL',
    description: 'Diesel for Tower Crane and 125 kVA On-site Generator (650 Litres)',
    amount: rupeesToPaise(58500), // ₹58,500
    vendor: 'Indian Oil Retail Outlet #22',
    receiptUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800&auto=format&fit=crop&q=60',
    status: 'APPROVED',
    reviewedBy: owner._id,
    reviewedAt: new Date(),
    resubmissionCount: 0,
  });

  // Expense 3: Approved Labour (Metro Heights)
  await Expense.create({
    project: project1._id,
    submittedBy: inCharge1._id,
    date: twoDaysAgo,
    category: 'LABOUR',
    description: 'Fortnightly labour gang advance payment for slab carpentry & bar benders',
    amount: rupeesToPaise(145000), // ₹1,45,000
    vendor: 'Shree Balaji Labour Contractor',
    receiptUrl: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800&auto=format&fit=crop&q=60',
    status: 'APPROVED',
    reviewedBy: owner._id,
    reviewedAt: new Date(),
    resubmissionCount: 0,
  });

  // Expense 4: Pending Crane Rental (Highland Flyover)
  await Expense.create({
    project: project3._id,
    submittedBy: inCharge1._id,
    date: yesterday,
    category: 'MACHINERY_AND_EQUIPMENT',
    description: 'Hydraulic Mobile Crane 50T rental (3 days) with certified rigger & operator',
    amount: rupeesToPaise(75000), // ₹75,000
    vendor: 'Kalyan Heavy Machinery Hirers',
    receiptUrl: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?w=800&auto=format&fit=crop&q=60',
    status: 'PENDING',
    resubmissionCount: 0,
  });

  // Expense 5: Pending Water Tankers (Greenfield Villas)
  await Expense.create({
    project: project2._id,
    submittedBy: inCharge2._id,
    date: yesterday,
    category: 'FOOD_AND_ACCOMMODATION',
    description: 'Potable water supply & labour colony sanitation water (8 tankers)',
    amount: rupeesToPaise(16000), // ₹16,000
    vendor: 'Evergreen Water Supply Services',
    receiptUrl: 'https://images.unsplash.com/photo-1554224154-26032ffc0d07?w=800&auto=format&fit=crop&q=60',
    status: 'PENDING',
    resubmissionCount: 0,
  });

  // Expense 6: Rejected Expense with Reason (Greenfield Villas)
  await Expense.create({
    project: project2._id,
    submittedBy: inCharge2._id,
    date: twoDaysAgo,
    category: 'TRANSPORTATION',
    description: 'Trailer freight charge for crushed aggregate from quarry',
    amount: rupeesToPaise(28000), // ₹28,000
    vendor: 'Speedway Road Transport',
    receiptUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800&auto=format&fit=crop&q=60',
    status: 'REJECTED',
    reviewedBy: owner._id,
    reviewedAt: yesterday,
    rejectionReason: 'GST invoice is missing weighbridge slips and vehicle registration details. Please obtain stamped weighbridge receipts and resubmit.',
    resubmissionCount: 0,
  });

  // 5. Audit Log Seed
  await AuditLog.create({
    action: 'SYSTEM_INITIALIZED',
    performedBy: owner._id,
    entityType: 'USER',
    entityId: owner._id,
    details: {
      message: 'SiteTrack database initialized with demo projects and accounts',
      timestamp: new Date(),
    },
  });

  console.log('✅ SiteTrack seeding completed successfully:');
  console.log('   - Owner: owner@sitetrack.com / SiteTrack@123');
  console.log('   - In-Charge 1: rajesh.incharge@sitetrack.com / SiteTrack@123');
  console.log('   - In-Charge 2: amit.incharge@sitetrack.com / SiteTrack@123');
  console.log('   - 3 active projects, daily reports, and sample expenses created.');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/seed.ts') || process.argv[1]?.replace(/\\/g, '/').endsWith('/seed.js')) {
  import('dotenv').then(d => d.config());
  import('../config/db.js').then(async ({ connectDB, disconnectDB }) => {
    try {
      await connectDB();
      await seedInitialData();
      await disconnectDB();
      process.exit(0);
    } catch (err) {
      console.error('Seeding script failed:', err);
      process.exit(1);
    }
  });
}
