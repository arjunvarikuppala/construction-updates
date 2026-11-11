/**
 * Chat history paging (scroll back through the whole conversation), jumping to an old
 * message, and phone-made preview images (photo thumbnails / video posters).
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge } from './helpers.js';

let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let ic: { token: string; userId: string };
let project: any;

const base = (pid: string) => `/api/v1/projects/${pid}/messages`;
const TOTAL = 60;
const sentIds: string[] = [];

/** Minimal JPEG (SOI marker) — enough for content inspection. */
function jpegBlob(size = 256): Blob {
  const bytes = Buffer.alloc(size);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(bytes, 0);
  return new Blob([bytes], { type: 'image/jpeg' });
}

before(async () => {
  await startTestServer();
  md = await registerMD('HistoryMD');
  otherMd = await registerMD('HistoryOtherMD');
  project = await createProject(md.token, 'History');
  ic = await assignNewInCharge(md.token, project._id, 'Suresh');
  for (let i = 0; i < TOTAL; i++) {
    const token = i % 2 === 0 ? md.token : ic.token;
    const r = await api('POST', base(project._id), { token, body: { content: `Site update #${i}` } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    sentIds.push(r.body.data._id);
  }
});

after(async () => {
  await stopTestServer();
});

describe('history paging', () => {
  test('first page holds the latest messages, in order, and says more exist', async () => {
    const r = await api('GET', `${base(project._id)}?limit=25`, { token: md.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.messages.length, 25);
    assert.equal(r.body.hasMore, true);
    assert.deepEqual(
      r.body.messages.map((m: any) => m._id),
      sentIds.slice(TOTAL - 25)
    );
  });

  test('paging back with the cursor returns every message exactly once', async () => {
    let page = await api('GET', `${base(project._id)}?limit=25`, { token: ic.token });
    const seen: string[] = page.body.messages.map((m: any) => m._id);
    let guard = 0;
    while (page.body.hasMore && guard++ < 10) {
      const oldest = page.body.messages[0];
      const q = new URLSearchParams({ before: oldest.createdAt, beforeId: oldest._id, limit: '25' });
      page = await api('GET', `${base(project._id)}?${q}`, { token: ic.token });
      assert.equal(page.status, 200);
      seen.unshift(...page.body.messages.map((m: any) => m._id));
    }
    assert.equal(page.body.hasMore, false);
    assert.deepEqual(seen, sentIds);
  });

  test('untilId loads everything back to an old message in one request', async () => {
    const latest = await api('GET', `${base(project._id)}?limit=10`, { token: md.token });
    const oldest = latest.body.messages[0];
    const target = sentIds[5];
    const q = new URLSearchParams({ before: oldest.createdAt, beforeId: oldest._id, untilId: target });
    const r = await api('GET', `${base(project._id)}?${q}`, { token: md.token });
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.messages.map((m: any) => m._id),
      sentIds.slice(5, TOTAL - 10)
    );
    assert.equal(r.body.hasMore, true);
  });

  test('another company cannot page through the history', async () => {
    const r = await api('GET', `${base(project._id)}?limit=5`, { token: otherMd.token });
    assert.equal(r.status, 403);
  });
});

describe('preview images', () => {
  async function uploadWithThumb(token: string, thumb?: Blob) {
    const form = new FormData();
    form.append('files', jpegBlob(4096), 'slab.jpg');
    if (thumb) form.append('thumb', thumb, 'preview.jpg');
    return api('POST', `${base(project._id)}/upload`, { token, form });
  }

  test('a photo uploaded with a preview gets a thumbnail the other party can open', async () => {
    const up = await uploadWithThumb(ic.token, jpegBlob());
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const att = up.body.attachments[0];
    assert.ok(att.thumbnailUrl, 'thumbnail URL returned');
    assert.notEqual(att.thumbnailUrl, att.url);

    const sent = await api('POST', base(project._id), {
      token: ic.token,
      body: { attachments: [{ ...att, width: 1920, height: 1080 }] },
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const stored = sent.body.data.attachments[0];
    assert.equal(stored.thumbnailUrl, att.thumbnailUrl);
    assert.equal(stored.width, 1920);
    assert.equal(stored.height, 1080);

    // MD (did not upload it) may sign the preview because it belongs to a project message
    const signed = await api('POST', '/api/v1/files/sign', { token: md.token, body: { urls: [att.thumbnailUrl] } });
    assert.equal(signed.status, 200);
    assert.ok(signed.body.signed[att.thumbnailUrl], 'MD can open the preview');

    // Another company cannot
    const denied = await api('POST', '/api/v1/files/sign', { token: otherMd.token, body: { urls: [att.thumbnailUrl] } });
    assert.equal(denied.body.signed[att.thumbnailUrl], null);
  });

  test('a preview that is not an image is dropped, the photo still uploads', async () => {
    const notImage = new Blob([Buffer.from('this is not a picture at all')], { type: 'image/jpeg' });
    const up = await uploadWithThumb(ic.token, notImage);
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.ok(up.body.attachments[0].url);
    assert.equal(up.body.attachments[0].thumbnailUrl, undefined);
  });

  test("someone else's file cannot be passed off as a message preview", async () => {
    const mine = await uploadWithThumb(md.token, jpegBlob());
    const sent = await api('POST', base(project._id), {
      token: md.token,
      body: {
        attachments: [{ ...mine.body.attachments[0], thumbnailUrl: '/uploads/not-mine.jpg' }],
      },
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.data.attachments[0].thumbnailUrl, undefined);
  });
});

describe('shared media gallery', () => {
  test('lists photos shared in the chat, newest first, page by page', async () => {
    const first = await api('GET', `${base(project._id)}/gallery?type=media&limit=1`, { token: md.token });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.items.length, 1);
    assert.equal(first.body.items[0].attachment.type, 'image');
    assert.ok(first.body.items[0].messageId);
    assert.ok(first.body.items[0].sender?.name);
    assert.equal(first.body.hasMore, true);

    const q = new URLSearchParams({ type: 'media', limit: '50', ...first.body.nextCursor });
    const rest = await api('GET', `${base(project._id)}/gallery?${q}`, { token: md.token });
    assert.equal(rest.status, 200);
    assert.ok(rest.body.items.length >= 1);
    assert.ok(!rest.body.items.some((i: any) => i.messageId === first.body.items[0].messageId));
    const times = [...first.body.items, ...rest.body.items].map((i: any) => new Date(i.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  });

  test('documents and voice tabs only contain their own kind', async () => {
    const docs = await api('GET', `${base(project._id)}/gallery?type=docs`, { token: ic.token });
    assert.equal(docs.status, 200);
    assert.ok(docs.body.items.every((i: any) => ['document', 'pdf'].includes(i.attachment.type)));
    const voice = await api('GET', `${base(project._id)}/gallery?type=voice`, { token: ic.token });
    assert.ok(voice.body.items.every((i: any) => i.attachment.type === 'audio'));
  });

  test('another company cannot see the gallery', async () => {
    const r = await api('GET', `${base(project._id)}/gallery?type=media`, { token: otherMd.token });
    assert.equal(r.status, 403);
  });
});
