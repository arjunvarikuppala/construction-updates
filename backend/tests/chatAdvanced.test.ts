/**
 * Advanced project chat between MD and Site In-Charge:
 * edit, delete for everyone, reactions, pins, search and voice notes,
 * plus the permission and company-isolation rules around each.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge } from './helpers.js';

let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let ic: { token: string; userId: string };
let project: any;
let otherProject: any;

const base = (pid: string) => `/api/v1/projects/${pid}/messages`;
const send = (token: string, pid: string, body: any) => api('POST', base(pid), { token, body });

/** Minimal WebM (EBML header) — enough for content inspection. */
function webmVoiceBlob(): Blob {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(bytes, 0);
  return new Blob([bytes], { type: 'audio/webm;codecs=opus' });
}

before(async () => {
  await startTestServer();
  md = await registerMD('AdvChatMD');
  otherMd = await registerMD('AdvOtherMD');
  project = await createProject(md.token, 'AdvChat');
  otherProject = await createProject(otherMd.token, 'AdvOther');
  ic = await assignNewInCharge(md.token, project._id, 'Ravi');
});

after(async () => {
  await stopTestServer();
});

describe('edit and delete for everyone', () => {
  let msgId: string;

  test('sender edits their message; it is marked edited', async () => {
    const r = await send(md.token, project._id, { content: 'Pour slab on Monday' });
    assert.equal(r.status, 201);
    msgId = r.body.data._id;

    const e = await api('PATCH', `${base(project._id)}/${msgId}`, { token: md.token, body: { content: 'Pour slab on Tuesday' } });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.equal(e.body.data.content, 'Pour slab on Tuesday');
    assert.ok(e.body.data.editedAt);
  });

  test('the other party cannot edit or delete it', async () => {
    const e = await api('PATCH', `${base(project._id)}/${msgId}`, { token: ic.token, body: { content: 'hacked' } });
    assert.equal(e.status, 403);
    const d = await api('DELETE', `${base(project._id)}/${msgId}`, { token: ic.token });
    assert.equal(d.status, 403);
  });

  test('sender deletes for everyone; a tombstone remains', async () => {
    const d = await api('DELETE', `${base(project._id)}/${msgId}`, { token: md.token });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.ok(d.body.data.deletedAt);
    assert.equal(d.body.data.content, '');

    const list = await api('GET', base(project._id), { token: ic.token });
    const m = list.body.messages.find((x: any) => x._id === msgId);
    assert.ok(m?.deletedAt);
    assert.equal(m.content, '');

    const e = await api('PATCH', `${base(project._id)}/${msgId}`, { token: md.token, body: { content: 'again' } });
    assert.equal(e.status, 400);
  });
});

describe('reactions, pins and search', () => {
  let msgId: string;

  test('in-charge reacts; same emoji toggles off, another replaces it', async () => {
    const r = await send(md.token, project._id, { content: 'Cement delivery confirmed for site B' });
    msgId = r.body.data._id;

    let x = await api('POST', `${base(project._id)}/${msgId}/reactions`, { token: ic.token, body: { emoji: '👍' } });
    assert.equal(x.status, 200, JSON.stringify(x.body));
    assert.equal(x.body.data.reactions.length, 1);

    x = await api('POST', `${base(project._id)}/${msgId}/reactions`, { token: ic.token, body: { emoji: '✅' } });
    assert.equal(x.body.data.reactions.length, 1);
    assert.equal(x.body.data.reactions[0].emoji, '✅');

    x = await api('POST', `${base(project._id)}/${msgId}/reactions`, { token: ic.token, body: { emoji: '✅' } });
    assert.equal(x.body.data.reactions.length, 0);

    x = await api('POST', `${base(project._id)}/${msgId}/reactions`, { token: ic.token, body: { emoji: '<script>' } });
    assert.equal(x.status, 400);
  });

  test('either party pins; pinned list shows it; unpin removes it', async () => {
    let p = await api('PUT', `${base(project._id)}/${msgId}/pin`, { token: ic.token, body: { pinned: true } });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.ok(p.body.data.pinnedAt);

    let list = await api('GET', `${base(project._id)}/pinned`, { token: md.token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.messages.map((m: any) => m._id), [msgId]);

    p = await api('PUT', `${base(project._id)}/${msgId}/pin`, { token: md.token, body: { pinned: false } });
    assert.equal(p.status, 200);
    list = await api('GET', `${base(project._id)}/pinned`, { token: md.token });
    assert.equal(list.body.messages.length, 0);
  });

  test('search finds messages by text (regex characters are literal)', async () => {
    const s = await api('GET', `${base(project._id)}/search?q=${encodeURIComponent('cement')}`, { token: ic.token });
    assert.equal(s.status, 200);
    assert.ok(s.body.messages.some((m: any) => m._id === msgId));

    const weird = await api('GET', `${base(project._id)}/search?q=${encodeURIComponent('.*(')}`, { token: ic.token });
    assert.equal(weird.status, 200);
    assert.equal(weird.body.messages.length, 0);
  });

  test('another company cannot react, pin, search or see pins', async () => {
    const r = await api('POST', `${base(project._id)}/${msgId}/reactions`, { token: otherMd.token, body: { emoji: '👍' } });
    assert.equal(r.status, 403);
    const p = await api('PUT', `${base(project._id)}/${msgId}/pin`, { token: otherMd.token, body: { pinned: true } });
    assert.equal(p.status, 403);
    const s = await api('GET', `${base(project._id)}/search?q=cement`, { token: otherMd.token });
    assert.equal(s.status, 403);
    // Message id from project A addressed through the other company's own project
    const cross = await api('POST', `${base(otherProject._id)}/${msgId}/reactions`, { token: otherMd.token, body: { emoji: '👍' } });
    assert.equal(cross.status, 404);
  });
});

describe('voice notes', () => {
  test('in-charge uploads and sends a voice note; MD receives it as audio', async () => {
    const form = new FormData();
    form.append('files', webmVoiceBlob(), 'voice-note.webm');
    const up = await api('POST', `${base(project._id)}/upload`, { token: ic.token, form });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const att = up.body.attachments[0];
    assert.equal(att.type, 'audio');
    assert.equal(att.mimeType, 'audio/webm');

    const r = await send(ic.token, project._id, { attachments: [{ ...att, duration: 7.4 }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.attachments[0].type, 'audio');
    assert.equal(r.body.data.attachments[0].duration, 7);

    const voice = await api('GET', `${base(project._id)}/search?type=voice`, { token: md.token });
    assert.equal(voice.body.messages.length, 1);
  });

  test('audio is not accepted by non-chat upload endpoints', async () => {
    const form = new FormData();
    form.append('file', webmVoiceBlob(), 'voice-note.webm');
    const up = await api('POST', '/api/v1/uploads/single', { token: ic.token, form });
    assert.notEqual(up.status, 200);
  });
});
