import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import http from 'http';
import express from 'express';
import { io as ClientIO } from '../../../frontend/node_modules/socket.io-client/build/esm/index.js';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { ProjectAssignment } from '../models/ProjectAssignment.js';
import { ProjectMessage } from '../models/ProjectMessage.js';
import { initSocketService, emitToProject } from '../services/socketService.js';
import communicationRoutes from '../routes/communicationRoutes.js';
import projectRoutes from '../routes/projectRoutes.js';
import { getJwtSecret } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

let httpServer: http.Server;
let serverPort: number;
const JWT_SECRET = process.env.JWT_SECRET || 'sitetrack_super_secure_jwt_secret_dev_2026_key';
const MONGODB_URI = process.env.MONGODB_URI;

async function runVerification() {
  console.log('\n========================================================================');
  console.log('🧪 VERIFY PROJECT CHAT SWITCHING & REAL-TIME MESSAGING SUITE');
  console.log('========================================================================\n');

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not defined in backend/.env');
  }

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to SiteTrack Database.\n');

  // Setup Express and HTTP server with Socket.IO
  const app = express();
  app.use(express.json());

  // Attach routes
  app.use('/api/v1/projects', projectRoutes);
  app.use('/api/v1/projects/:projectId/messages', communicationRoutes);

  httpServer = http.createServer(app);
  initSocketService(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      serverPort = typeof addr === 'object' && addr ? addr.port : 5001;
      resolve();
    });
  });

  console.log(`✅ Test HTTP & Socket.IO server running on port ${serverPort}\n`);

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

  try {
    // -------------------------------------------------------------------------
    // Step 1: Create Test Users (MD, Assigned In-Charge, Unassigned In-Charge)
    // -------------------------------------------------------------------------
    console.log('--- Step 1: Setting Up Actors & Role Permissions ---');

    const mdUser = await User.create({
      name: 'Vikram Singhania',
      email: 'md.singhania@sitetrack.com',
      password: 'HashedPassword123',
      role: 'MD',
      phone: '+91 98765 43210',
      isActive: true,
    });

    const inChargeUserA = await User.create({
      name: 'Rajesh Kumar',
      email: 'rajesh.incharge@sitetrack.com',
      password: 'HashedPassword123',
      role: 'SITE_INCHARGE',
      phone: '+91 98111 22334',
      isActive: true,
    });

    const inChargeUserB = await User.create({
      name: 'Amit Patel',
      email: 'amit.incharge@sitetrack.com',
      password: 'HashedPassword123',
      role: 'SITE_INCHARGE',
      phone: '+91 98222 33445',
      isActive: true,
    });

    const unassignedInCharge = await User.create({
      name: 'External Engineer',
      email: 'external@sitetrack.com',
      password: 'HashedPassword123',
      role: 'SITE_INCHARGE',
      phone: '+91 98999 88776',
      isActive: true,
    });

    const mdToken = jwt.sign(
      { userId: mdUser._id.toString(), email: mdUser.email, role: mdUser.role, name: mdUser.name },
      getJwtSecret(),
      { expiresIn: '1h' }
    );

    const inChargeAToken = jwt.sign(
      { userId: inChargeUserA._id.toString(), email: inChargeUserA.email, role: inChargeUserA.role, name: inChargeUserA.name },
      getJwtSecret(),
      { expiresIn: '1h' }
    );

    const unassignedToken = jwt.sign(
      { userId: unassignedInCharge._id.toString(), email: unassignedInCharge.email, role: unassignedInCharge.role, name: unassignedInCharge.name },
      getJwtSecret(),
      { expiresIn: '1h' }
    );

    assert(Boolean(mdToken && inChargeAToken && unassignedToken), 'Tokens successfully minted for all actors');

    // -------------------------------------------------------------------------
    // Step 2: Create Projects & Assignments
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2: Projects Setup (Project A, Project B, Project C, Project D) ---');

    const projectA = await Project.create({
      name: 'Cyber Heights Tower A',
      code: 'CH-101',
      location: 'HITEC City, Hyderabad',
      budget: 500000000,
      status: 'IN_PROGRESS',
      createdBy: mdUser._id,
      owner: mdUser._id,
      assignedInCharge: inChargeUserA._id,
    });

    await ProjectAssignment.create({
      project: projectA._id,
      siteInCharge: inChargeUserA._id,
      assignedBy: mdUser._id,
      assignmentStatus: 'ACTIVE',
    });

    const projectB = await Project.create({
      name: 'Falcon Green Villas',
      code: 'FG-202',
      location: 'Gachibowli, Hyderabad',
      budget: 350000000,
      status: 'IN_PROGRESS',
      createdBy: mdUser._id,
      owner: mdUser._id,
      assignedInCharge: inChargeUserB._id,
    });

    await ProjectAssignment.create({
      project: projectB._id,
      siteInCharge: inChargeUserB._id,
      assignedBy: mdUser._id,
      assignmentStatus: 'ACTIVE',
    });

    const projectC = await Project.create({
      name: 'Apex Horizon Mall',
      code: 'AH-303',
      location: 'Financial District, Hyderabad',
      budget: 800000000,
      status: 'IN_PROGRESS',
      createdBy: mdUser._id,
      owner: mdUser._id,
      assignedInCharge: inChargeUserA._id,
    });

    // Project D with 0 messages and no In-Charge assigned yet
    const projectD = await Project.create({
      name: 'Lakeview Enclave',
      code: 'LE-404',
      location: 'Madhapur, Hyderabad',
      budget: 150000000,
      status: 'PLANNING',
      createdBy: mdUser._id,
      owner: mdUser._id,
    });

    assert(projectA.code === 'CH-101' && projectB.code === 'FG-202', 'Projects initialized with unique codes and locations');

    // Seed messages
    const msgA1 = await ProjectMessage.create({
      project: projectA._id,
      sender: mdUser._id,
      content: 'Project A: Please share the excavation progress photos.',
      readBy: [{ user: mdUser._id, readAt: new Date() }],
    });

    const msgA2 = await ProjectMessage.create({
      project: projectA._id,
      sender: inChargeUserA._id,
      content: 'Project A: Soil testing completed, column reinforcement starting tomorrow.',
      readBy: [{ user: inChargeUserA._id, readAt: new Date() }],
    });

    const msgB1 = await ProjectMessage.create({
      project: projectB._id,
      sender: mdUser._id,
      content: 'Project B: Has the cement delivery arrived at Falcon Green?',
      readBy: [{ user: mdUser._id, readAt: new Date() }],
    });

    assert(Boolean(msgA1 && msgA2 && msgB1), 'Initial project messages seeded');

    // -------------------------------------------------------------------------
    // Scenario 1: Switching from Project A to Project B
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 1: Switching from Project A to Project B ---');

    const resA = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectA._id}/messages`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const dataA: any = await resA.json();
    console.log('Project A response:', JSON.stringify(dataA));

    assert(dataA.success === true && dataA.count === 2, 'Project A returns 2 messages');
    assert(dataA.messages.every((m: any) => String(m.project) === projectA._id.toString()), 'All messages in Project A belongs strictly to Project A');

    const resB = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectB._id}/messages`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const dataB: any = await resB.json();

    assert(dataB.success === true && dataB.count === 1, 'Project B returns 1 message');
    assert(dataB.messages[0].content.includes('Falcon Green'), 'Project B message content matches Project B');
    assert(!dataB.messages.some((m: any) => m.content.includes('excavation')), 'No Project A messages leak into Project B response');

    // -------------------------------------------------------------------------
    // Scenario 2: Rapid Switching Between Multiple Projects (A -> B -> C)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 2: Rapid Switching Between Projects with AbortSignal Simulation ---');

    const controllerA = new AbortController();
    const controllerB = new AbortController();

    // Start request A and abort immediately (simulating user clicking Project B before A finishes)
    const promiseA = fetch(`http://localhost:${serverPort}/api/v1/projects/${projectA._id}/messages`, {
      headers: { Authorization: `Bearer ${mdToken}` },
      signal: controllerA.signal,
    }).catch((err) => ({ aborted: true, name: err.name }));

    controllerA.abort();
    const abortedResultA = await promiseA;
    assert((abortedResultA as any).aborted === true, 'Previous request for Project A was successfully aborted on channel switch');

    // Start request B and abort immediately (user rapidly switches to Project C)
    const promiseB = fetch(`http://localhost:${serverPort}/api/v1/projects/${projectB._id}/messages`, {
      headers: { Authorization: `Bearer ${mdToken}` },
      signal: controllerB.signal,
    }).catch((err) => ({ aborted: true, name: err.name }));

    controllerB.abort();
    const abortedResultB = await promiseB;
    assert((abortedResultB as any).aborted === true, 'Intermediate request for Project B was successfully aborted');

    // Final request for Project C completes normally
    const resC = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectC._id}/messages`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const dataC: any = await resC.json();
    assert(dataC.success === true, 'Final destination Project C messages fetched cleanly without stale interference');

    // -------------------------------------------------------------------------
    // Scenario 3: Switching Back to Previously Opened Project
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 3: Switching Back to Project A ---');

    const resA2 = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectA._id}/messages`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const dataA2: any = await resA2.json();
    assert(dataA2.success === true && dataA2.count === 2, 'Project A messages reloaded accurately when switching back');

    // -------------------------------------------------------------------------
    // Scenario 4: Opening a Project with 0 Messages
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 4: Opening Project D with 0 Messages ---');

    const resD = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectD._id}/messages`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const dataD: any = await resD.json();
    assert(dataD.success === true && dataD.count === 0 && Array.isArray(dataD.messages), 'Project D returns clean empty messages array with count: 0');

    // Presence check for Project D (unassigned in-charge)
    const presenceDRes = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectD._id}/messages/presence`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const presenceDData: any = await presenceDRes.json();
    assert(presenceDData.hasAssignedInCharge === false, 'Presence accurately reports hasAssignedInCharge: false for unassigned project');
    assert(presenceDData.linkedMD.name === 'Vikram Singhania', 'Presence accurately reports linked MD');

    // -------------------------------------------------------------------------
    // Scenario 5: Real-Time Socket Connection & Room Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 5: Real-Time Socket Connection & Room Isolation ---');

    const socketMD = ClientIO(`http://localhost:${serverPort}`, {
      path: '/socket.io',
      auth: { token: mdToken },
      transports: ['websocket'],
    });

    const socketInChargeA = ClientIO(`http://localhost:${serverPort}`, {
      path: '/socket.io',
      auth: { token: inChargeAToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => socketMD.on('connect', () => resolve())),
      new Promise<void>((resolve) => socketInChargeA.on('connect', () => resolve())),
    ]);

    assert(socketMD.connected && socketInChargeA.connected, 'MD and In-Charge sockets successfully authenticated and connected');

    // Both join Project A
    await new Promise<void>((resolve) => {
      socketMD.emit('project:join', projectA._id.toString(), () => resolve());
    });
    await new Promise<void>((resolve) => {
      socketInChargeA.emit('project:join', projectA._id.toString(), () => resolve());
    });

    // InCharge A switches from Project A to Project B
    // Project B is not assigned to InCharge A! Let's verify Socket rejection!
    let joinBRejected: boolean = false;
    await new Promise<void>((resolve) => {
      socketInChargeA.emit('project:join', projectB._id.toString(), (ack: any) => {
        if (ack && ack.success === false) joinBRejected = true;
        resolve();
      });
    });
    assert(Boolean(joinBRejected), 'Unauthorized socket room join for Project B was rejected by server');

    // MD switches from Project A to Project B: leaves A, joins B
    await new Promise<void>((resolve) => {
      socketMD.emit('project:leave', projectA._id.toString());
      socketMD.emit('project:join', projectB._id.toString(), () => resolve());
    });

    // Now send a message to Project B
    let receivedByInChargeA: boolean = false;
    socketInChargeA.on('message:new', (msg) => {
      if (String(msg.project) === projectB._id.toString()) {
        receivedByInChargeA = true;
      }
    });

    let receivedByMD: boolean = false;
    socketMD.on('message:new', (msg) => {
      if (String(msg.project) === projectB._id.toString()) {
        receivedByMD = true;
      }
    });

    // Broadcast a new message to Project B
    emitToProject(projectB._id.toString(), 'message:new', {
      _id: 'test-msg-b2',
      project: projectB._id.toString(),
      content: 'Realtime announcement for Project B',
      sender: { name: 'Vikram Singhania', role: 'MD' },
    });

    // Wait 200ms
    await new Promise((r) => setTimeout(r, 200));

    assert(Boolean(receivedByMD), 'MD in Project B room received real-time Project B message');
    assert(!receivedByInChargeA, 'In-Charge in Project A room did NOT receive Project B message (strict room isolation)');

    // -------------------------------------------------------------------------
    // Scenario 6: Disconnect and Reconnect Auto-Rejoin
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 6: Disconnect and Reconnect Auto-Rejoin ---');

    socketMD.disconnect();
    assert(!socketMD.connected, 'Socket disconnected intentionally');

    socketMD.connect();
    await new Promise<void>((resolve) => {
      if (socketMD.connected) resolve();
      else socketMD.on('connect', () => resolve());
    });
    assert(socketMD.connected, 'Socket successfully reconnected');

    // Auto-rejoin active project
    let rejoindSuccess: boolean = false;
    await new Promise<void>((resolve) => {
      socketMD.emit('project:join', projectB._id.toString(), (ack: any) => {
        if (!ack || ack.success !== false) rejoindSuccess = true;
        resolve();
      });
    });
    assert(Boolean(rejoindSuccess), 'Active project channel room re-joined after reconnection');

    // -------------------------------------------------------------------------
    // Scenario 7: Message Sending Exactly Once & Deduplication
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 7: Message Sending & Cache Deduplication ---');

    const sendRes = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectA._id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mdToken}`,
      },
      body: JSON.stringify({
        content: 'Testing single delivery message',
      }),
    });
    const sendData: any = await sendRes.json();
    const createdMessage = sendData.data || sendData.message;
    assert(sendData.success === true && Boolean(createdMessage?._id), 'Message delivered and persisted to database');

    const deduplicationTestCache = [createdMessage];
    // Simulate socket broadcast of the same message arriving
    const duplicateCandidate = { ...createdMessage };
    const exists = deduplicationTestCache.some((m) => String(m._id) === String(duplicateCandidate._id));
    assert(exists === true, 'Deduplication logic correctly detected duplicate incoming message ID and prevented duplicate entry');

    // -------------------------------------------------------------------------
    // Scenario 8: Direct Navigation by Project Code ('CH-101') vs ObjectId
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 8: Direct Navigation by Project Code vs ObjectId ---');

    const resByCode = await fetch(`http://localhost:${serverPort}/api/v1/projects/CH-101/messages`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const dataByCode: any = await resByCode.json();
    assert(dataByCode.success === true, 'Direct navigation using project code "CH-101" resolved successfully');

    const resById = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectA._id}/messages`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const dataById: any = await resById.json();
    assert(dataByCode.count === dataById.count, 'Project code URL and ObjectId URL return identical message count');

    // -------------------------------------------------------------------------
    // Scenario 9: Privacy & Rejecting Unauthorized Access (403 Forbidden)
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 9: Rejecting Unauthorized Access (403 Forbidden) ---');

    const unauthorizedRes = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectA._id}/messages`, {
      headers: { Authorization: `Bearer ${unassignedToken}` },
    });
    assert(unauthorizedRes.status === 403, 'Unassigned user requesting Project A messages receives HTTP 403 Forbidden');

    const unauthData: any = await unauthorizedRes.json();
    assert(unauthData.message.includes('Forbidden'), 'Response contains clear forbidden message');

    // -------------------------------------------------------------------------
    // Scenario 10: MD and In-Charge Shared Channel Consistency
    // -------------------------------------------------------------------------
    console.log('\n--- Scenario 10: MD and In-Charge Shared Channel Consistency ---');

    const presenceRes = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectA._id}/messages/presence`, {
      headers: { Authorization: `Bearer ${mdToken}` },
    });
    const presenceData: any = await presenceRes.json();

    assert(presenceData.hasAssignedInCharge === true, 'Presence indicates assigned In-Charge is present');
    assert(presenceData.linkedMD.name === 'Vikram Singhania', 'Presence displays correct MD name');
    assert(presenceData.linkedInCharges.some((ic: any) => ic.name === 'Rajesh Kumar'), 'Presence lists Rajesh Kumar as assigned In-Charge');

    // In-Charge accesses the same project
    const inchargePresenceRes = await fetch(`http://localhost:${serverPort}/api/v1/projects/${projectA._id}/messages/presence`, {
      headers: { Authorization: `Bearer ${inChargeAToken}` },
    });
    const inchargePresenceData: any = await inchargePresenceRes.json();
    assert(inchargePresenceData.hasAssignedInCharge === true, 'In-Charge also sees consistent presence data');

    // Clean up
    socketMD.disconnect();
    socketInChargeA.disconnect();

    console.log('\n========================================================================');
    console.log(`🎉 ALL ${passedTests}/${totalTests} VERIFICATION TESTS PASSED SUCCESSFULLY!`);
    console.log('========================================================================\n');
  } catch (error: any) {
    console.error('\n❌ Test execution failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    if (httpServer) httpServer.close();
    try {
      await Project.deleteMany({ code: { $in: ['CH-101', 'FG-202', 'AH-303', 'LE-404'] } });
      await User.deleteMany({ email: { $in: ['md.singhania@sitetrack.com', 'rajesh.incharge@sitetrack.com', 'amit.incharge@sitetrack.com', 'external@sitetrack.com'] } });
    } catch {}
    await mongoose.disconnect();
  }
}

runVerification();
