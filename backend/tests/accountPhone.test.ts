/**
 * Mobile numbers on accounts (required, unique, stored as +91XXXXXXXXXX), in-charges join
 * only by invitation, and nobody (the MD included) can set someone else's password.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge, inviteAndAccept, login, uniq, uniqPhone, STRONG_PASSWORD } from './helpers.js';

let md: { token: string; userId: string; email: string };
let ic: { token: string; email: string; userId: string };
let icPhone: string;

before(async () => {
  await startTestServer();
  md = await registerMD('PhoneMD');
  const project = await createProject(md.token, 'Phone site');
  ic = await assignNewInCharge(md.token, project._id, 'Suresh');
  const me = await api('GET', '/api/v1/auth/me', { token: ic.token });
  icPhone = me.body.user.phone;
});

after(async () => {
  await stopTestServer();
});

describe('mobile numbers on accounts', () => {
  test('stored as +91 and 10 digits, whatever the format typed', async () => {
    const { accepted } = await inviteAndAccept(md.token, { name: 'Typed', phone: '098480-22338' });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
    assert.equal(accepted.body.user.phone, '+919848022338');
  });

  test('new accounts need a valid, unused mobile number', async () => {
    assert.equal((await inviteAndAccept(md.token, { phone: null })).accepted.status, 400);
    assert.equal((await inviteAndAccept(md.token, { phone: '12345' })).accepted.status, 400);
    assert.equal((await inviteAndAccept(md.token, { phone: '+14155550123' })).accepted.status, 400);
    assert.equal((await inviteAndAccept(md.token, { phone: '+91 98480 22338' })).accepted.status, 409);
    const reg = await api('POST', '/api/v1/auth/register', { body: { name: 'X', email: `${uniq('x')}@example.test`, password: STRONG_PASSWORD } });
    assert.equal(reg.status, 400);
  });

  test('in-charges join only by invitation: the MD cannot create one with a password', async () => {
    const direct = await api('POST', '/api/v1/users/in-charge', {
      token: md.token,
      body: { name: 'Direct', email: `${uniq('direct')}@example.test`, password: STRONG_PASSWORD, phone: uniqPhone() },
    });
    assert.equal(direct.status, 404);
    const project = await createProject(md.token, 'Direct site');
    const viaProject = await api('POST', `/api/v1/projects/${project._id}/assignments`, {
      token: md.token,
      body: { newUser: { name: 'Direct', email: `${uniq('direct')}@example.test`, password: STRONG_PASSWORD, phone: uniqPhone() } },
    });
    assert.equal(viaProject.status, 400);
    assert.match(viaProject.body.message, /invitation/);
  });

  test('you can set your own number; the MD can change an in-charge number but not clear it', async () => {
    const mine = uniqPhone();
    const r = await api('PUT', '/api/v1/auth/me/phone', { token: md.token, body: { phone: mine } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.phone, `+91${mine}`);
    const taken = await api('PUT', '/api/v1/auth/me/phone', { token: md.token, body: { phone: icPhone } });
    assert.equal(taken.status, 409);
    const cleared = await api('PUT', `/api/v1/users/in-charge/${ic.userId}`, { token: md.token, body: { phone: '' } });
    assert.equal(cleared.status, 200);
    const me = await api('GET', '/api/v1/auth/me', { token: ic.token });
    assert.equal(me.body.user.phone, icPhone);
  });

  test('older numbers saved as typed are rewritten as +91XXXXXXXXXX', async () => {
    const { User } = await import('../src/models/User.js');
    const { normalizeStoredPhones } = await import('../src/services/accountPhoneService.js');
    const u = await User.create({ name: 'Legacy', email: `${uniq('legacy')}@example.test`, password: STRONG_PASSWORD, role: 'SITE_INCHARGE' });
    await User.updateOne({ _id: u._id }, { $set: { phone: '+91 91234-56780' } });
    assert.ok((await normalizeStoredPhones()) >= 1);
    assert.equal((await User.findById(u._id))!.phone, '+919123456780');
  });
});

describe('only the account owner sets the password', () => {
  test('the MD cannot set an in-charge password', async () => {
    const r = await api('POST', `/api/v1/users/in-charge/${ic.userId}/reset-password`, { token: md.token, body: { newPassword: 'FromMD2026x' } });
    assert.equal(r.status, 404);
    await assert.rejects(login(ic.email, 'FromMD2026x'));
    assert.ok(await login(ic.email, STRONG_PASSWORD));
  });

  test('there is no forgot-password endpoint', async () => {
    for (const path of ['/api/v1/auth/password-reset/phone', '/api/v1/auth/password-reset/email/request']) {
      assert.equal((await api('POST', path, { body: { email: ic.email } })).status, 404, path);
    }
  });
});
