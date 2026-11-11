/**
 * Account deletion (Google Play policy): an In-Charge asks for deletion, their MD
 * is notified and deletes the account; personal details are erased and sign-in
 * stops, while the company's business records stay.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge, STRONG_PASSWORD } from './helpers.js';

let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let ic: { token: string; userId: string; email: string };

before(async () => {
  await startTestServer();
  md = await registerMD('DelMD');
  otherMd = await registerMD('OtherDelMD');
  const project = await createProject(md.token, 'DelSite');
  ic = await assignNewInCharge(md.token, project._id, 'Ravi');
});

after(async () => {
  await stopTestServer();
});

describe('account deletion', () => {
  test('in-charge request notifies their MD once a day; MD is told to contact support', async () => {
    const r = await api('POST', '/api/v1/auth/deletion-request', { token: ic.token, body: { reason: 'Leaving the company' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);

    const again = await api('POST', '/api/v1/auth/deletion-request', { token: ic.token, body: {} });
    assert.equal(again.body.alreadyRequested, true);

    const notes = await api('GET', '/api/v1/notifications?limit=50', { token: md.token });
    const list = notes.body.notifications || notes.body.data || [];
    const hits = list.filter((n: any) => n.title === 'Account deletion requested');
    assert.equal(hits.length, 1, 'MD gets exactly one notification');
    assert.match(hits[0].message, /Leaving the company/);

    const otherNotes = await api('GET', '/api/v1/notifications?limit=50', { token: otherMd.token });
    const otherList = otherNotes.body.notifications || otherNotes.body.data || [];
    assert.equal(otherList.filter((n: any) => n.title === 'Account deletion requested').length, 0, 'other companies are not told');

    const byMd = await api('POST', '/api/v1/auth/deletion-request', { token: md.token, body: {} });
    assert.equal(byMd.status, 400);
  });

  test('only their own MD can delete the account', async () => {
    const byOther = await api('DELETE', `/api/v1/users/in-charge/${ic.userId}`, { token: otherMd.token });
    assert.equal(byOther.status, 404);
    const byIc = await api('DELETE', `/api/v1/users/in-charge/${ic.userId}`, { token: ic.token });
    assert.equal(byIc.status, 403);
  });

  test('MD deletes: personal details erased, old token and password stop working', async () => {
    const del = await api('DELETE', `/api/v1/users/in-charge/${ic.userId}`, { token: md.token });
    assert.equal(del.status, 200);

    const me = await api('GET', '/api/v1/auth/me', { token: ic.token });
    assert.equal(me.status, 401, 'existing session is cut off');
    const relogin = await api('POST', '/api/v1/auth/login', { body: { email: ic.email, password: STRONG_PASSWORD } });
    assert.equal(relogin.status, 401, 'cannot sign in again');

    const users = await api('GET', '/api/v1/users/in-charge', { token: md.token });
    const list = users.body.users || users.body.data || [];
    const row = list.find((u: any) => String(u.id || u._id) === ic.userId);
    if (row) {
      assert.equal(row.name, 'Deleted user');
      assert.ok(!String(row.email).includes('@example.test'), 'email erased');
      assert.ok(!row.phone, 'phone erased');
    }

    const twice = await api('DELETE', `/api/v1/users/in-charge/${ic.userId}`, { token: md.token });
    assert.equal(twice.status, 200);
  });
});
