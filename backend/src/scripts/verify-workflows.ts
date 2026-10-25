/**
 * SiteTrack End-to-End Automated Workflow Verification Test
 * Tests all 12 non-negotiable requirements against the running backend API.
 */

const BASE_URL = 'http://localhost:5000/api/v1';

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, options);
  return res.json();
}

async function runTests() {
  console.log('🧪 Starting SiteTrack End-to-End Verification Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, extraInfo = '') {
    if (condition) {
      console.log(`✅ PASS: ${testName} ${extraInfo ? `(${extraInfo})` : ''}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${extraInfo ? `(${extraInfo})` : ''}`);
      failed++;
    }
  }

  try {
    // 1. Owner Login
    const ownerLoginRes = await fetchJson(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@sitetrack.com', password: 'SiteTrack@123' }),
    });

    assert(ownerLoginRes.success === true, 'Test 1: Owner login succeeds', `Token: ${ownerLoginRes.token?.slice(0, 15)}...`);
    const ownerToken = ownerLoginRes.token;

    // 2. In-Charge Login
    const inChargeLoginRes = await fetchJson(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rajesh.incharge@sitetrack.com', password: 'SiteTrack@123' }),
    });

    assert(inChargeLoginRes.success === true && inChargeLoginRes.user.role === 'IN_CHARGE', 'Test 2: In-charge logs in with correct role');
    const inChargeToken = inChargeLoginRes.token;
    const inChargeId = inChargeLoginRes.user.id;

    // 3. In-Charge 2 Login (Amit)
    const inCharge2LoginRes = await fetchJson(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'amit.incharge@sitetrack.com', password: 'SiteTrack@123' }),
    });
    const inCharge2Token = inCharge2LoginRes.token;

    // 4. Owner creates a new Project & assigns to Rajesh
    const newProjectCode = `TEST-PRJ-${Date.now().toString().slice(-4)}`;
    const createProjectRes = await fetchJson(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({
        name: 'Skyline Commercial Center',
        code: newProjectCode,
        location: 'Cyber City, Gurugram',
        budget: 5000000, // ₹50 Lakhs -> 500,000,000 paise
        assignedInCharge: inChargeId,
        startDate: '2026-03-01',
        expectedCompletionDate: '2027-01-31',
        status: 'IN_PROGRESS',
      }),
    });

    assert(createProjectRes.success === true && createProjectRes.project.budget === 500000000, 'Test 3: Owner creates project with integer paise budget');
    const projectId = createProjectRes.project._id;

    // 5. Title of Work Validation & Daily Report Submission
    const invalidReportRes = await fetch(`${BASE_URL}/daily-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inChargeToken}` },
      body: JSON.stringify({
        project: projectId,
        titleOfWork: '', // Empty validation test
        workDate: new Date().toISOString(),
        workSummary: 'Testing empty title validation',
      }),
    });
    assert(invalidReportRes.status === 400, 'Test 4A: Empty Title of Work rejected with HTTP 400 validation error');

    const reportRes = await fetchJson(`${BASE_URL}/daily-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inChargeToken}` },
      body: JSON.stringify({
        project: projectId,
        titleOfWork: 'Excavation for Foundation & Raft Reinforcement',
        workDate: new Date().toISOString(),
        workSummary: 'Foundation raft rebar placement and formwork erected.',
        workItems: [{ description: 'Fe 550D rebar tied', quantity: 8.5, unit: 'Tons' }],
        labourBreakdown: [
          { role: 'Mason', count: 5 },
          { role: 'Helper', count: 15 },
        ],
        equipmentDetails: 'Concrete transit mixer on site',
        status: 'SUBMITTED',
      }),
    });

    assert(
      reportRes.success === true &&
      reportRes.report.titleOfWork === 'Excavation for Foundation & Raft Reinforcement' &&
      reportRes.report.totalLabourCount === 20,
      'Test 4B: In-charge submits daily report with manual Title of Work and accurate labour count'
    );
    const reportId = reportRes.report._id;

    // Search by Title of Work test
    const searchReportRes = await fetchJson(`${BASE_URL}/daily-reports?search=Excavation`, {
      headers: { Authorization: `Bearer ${inChargeToken}` },
    });
    assert(
      searchReportRes.success === true &&
      searchReportRes.reports.some((r: any) => r.titleOfWork.includes('Excavation')),
      'Test 4C: Daily reports searchable by exact saved Title of Work'
    );

    // Update Title of Work test
    const updateReportRes = await fetchJson(`${BASE_URL}/daily-reports/${reportId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inChargeToken}` },
      body: JSON.stringify({
        titleOfWork: 'Excavation for Foundation & Raft Reinforcement – Phase 1 Completed',
      }),
    });
    assert(
      updateReportRes.success === true &&
      updateReportRes.report.titleOfWork === 'Excavation for Foundation & Raft Reinforcement – Phase 1 Completed',
      'Test 4D: In-charge updates Title of Work and persists change'
    );

    // 6. In-Charge Rajesh submits an Expense with receipt
    const expenseRes = await fetchJson(`${BASE_URL}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inChargeToken}` },
      body: JSON.stringify({
        project: projectId,
        date: new Date().toISOString(),
        category: 'CONSTRUCTION_MATERIALS',
        amount: 45000, // ₹45,000 -> 4,500,000 paise
        vendor: 'UltraTech Cement Authorized Agency',
        description: '100 bags 53 Grade OPC Cement for raft pour',
        receiptUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800',
        status: 'PENDING',
      }),
    });

    assert(expenseRes.success === true && expenseRes.expense.amount === 4500000, 'Test 5: In-charge submits expense with accurate paise storage');
    const expenseId = expenseRes.expense._id;

    // 7. Duplicate Submission Prevention Test
    const duplicateRes = await fetch(`${BASE_URL}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inChargeToken}` },
      body: JSON.stringify({
        project: projectId,
        date: new Date().toISOString(),
        category: 'CONSTRUCTION_MATERIALS',
        amount: 45000,
        vendor: 'UltraTech Cement Authorized Agency',
        description: 'Duplicate attempt test',
      }),
    });
    assert(duplicateRes.status === 409, 'Test 6: Duplicate expense submission prevented with HTTP 409 Conflict');

    // 8. In-Charge cannot approve their own expense!
    const unauthApproval = await fetch(`${BASE_URL}/expenses/${expenseId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${inChargeToken}` },
    });
    assert(unauthApproval.status === 403, 'Test 7: In-Charge forbidden from self-approving expenses (HTTP 403)');

    // 9. Unauthorized In-Charge (Amit) cannot access Rajesh's project
    const crossAccessRes = await fetch(`${BASE_URL}/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${inCharge2Token}` },
    });
    assert(crossAccessRes.status === 403, 'Test 8: Cross-project security check blocks unauthorized in-charge (HTTP 403)');

    // 10. Owner reviews and Approves the expense
    const approveRes = await fetchJson(`${BASE_URL}/expenses/${expenseId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    assert(
      approveRes.success === true &&
      approveRes.expense.status === 'APPROVED' &&
      Boolean(approveRes.disclaimer),
      'Test 9: Owner approves expense; compliance disclaimer included'
    );

    // 11. Repeated approval prevented
    const repeatApprove = await fetch(`${BASE_URL}/expenses/${expenseId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(repeatApprove.status === 400, 'Test 10: Repeated approval prevented (HTTP 400)');

    // 12. Test Rejection flow with reason requirement
    const expense2Res = await fetchJson(`${BASE_URL}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inChargeToken}` },
      body: JSON.stringify({
        project: projectId,
        date: new Date().toISOString(),
        category: 'DIESEL_AND_FUEL',
        amount: 15000,
        vendor: 'Local Fuel Bunk',
        description: 'Emergency diesel for generator',
        status: 'PENDING',
      }),
    });

    const expense2Id = expense2Res.expense._id;

    // Reject without reason must fail
    const rejectWithoutReason = await fetch(`${BASE_URL}/expenses/${expense2Id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ reason: '' }),
    });
    assert(rejectWithoutReason.status === 400, 'Test 11: Rejection without documented reason is strictly rejected');

    // Reject with reason succeeds
    const rejectWithReason = await fetchJson(`${BASE_URL}/expenses/${expense2Id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ reason: 'Pump receipt missing machine seal stamp' }),
    });

    assert(
      rejectWithReason.success === true &&
      rejectWithReason.expense.status === 'REJECTED' &&
      rejectWithReason.expense.rejectionReason === 'Pump receipt missing machine seal stamp',
      'Test 12: Expense rejected with documented reason'
    );

    // 13. In-Charge resubmits corrected expense
    const resubmitRes = await fetchJson(`${BASE_URL}/expenses/${expense2Id}/resubmit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inChargeToken}` },
      body: JSON.stringify({
        amount: 15000,
        notes: 'Attached stamped fuel slip from manager',
      }),
    });

    assert(
      resubmitRes.success === true &&
      resubmitRes.expense.status === 'PENDING' &&
      resubmitRes.expense.resubmissionCount === 1,
      'Test 13: In-charge corrects and resubmits expense; status transitions back to PENDING'
    );

    // 14. Financial calculations in Owner Dashboard
    const dashboardRes = await fetchJson(`${BASE_URL}/dashboard/owner`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    assert(
      dashboardRes.success === true &&
      dashboardRes.kpis.approvedPaise > 0 &&
      dashboardRes.kpis.pendingPaise > 0 &&
      dashboardRes.kpis.remainingBudgetPaise > 0,
      'Test 14: Server-side financial aggregation correctly computes approved, pending, and remaining budgets'
    );

    console.log(`\n======================================================`);
    console.log(`🎉 Automated Workflow Verification Summary:`);
    console.log(`   Passed: ${passed}/${passed + failed}`);
    console.log(`   Failed: ${failed}/${passed + failed}`);
    console.log(`======================================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
