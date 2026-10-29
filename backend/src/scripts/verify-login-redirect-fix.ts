import '../config/env.js';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { getJwtSecret } from '../middleware/auth.js';
import authRoutes from '../routes/authRoutes.js';
import dashboardRoutes from '../routes/dashboardRoutes.js';
import projectRoutes from '../routes/projectRoutes.js';

let httpServer: http.Server;
let serverPort: number;
const MONGODB_URI = process.env.MONGODB_URI;

async function runVerification() {
  console.log('\n========================================================================');
  console.log('🧪 VERIFY REPEATED LOGIN REDIRECT & AUTHENTICATION SUITE');
  console.log('========================================================================\n');

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not defined in .env');
  }

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to SiteTrack Database.\n');

  const app = express();
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json());

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/dashboard', dashboardRoutes);
  app.use('/api/v1/projects', projectRoutes);

  httpServer = http.createServer(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      serverPort = typeof addr === 'object' && addr ? addr.port : 5002;
      resolve();
    });
  });

  console.log(`✅ Test server running on port ${serverPort}\n`);

  let totalTests = 0;
  let passedTests = 0;

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

  const testEmailMD = 'test.md.login.fix@sitetrack.com';
  const testEmailIC = 'test.incharge.login.fix@sitetrack.com';
  const testPassword = 'SecurePassword123!';

  try {
    // Clean up any stale test users
    await User.deleteMany({ email: { $in: [testEmailMD, testEmailIC] } });

    // Create test accounts with bcrypt hashed passwords
    const mdUser = await User.create({
      name: 'Aditya Singhania',
      email: testEmailMD,
      password: testPassword,
      role: 'MD',
      phone: '+91 99000 11223',
      isActive: true,
    });

    const icUser = await User.create({
      name: 'Suresh Patel',
      email: testEmailIC,
      password: testPassword,
      role: 'SITE_INCHARGE',
      phone: '+91 99000 44556',
      isActive: true,
    });

    // -------------------------------------------------------------------------
    // Test 1: Successful MD Login
    // -------------------------------------------------------------------------
    console.log('--- Test 1: Successful MD Login ---');
    const mdLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmailMD, password: testPassword }),
    });
    const mdLoginData: any = await mdLoginRes.json();

    assert(mdLoginRes.status === 200 && mdLoginData.success === true, 'MD login request returned HTTP 200 with success: true');
    assert(Boolean(mdLoginData.token), 'MD login response contains valid JWT token');
    assert(mdLoginData.user?.role === 'MD', 'MD user object has role "MD"');

    const mdToken = mdLoginData.token;

    // -------------------------------------------------------------------------
    // Test 2: Successful Site In-Charge Login
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Successful Site In-Charge Login ---');
    const icLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmailIC, password: testPassword }),
    });
    const icLoginData: any = await icLoginRes.json();

    assert(icLoginRes.status === 200 && icLoginData.success === true, 'Site In-Charge login request returned HTTP 200');
    assert(Boolean(icLoginData.token), 'Site In-Charge login response contains valid JWT token');
    assert(icLoginData.user?.role === 'SITE_INCHARGE', 'User object has role "SITE_INCHARGE"');

    const icToken = icLoginData.token;

    // -------------------------------------------------------------------------
    // Test 3: Correct Role-Based Dashboard Access & Redirects
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Role-Based Dashboard Access & Permissions ---');
    const mdDashRes = await fetch(`http://localhost:${serverPort}/api/v1/dashboard/owner`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    assert(mdDashRes.status === 200, 'MD token allows authorized access to MD Owner Dashboard');

    const icDashRes = await fetch(`http://localhost:${serverPort}/api/v1/dashboard/in-charge`, {
      headers: { Authorization: `Bearer ${icToken}` },
    });
    assert(icDashRes.status === 200, 'Site In-Charge token allows authorized access to In-Charge Dashboard');

    // In-Charge attempting to access MD dashboard must be rejected with 403 Forbidden
    const icForbiddenRes = await fetch(`http://localhost:${serverPort}/api/v1/dashboard/owner`, {
      headers: { Authorization: `Bearer ${icToken}` },
    });
    assert(icForbiddenRes.status === 403, 'In-Charge attempting to access MD dashboard is correctly rejected with 403 Forbidden');

    // -------------------------------------------------------------------------
    // Test 4: Refreshing the Dashboard While Authenticated (/auth/me)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Dashboard Page Refresh Session Verification (/auth/me) ---');
    const meMDRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const meMDData: any = await meMDRes.json();

    assert(meMDRes.status === 200 && meMDData.success === true, 'Dashboard refresh /auth/me successfully verifies MD session without 401');
    assert(meMDData.user?.email === testEmailMD, 'Returned user profile matches active MD account');

    const meICRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${icToken}` },
    });
    const meICData: any = await meICRes.json();

    assert(meICRes.status === 200 && meICData.success === true, 'Dashboard refresh /auth/me successfully verifies In-Charge session without 401');
    assert(meICData.user?.email === testEmailIC, 'Returned user profile matches active In-Charge account');

    // -------------------------------------------------------------------------
    // Test 5: Logging Out and Logging in Again
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Logging Out & Logging In Again ---');
    // Simulate client-side logout: token is discarded. Subsequent request without token must fail.
    const loggedOutRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/me`);
    assert(loggedOutRes.status === 401, 'Request after token clearance returns 401 Authentication Required');

    // Re-login with credentials
    const reLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmailMD, password: testPassword }),
    });
    const reLoginData: any = await reLoginRes.json();
    assert(reLoginRes.status === 200 && Boolean(reLoginData.token), 'Subsequent re-login produces a fresh valid authentication token');

    // -------------------------------------------------------------------------
    // Test 6: Invalid Credentials Handling
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Invalid Credentials Handling ---');
    const wrongPassRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmailMD, password: 'WrongPassword999!' }),
    });
    const wrongPassData: any = await wrongPassRes.json();
    assert(wrongPassRes.status === 401, 'Incorrect password returns HTTP 401');
    assert(wrongPassData.message.includes('Invalid email or password'), 'Clear, secure error message returned for invalid password');

    const wrongEmailRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent.user@sitetrack.com', password: 'AnyPassword123!' }),
    });
    assert(wrongEmailRes.status === 401, 'Non-existent email returns HTTP 401');

    // -------------------------------------------------------------------------
    // Test 7: Expired or Invalid Sessions
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: Expired or Invalid Sessions Handling ---');
    // Forged signature
    const forgedToken = jwt.sign({ userId: mdUser._id.toString(), role: 'MD' }, 'completely_wrong_secret_123');
    const forgedRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    const forgedData: any = await forgedRes.json();
    assert(forgedRes.status === 401, 'Forged or tampered JWT returns HTTP 401');
    assert(forgedData.message.includes('Invalid or expired authentication session'), 'Clear session message returned for invalid signature');

    // Expired token (0s lifetime)
    const expiredToken = jwt.sign(
      { userId: mdUser._id.toString(), role: 'MD' },
      getJwtSecret(),
      { expiresIn: '-1s' }
    );
    const expiredRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert(expiredRes.status === 401, 'Expired JWT returns HTTP 401');

    // -------------------------------------------------------------------------
    // Test 8: Direct Access to Protected Routes Without Credentials
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: Direct Access to Protected Routes Without Token ---');
    const directProjRes = await fetch(`http://localhost:${serverPort}/api/v1/projects`);
    assert(directProjRes.status === 401, 'Direct unauthenticated request to /projects rejected with 401');

    const directDashRes = await fetch(`http://localhost:${serverPort}/api/v1/dashboard/owner`);
    assert(directDashRes.status === 401, 'Direct unauthenticated request to /dashboard/owner rejected with 401');

    // -------------------------------------------------------------------------
    // Test 9: Token Transport and URL Authentication Query Fallback
    // -------------------------------------------------------------------------
    console.log('\n--- Test 9: Token Transport & Authentication Support ---');
    // Media streaming / query param token support (?token=...)
    const queryAuthRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/me?token=${encodeURIComponent(mdToken)}`);
    assert(queryAuthRes.status === 200, 'Query param ?token= fallback authenticates successfully for media and PWA views');

    console.log('\n========================================================================');
    console.log(`🎉 ALL ${passedTests}/${totalTests} AUTHENTICATION VERIFICATION TESTS PASSED!`);
    console.log('========================================================================\n');
  } catch (error: any) {
    console.error('\n❌ Verification failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    if (httpServer) httpServer.close();
    try {
      await User.deleteMany({ email: { $in: [testEmailMD, testEmailIC] } });
    } catch {}
    await mongoose.disconnect();
  }
}

runVerification();
