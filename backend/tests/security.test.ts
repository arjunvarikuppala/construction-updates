import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer,
  stopTestServer,
  api,
  rawGet,
  registerMD,
  createProject,
  assignNewInCharge,
  tinyPng,
  webhookSignature,
  STRONG_PASSWORD,
  uniq,
} from './helpers.js';

let mdA: { token: string; userId: string; email: string };
let mdB: { token: string; userId: string; email: string };
let projectA: any;
let projectB: any;
let inChargeA: { token: string; email: string; userId: string };

before(async () => {
  await startTestServer();
  mdA = await registerMD('AcmeMD');
  mdB = await registerMD('BuildcoMD');
  projectA = await createProject(mdA.token, 'Acme');
  projectB = await createProject(mdB.token, 'Buildco');
  inChargeA = await assignNewInCharge(mdA.token, projectA._id, 'Ravi');
});

after(async () => {
  await stopTestServer();
});

describe('payment company isolation', () => {
  let paymentId: string;
  let beneficiaryId: string;

  before(async () => {
    const r = await api('POST', '/api/v1/payments/requests', {
      token: inChargeA.token,
      body: {
        projectId: projectA._id,
        amountRupees: 2500,
        paymentMethod: 'UPI',
        purpose: 'Cement bags',
        newBeneficiary: { name: 'Sri Cement Traders', payeeType: 'SUPPLIER', vpa: 'sricement@okhdfcbank' },
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    paymentId = r.body.payment._id;
    beneficiaryId = String(r.body.payment.beneficiary);
  });

  test('other company MD cannot read the payment', async () => {
    const r = await api('GET', `/api/v1/payments/requests/${paymentId}`, { token: mdB.token });
    assert.equal(r.status, 404);
  });

  for (const [action, method, body] of [
    ['review', 'PUT', { remarks: 'x' }],
    ['authorize', 'POST', { notes: 'x' }],
    ['reject', 'POST', { reason: 'x' }],
    ['initiate', 'POST', {}],
    ['reconcile', 'POST', {}],
    ['cancel', 'POST', { reason: 'x' }],
  ] as const) {
    test(`other company MD cannot ${action} the payment`, async () => {
      const r = await api(method, `/api/v1/payments/requests/${paymentId}/${action}`, { token: mdB.token, body });
      assert.equal(r.status, 404, `${action} returned ${r.status}`);
    });
  }

  test('payment state is unchanged after cross-company attempts', async () => {
    const r = await api('GET', `/api/v1/payments/requests/${paymentId}`, { token: mdA.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.payment.status, 'SUBMITTED');
    assert.equal(r.body.payment.authorizedBy, undefined);
  });

  test('other company payment list excludes it', async () => {
    const r = await api('GET', '/api/v1/payments/requests', { token: mdB.token });
    assert.equal(r.status, 200);
    assert.ok(!r.body.payments.some((p: any) => p._id === paymentId));
    assert.equal(r.body.summary.awaitingAuthCount, 0);
  });

  test('in-charge cannot authorize or initiate', async () => {
    const a = await api('POST', `/api/v1/payments/requests/${paymentId}/authorize`, { token: inChargeA.token, body: {} });
    assert.equal(a.status, 403);
    const i = await api('POST', `/api/v1/payments/requests/${paymentId}/initiate`, { token: inChargeA.token, body: {} });
    assert.equal(i.status, 403);
  });

  test('owning MD can authorize', async () => {
    const r = await api('POST', `/api/v1/payments/requests/${paymentId}/authorize`, { token: mdA.token, body: { notes: 'ok' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.payment.status, 'AUTHORIZED');
  });

  test('beneficiaries are scoped by company', async () => {
    const listB = await api('GET', '/api/v1/payments/beneficiaries', { token: mdB.token });
    assert.equal(listB.status, 200);
    assert.ok(!listB.body.beneficiaries.some((b: any) => b._id === beneficiaryId));
    const getB = await api('GET', `/api/v1/payments/beneficiaries/${beneficiaryId}`, { token: mdB.token });
    assert.equal(getB.status, 404);
    const validateB = await api('POST', `/api/v1/payments/beneficiaries/${beneficiaryId}/validate`, { token: mdB.token });
    assert.equal(validateB.status, 404);
    const listA = await api('GET', '/api/v1/payments/beneficiaries', { token: mdA.token });
    assert.ok(listA.body.beneficiaries.some((b: any) => b._id === beneficiaryId));
  });

  test("another company's beneficiary cannot be used for a payment", async () => {
    const r = await api('POST', '/api/v1/payments/requests', {
      token: mdB.token,
      body: { projectId: projectB._id, amountRupees: 100, paymentMethod: 'UPI', purpose: 'x', beneficiaryId },
    });
    assert.equal(r.status, 404);
  });

  test('high-value payment cannot be self-authorized by its creator', async () => {
    const r = await api('POST', '/api/v1/payments/requests', {
      token: mdA.token,
      body: {
        projectId: projectA._id,
        amountRupees: 250000,
        paymentMethod: 'NEFT',
        purpose: 'Steel',
        newBeneficiary: { name: 'Steel Co', payeeType: 'SUPPLIER', accountNumber: '123456789012', ifsc: 'HDFC0000240' },
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.payment.status, 'AWAITING_AUTHORIZATION');
    const auth = await api('POST', `/api/v1/payments/requests/${r.body.payment._id}/authorize`, { token: mdA.token, body: {} });
    assert.equal(auth.status, 403);
    const init = await api('POST', `/api/v1/payments/requests/${r.body.payment._id}/initiate`, { token: mdA.token, body: {} });
    assert.equal(init.status, 400);
  });
});

describe('webhook signature', () => {
  test('rejects missing or invalid signatures', async () => {
    const body = JSON.stringify({ event_id: 'evt_1', event: 'payout.processed', payload: {} });
    const noSig = await api('POST', '/api/v1/payments/webhook', { body });
    assert.equal(noSig.status, 401);
    const badSig = await api('POST', '/api/v1/payments/webhook', { body, headers: { 'x-razorpay-signature': 'a'.repeat(64) } });
    assert.equal(badSig.status, 401);
  });

  test('accepts a correctly signed webhook', async () => {
    const body = JSON.stringify({ event_id: uniq('evt_'), event: 'payout.processed', payload: {} });
    const r = await api('POST', '/api/v1/payments/webhook', { body, headers: { 'x-razorpay-signature': webhookSignature(body) } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});

describe('authentication hardening', () => {
  test('token in URL query string is rejected', async () => {
    const r = await api('GET', `/api/v1/auth/me?token=${encodeURIComponent(mdA.token)}`);
    assert.equal(r.status, 401);
  });

  test('weak passwords are rejected at registration', async () => {
    const r = await api('POST', '/api/v1/auth/register', {
      body: { name: 'Weak', email: `${uniq('weak')}@example.test`, password: 'abc123' },
    });
    assert.equal(r.status, 400);
    const noDigit = await api('POST', '/api/v1/auth/register', {
      body: { name: 'Weak', email: `${uniq('weak')}@example.test`, password: 'abcdefghij' },
    });
    assert.equal(noDigit.status, 400);
  });

  test('non-string login fields are rejected (no operator injection)', async () => {
    const r = await api('POST', '/api/v1/auth/login', { body: { email: { $ne: null }, password: { $ne: null } } });
    assert.equal(r.status, 400);
  });

  test('login is rate limited after repeated failures', async () => {
    const email = `${uniq('victim')}@example.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await api('POST', '/api/v1/auth/login', { body: { email, password: 'WrongPass123' } });
      statuses.push(r.status);
    }
    assert.ok(statuses.slice(0, 5).every((s) => s === 401), statuses.join(','));
    assert.equal(statuses[6], 429);
  });

  test('valid login still works', async () => {
    const r = await api('POST', '/api/v1/auth/login', { body: { email: mdA.email, password: STRONG_PASSWORD } });
    assert.equal(r.status, 200);
  });
});

describe('private file access', () => {
  let fileUrl: string;

  before(async () => {
    const form = new FormData();
    form.append('file', tinyPng(), 'site.png');
    const r = await api('POST', '/api/v1/uploads/single', { token: inChargeA.token, form });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    fileUrl = r.body.fileUrl;
    assert.match(fileUrl, /^\/uploads\//);
  });

  test('raw /uploads URL without signature is refused', async () => {
    const r = await rawGet(fileUrl);
    assert.equal(r.status, 403);
  });

  test('uploader can sign and fetch their own upload', async () => {
    const s = await api('POST', '/api/v1/files/sign', { token: inChargeA.token, body: { urls: [fileUrl] } });
    assert.equal(s.status, 200);
    const signed = s.body.signed[fileUrl];
    assert.ok(signed);
    const f = await rawGet(signed);
    assert.equal(f.status, 200);
    assert.equal(f.headers.get('content-type'), 'image/png');
  });

  test('tampered signature is refused', async () => {
    const s = await api('POST', '/api/v1/files/sign', { token: inChargeA.token, body: { urls: [fileUrl] } });
    const tampered = s.body.signed[fileUrl].replace(/sig=[0-9a-f]{4}/, 'sig=0000');
    const f = await rawGet(tampered);
    assert.equal(f.status, 403);
  });

  test('unattached upload is private to its uploader; attached upload follows project access', async () => {
    const before = await api('POST', '/api/v1/files/sign', { token: mdA.token, body: { urls: [fileUrl] } });
    assert.equal(before.body.signed[fileUrl], null);

    const rep = await api('POST', '/api/v1/daily-reports', {
      token: inChargeA.token,
      body: {
        project: projectA._id,
        titleOfWork: 'Photo attach test',
        workDate: new Date().toISOString(),
        workSummary: 'Attaching a photo',
        photos: [{ url: fileUrl, caption: 'site' }],
        status: 'SUBMITTED',
      },
    });
    assert.equal(rep.status, 201, JSON.stringify(rep.body));

    const forA = await api('POST', '/api/v1/files/sign', { token: mdA.token, body: { urls: [fileUrl] } });
    assert.ok(forA.body.signed[fileUrl]);
    const forB = await api('POST', '/api/v1/files/sign', { token: mdB.token, body: { urls: [fileUrl] } });
    assert.equal(forB.body.signed[fileUrl], null);
  });

  test('foreign photo URLs are rejected on reports', async () => {
    const r = await api('POST', '/api/v1/daily-reports', {
      token: inChargeA.token,
      body: {
        project: projectA._id,
        titleOfWork: 'Bad url',
        workDate: new Date().toISOString(),
        workSummary: 'x',
        photos: [{ url: 'javascript:alert(1)' }],
      },
    });
    assert.equal(r.status, 400);
  });
});

describe('company data isolation', () => {
  test("dashboard rejects another company's projectId", async () => {
    const r = await api('GET', `/api/v1/dashboard/owner?projectId=${projectA._id}`, { token: mdB.token });
    assert.equal(r.status, 404);
  });

  test('analytics rejects another company project', async () => {
    const r = await api('GET', `/api/v1/dashboard/analytics?projectId=${projectA._id}`, { token: mdB.token });
    assert.equal(r.status, 404);
  });

  test('audit log contains only own company activity', async () => {
    const r = await api('GET', '/api/v1/audit-logs?limit=500', { token: mdB.token });
    assert.equal(r.status, 200);
    const performers = new Set(r.body.logs.map((l: any) => String(l.performedBy?._id || l.performedBy)));
    assert.ok(!performers.has(mdA.userId));
    assert.ok(!performers.has(inChargeA.userId));
  });

  test('in-charge directory is company scoped', async () => {
    const r = await api('GET', '/api/v1/users/in-charge', { token: mdB.token });
    assert.equal(r.status, 200);
    assert.ok(!r.body.users.some((u: any) => String(u._id) === inChargeA.userId));
    const upd = await api('PUT', `/api/v1/users/in-charge/${inChargeA.userId}`, { token: mdB.token, body: { isActive: false } });
    assert.equal(upd.status, 404);
    const mine = await api('GET', '/api/v1/users/in-charge', { token: mdA.token });
    assert.ok(mine.body.users.some((u: any) => String(u._id) === inChargeA.userId));
  });

  test("MD cannot assign another company's in-charge by id", async () => {
    const r = await api('POST', `/api/v1/projects/${projectB._id}/assignments`, {
      token: mdB.token,
      body: { siteInChargeId: inChargeA.userId },
    });
    assert.equal(r.status, 400);
  });

  test('project assignments are not visible to other companies', async () => {
    const r = await api('GET', `/api/v1/projects/${projectA._id}/assignments`, { token: mdB.token });
    assert.equal(r.status, 404);
  });

  test('expense export is company scoped', async () => {
    const r = await api('GET', `/api/v1/export/expenses/excel?projectId=${projectA._id}`, { token: mdB.token });
    assert.equal(r.status, 404);
  });

  test('missing-reports list only covers own projects', async () => {
    const r = await api('GET', '/api/v1/daily-reports/missing', { token: mdB.token });
    assert.equal(r.status, 200);
    assert.ok(r.body.missingReports.every((m: any) => String(m.project._id) === String(projectB._id)));
  });
});

describe('safe error responses', () => {
  test('internal errors do not leak exception details', async () => {
    const r = await api('GET', '/api/v1/expenses/not-an-object-id', { token: mdA.token });
    assert.ok(r.status >= 400);
    assert.equal(r.body.error, undefined);
    assert.equal(r.body.stack, undefined);
  });

  test('unknown API routes return JSON 404', async () => {
    const r = await api('GET', '/api/v1/does-not-exist', { token: mdA.token });
    assert.equal(r.status, 404);
  });
});

describe('payment cancellation', () => {
  test('a cancelled request is marked CANCELLED and can never be paid out', async () => {
    const created = await api('POST', '/api/v1/payments/requests', {
      token: inChargeA.token,
      body: { projectId: projectA._id, amountRupees: 10, paymentMethod: 'UPI', purpose: 'Cancel me', newBeneficiary: { name: 'Cancel Vendor', payeeType: 'SUPPLIER', vpa: 'cancelvendor@okhdfcbank' } },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.payment._id;
    assert.equal((await api('POST', `/api/v1/payments/requests/${id}/authorize`, { token: mdA.token, body: {} })).status, 200);
    const cancel = await api('POST', `/api/v1/payments/requests/${id}/cancel`, { token: mdA.token, body: { reason: 'Not needed' } });
    assert.equal(cancel.status, 200);
    const after = await api('GET', `/api/v1/payments/requests/${id}`, { token: mdA.token });
    assert.equal(after.body.payment.status, 'CANCELLED');
    const initiate = await api('POST', `/api/v1/payments/requests/${id}/initiate`, { token: mdA.token, body: {} });
    assert.equal(initiate.status, 400);
    const again = await api('POST', `/api/v1/payments/requests/${id}/cancel`, { token: mdA.token, body: {} });
    assert.equal(again.status, 400);
  });
});

describe('single-company registration', () => {
  test('public sign-up is closed once an MD exists (default deployment)', async () => {
    const prev = process.env.ALLOW_PUBLIC_REGISTRATION;
    process.env.ALLOW_PUBLIC_REGISTRATION = 'false';
    try {
      const status = await api('GET', '/api/v1/auth/first-md-status');
      assert.equal(status.body.hasMD, true);
      assert.equal(status.body.registrationOpen, false);
      for (const path of ['/api/v1/auth/register', '/api/v1/auth/register-md', '/api/v1/auth/register-first-md']) {
        const r = await api('POST', path, {
          body: { name: 'Outsider', email: `${uniq('outsider')}@example.test`, password: STRONG_PASSWORD },
        });
        assert.equal(r.status, 403, path);
      }
      // Existing users can still sign in
      const ok = await api('POST', '/api/v1/auth/login', { body: { email: mdA.email, password: STRONG_PASSWORD } });
      assert.equal(ok.status, 200);
    } finally {
      process.env.ALLOW_PUBLIC_REGISTRATION = prev;
    }
  });
});

describe('revoked assignment', () => {
  test('revoked in-charge loses project access', async () => {
    const ic = await assignNewInCharge(mdA.token, projectA._id, 'Suresh');
    const ok = await api('GET', `/api/v1/daily-reports?projectId=${projectA._id}`, { token: ic.token });
    assert.equal(ok.status, 200);

    const rev = await api('DELETE', `/api/v1/projects/${projectA._id}/assignments/${ic.userId}`, { token: mdA.token });
    assert.equal(rev.status, 200, JSON.stringify(rev.body));

    const list = await api('GET', `/api/v1/daily-reports?projectId=${projectA._id}`, { token: ic.token });
    assert.equal(list.status, 403);
    const create = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: { project: projectA._id, titleOfWork: 'x', workDate: new Date().toISOString(), workSummary: 'x' },
    });
    assert.equal(create.status, 403);
    const projects = await api('GET', '/api/v1/projects', { token: ic.token });
    assert.ok(!projects.body.projects.some((p: any) => String(p._id) === String(projectA._id)));
  });
});
