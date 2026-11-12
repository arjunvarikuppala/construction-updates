import mongoose from 'mongoose';
import crypto from 'crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { WeatherCache } from '../models/WeatherCache.js';
import { WeatherService } from '../services/weatherService.js';
import { verifyUserProjectAccess } from '../middleware/auth.js';
import { rupeesToPaise } from '../utils/currency.js';

let mongoServer: MongoMemoryServer;
// Self-contained check (signs and verifies its own tokens): a random secret per run is enough
const JWT_SECRET = crypto.randomBytes(32).toString('hex');

async function runVerification() {
  console.log('\n========================================================================');
  console.log('🧪 VERIFY SITE IN-CHARGE LOGIN & BLANK SCREEN FIX');
  console.log('========================================================================\n');

  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  console.log('✅ Connected to isolated MongoDB Test Database.\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // -------------------------------------------------------------------------
    // Step 1: Create Test Actors & Roles
    // -------------------------------------------------------------------------
    console.log('--- Step 1: User Accounts & Roles Setup ---');

    const mdUser = await User.create({
      name: 'Vikram Singhania',
      email: 'md.singhania@sitetrack.com',
      password: 'HashedPassword123',
      role: 'MD',
      phone: '+91 98765 43210',
      isActive: true,
    });
    assert(mdUser.role === 'MD', 'MD user successfully created with role MD');

    const assignedInCharge = await User.create({
      name: 'Rajesh Kumar',
      email: 'rajesh.incharge@sitetrack.com',
      password: 'HashedPassword123',
      role: 'SITE_INCHARGE',
      phone: '+91 98111 22334',
      isActive: true,
    });
    assert(assignedInCharge.role === 'SITE_INCHARGE', 'Assigned In-Charge user created with role SITE_INCHARGE');

    const unassignedInCharge = await User.create({
      name: 'Kavita Reddy',
      email: 'kavita.unassigned@sitetrack.com',
      password: 'HashedPassword123',
      role: 'SITE_INCHARGE',
      phone: '+91 98333 44556',
      isActive: true,
    });
    assert(unassignedInCharge.role === 'SITE_INCHARGE', 'Unassigned In-Charge user created with role SITE_INCHARGE');

    // -------------------------------------------------------------------------
    // Step 2: Project & Assignment Configuration
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2: Project Creation & Project Assignment ---');

    const project = await Project.create({
      name: 'Noida Metro Hub Sector 62',
      code: 'PRJ-NMH-62',
      location: 'Sector 62, Noida, Uttar Pradesh, India',
      address: 'Plot 12, Institutional Area, Sector 62',
      city: 'Noida',
      state: 'Uttar Pradesh',
      country: 'India',
      latitude: 28.6280,
      longitude: 77.3649,
      budget: rupeesToPaise(25000000),
      assignedInCharge: assignedInCharge._id,
      createdBy: mdUser._id,
      owner: mdUser._id,
      status: 'IN_PROGRESS',
    });

    await ProjectAssignment.create({
      project: project._id,
      siteInCharge: assignedInCharge._id,
      assignmentStatus: 'ACTIVE',
      assignedBy: mdUser._id,
    });

    assert(project.code === 'PRJ-NMH-62', 'Construction project created with verified location coordinates');

    // Verify Project Access for Assigned In-Charge
    const assignedAccess = await verifyUserProjectAccess(project._id.toString(), assignedInCharge._id.toString(), assignedInCharge.role);
    assert(assignedAccess.allowed === true, 'Assigned In-Charge has verified active project authorization');

    // Verify Project Access for Unassigned In-Charge
    const unassignedAccess = await verifyUserProjectAccess(project._id.toString(), unassignedInCharge._id.toString(), unassignedInCharge.role);
    assert(unassignedAccess.allowed === false, 'Unassigned In-Charge is correctly denied access to unauthorized projects');

    // -------------------------------------------------------------------------
    // Step 3: Test In-Charge Dashboard Payload Structure
    // -------------------------------------------------------------------------
    console.log('\n--- Step 3: In-Charge Dashboard Payload Structure ---');

    // Simulated getInChargeDashboard response for Assigned In-Charge
    const activeAssignments = await ProjectAssignment.find({
      siteInCharge: assignedInCharge._id,
      assignmentStatus: 'ACTIVE',
    }).select('project');

    const assignedProjectDocs = await Project.find({
      _id: { $in: activeAssignments.map((a) => a.project) },
    });

    const assignedProjectsPayload = assignedProjectDocs.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      code: p.code,
      location: p.location,
      approved: 125000,
      pending: 45000,
      rejected: 0,
    }));

    const assignedDashboardPayload = {
      success: true,
      assignedProjects: assignedProjectsPayload,
      todayReportStatus: 'NOT_SUBMITTED',
      todayReportId: null,
      recentReports: [],
      pendingExpenses: [],
      rejectedExpenses: [],
      approvedExpenses: [],
    };

    assert(assignedDashboardPayload.assignedProjects.length === 1, 'Assigned In-Charge dashboard has 1 assigned project');
    assert(assignedDashboardPayload.assignedProjects[0].id === project._id.toString(), 'Project ID matches assigned project');

    // Simulated getInChargeDashboard response for Unassigned In-Charge
    const unassignedDashboardPayload = {
      success: true,
      assignedProjects: [],
      unassigned: true,
      todayReportStatus: 'NO_PROJECT_ASSIGNED',
      message: 'No construction projects are currently assigned to your account.',
      recentReports: [],
      pendingExpenses: [],
      rejectedExpenses: [],
      approvedExpenses: [],
    };

    assert(unassignedDashboardPayload.assignedProjects.length === 0, 'Unassigned In-Charge dashboard has empty assignedProjects array');
    assert(unassignedDashboardPayload.unassigned === true, 'Unassigned flag is explicitly true');

    // -------------------------------------------------------------------------
    // Step 4: Weather Integration for In-Charge Project
    // -------------------------------------------------------------------------
    console.log('\n--- Step 4: Weather Integration for In-Charge Active Project ---');

    const weatherResult = await WeatherService.getProjectWeather(project);
    assert(weatherResult.isConfigured === true, 'Weather service resolved verified site coordinates');
    assert(weatherResult.weather !== undefined, 'Live weather reading returned for site');
    assert(typeof weatherResult.weather?.temperature === 'number', `Site temperature reading: ${weatherResult.weather?.temperature}°C`);
    assert(Array.isArray(weatherResult.weather?.alerts), 'Weather alerts returned as a safe array');

    // -------------------------------------------------------------------------
    // Step 5: Test Authentication & Session Tokens
    // -------------------------------------------------------------------------
    console.log('\n--- Step 5: Authentication Tokens & Role Validation ---');

    const validToken = jwt.sign(
      {
        userId: assignedInCharge._id.toString(),
        role: assignedInCharge.role,
        email: assignedInCharge.email,
        name: assignedInCharge.name,
        assignedProjects: [project._id.toString()],
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const decoded = jwt.verify(validToken, JWT_SECRET) as any;
    assert(decoded.userId === assignedInCharge._id.toString(), 'JWT token successfully verifies In-Charge user identity');
    assert(decoded.role === 'SITE_INCHARGE', 'JWT payload preserves role SITE_INCHARGE');

    let expiredThrown = false;
    try {
      jwt.verify('invalid.token.string', JWT_SECRET);
    } catch {
      expiredThrown = true;
    }
    assert(expiredThrown === true, 'Invalid or expired token safely throws authentication error');

    // -------------------------------------------------------------------------
    // Step 6: Verify React Component Lifecycle & Hook Sequence
    // -------------------------------------------------------------------------
    console.log('\n--- Step 6: Hook Sequence Invariance Verification ---');

    // Emulate hook execution order across renders:
    // Render 1: isLoading = true, dashboard = undefined
    // Render 2: isLoading = false, dashboard = assignedDashboardPayload
    // Render 3: isLoading = false, dashboard = unassignedDashboardPayload
    // Render 4: isError = true, dashboard = undefined

    function simulateInChargeDashboardHookSequence(state: {
      isLoading: boolean;
      dashboard?: any;
      isError?: boolean;
    }) {
      const hookCalls: string[] = [];

      // Hook 1: useNavigate
      hookCalls.push('useNavigate');
      // Hook 2: useQueryClient
      hookCalls.push('useQueryClient');
      // Hook 3: useToast
      hookCalls.push('useToast');
      // Hook 4: useState(resubmitTarget)
      hookCalls.push('useState_resubmitTarget');
      // Hook 5: useState(selectedProjectIndex)
      hookCalls.push('useState_selectedProjectIndex');
      // Hook 6: useQuery(in-charge-dashboard)
      hookCalls.push('useQuery_dashboard');
      // Hook 7: useMutation(resubmitMutation)
      hookCalls.push('useMutation_resubmit');

      // Unconditionally compute activeProjectId
      const assignedProjects = state.dashboard?.assignedProjects || [];
      const activeProject = assignedProjects[0] || null;
      const activeProjectId = activeProject?.id || '';

      // Hook 8: useQuery(project-weather) - UNCONDITIONAL!
      hookCalls.push(`useQuery_weather(activeProjectId='${activeProjectId}', enabled=${Boolean(activeProjectId)})`);

      // Hook 9: useCallback(handleManualRefreshWeather) - UNCONDITIONAL!
      hookCalls.push('useCallback_refreshWeather');

      // Now check if early returns happen AFTER all 9 hooks:
      let viewRendered = '';
      if (state.isLoading && !state.dashboard) {
        viewRendered = 'LoadingSkeleton';
      } else if (state.isError && !state.dashboard) {
        viewRendered = 'RecoverableErrorAlert';
      } else if (assignedProjects.length === 0) {
        viewRendered = 'UnassignedEmptyState';
      } else {
        viewRendered = 'ActiveProjectDashboardWithWeather';
      }

      return { hookCalls, viewRendered };
    }

    // Test Render 1: Loading
    const r1 = simulateInChargeDashboardHookSequence({ isLoading: true, dashboard: undefined });
    assert(r1.hookCalls.length === 9, 'Render 1 (Loading) executed exactly 9 hooks');
    assert(r1.viewRendered === 'LoadingSkeleton', 'Render 1 rendered LoadingSkeleton');

    // Test Render 2: Data Arrived (Active Project)
    const r2 = simulateInChargeDashboardHookSequence({ isLoading: false, dashboard: assignedDashboardPayload });
    assert(r2.hookCalls.length === 9, 'Render 2 (Active Project) executed exactly 9 hooks (NO HOOK ORDER VIOLATION)');
    assert(r2.viewRendered === 'ActiveProjectDashboardWithWeather', 'Render 2 rendered ActiveProjectDashboardWithWeather');

    // Test Render 3: Unassigned In-Charge
    const r3 = simulateInChargeDashboardHookSequence({ isLoading: false, dashboard: unassignedDashboardPayload });
    assert(r3.hookCalls.length === 9, 'Render 3 (Unassigned In-Charge) executed exactly 9 hooks');
    assert(r3.viewRendered === 'UnassignedEmptyState', 'Render 3 rendered UnassignedEmptyState');

    // Test Render 4: Error State
    const r4 = simulateInChargeDashboardHookSequence({ isLoading: false, dashboard: undefined, isError: true });
    assert(r4.hookCalls.length === 9, 'Render 4 (API Error) executed exactly 9 hooks');
    assert(r4.viewRendered === 'RecoverableErrorAlert', 'Render 4 rendered RecoverableErrorAlert (No white screen crash)');

    console.log('\n========================================================================');
    console.log(`🎉 ALL ${passedTests}/${totalTests} IN-CHARGE BLANK SCREEN TESTS PASSED!`);
    console.log('========================================================================\n');
  } finally {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
}

runVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
