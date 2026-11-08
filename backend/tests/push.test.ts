/**
 * Phone / computer notifications (Web Push). A fake push service receives the
 * encrypted pushes; we decrypt them (RFC 8291 aes128gcm) like a browser would.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import {
  startTestServer,
  stopTestServer,
  api,
  registerMD,
  createProject,
  assignNewInCharge,
  tinyPng,
} from './helpers.js';

// ---------- a "browser": key pair + fake push service ----------
interface Device {
  endpoint: string;
  ecdh: crypto.ECDH;
  auth: Buffer;
  received: any[];
  respondWith: number;
}
const devices = new Map<string, Device>();
let pushServer: http.Server;
let pushBase = '';

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function decrypt(device: Device, body: Buffer): any {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const uaPublic = device.ecdh.getPublicKey();
  const ecdhSecret = device.ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, device.auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  const end = plain.lastIndexOf(2); // padding delimiter
  return JSON.parse(plain.subarray(0, end).toString('utf8'));
}

function newDevice(): Device {
  const id = crypto.randomBytes(6).toString('hex');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const d: Device = { endpoint: `${pushBase}/push/${id}`, ecdh, auth: crypto.randomBytes(16), received: [], respondWith: 201 };
  devices.set(id, d);
  return d;
}
const subscription = (d: Device) => ({ endpoint: d.endpoint, keys: { p256dh: b64url(d.ecdh.getPublicKey()), auth: b64url(d.auth) } });

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
  return true;
}

let md: { token: string; userId: string };
let ic: { token: string; userId: string };
let project: any;
let mdPhone: Device;
let icPhone: Device;

before(async () => {
  pushServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const d = devices.get(String(req.url).split('/').pop()!);
      if (!d) {
        res.writeHead(404).end();
        return;
      }
      const ok =
        /^vapid t=.+, k=.+/.test(String(req.headers.authorization)) && req.headers['content-encoding'] === 'aes128gcm' && Number(req.headers.ttl) > 0;
      if (ok && d.respondWith < 300) d.received.push(decrypt(d, Buffer.concat(chunks)));
      res.writeHead(ok ? d.respondWith : 400).end();
    });
  });
  await new Promise<void>((r) => pushServer.listen(0, '127.0.0.1', () => r()));
  pushBase = `http://127.0.0.1:${(pushServer.address() as AddressInfo).port}`;

  await startTestServer();
  md = await registerMD('PushMD');
  project = await createProject(md.token, 'PushSite');
  ic = await assignNewInCharge(md.token, project._id, 'Suresh');
  mdPhone = newDevice();
  icPhone = newDevice();
});

after(async () => {
  await stopTestServer();
  await new Promise<void>((r) => pushServer.close(() => r()));
});

describe('turning notifications on', () => {
  test('public key is stable across calls', async () => {
    const a = await api('GET', '/api/v1/push/public-key', { token: md.token });
    const b = await api('GET', '/api/v1/push/public-key', { token: ic.token });
    assert.equal(a.status, 200);
    assert.ok(a.body.publicKey.length > 60);
    assert.equal(a.body.publicKey, b.body.publicKey);
    assert.equal((await api('GET', '/api/v1/push/public-key')).status, 401);
  });

  test('only real push services and well-formed keys are accepted', async () => {
    const good = subscription(newDevice());
    for (const endpoint of ['https://evil.example.com/x', 'http://127.0.0.2:80/x', 'https://fcm.googleapis.com.evil.com/x', 'file:///etc/passwd']) {
      const r = await api('POST', '/api/v1/push/subscribe', { token: md.token, body: { subscription: { ...good, endpoint } } });
      assert.equal(r.status, 400, endpoint);
    }
    const badKeys = await api('POST', '/api/v1/push/subscribe', {
      token: md.token,
      body: { subscription: { endpoint: good.endpoint, keys: { p256dh: 'x', auth: 'y' } } },
    });
    assert.equal(badKeys.status, 400);
  });

  test('both phones subscribe', async () => {
    assert.equal((await api('POST', '/api/v1/push/subscribe', { token: md.token, body: { subscription: subscription(mdPhone) } })).status, 200);
    assert.equal((await api('POST', '/api/v1/push/subscribe', { token: ic.token, body: { subscription: subscription(icPhone) } })).status, 200);
  });

  test('test notification reaches the device', async () => {
    const r = await api('POST', '/api/v1/push/test', { token: md.token, body: {} });
    assert.equal(r.body.sent, 1);
    assert.ok(await waitFor(() => mdPhone.received.length === 1));
    assert.match(mdPhone.received[0].title, /notifications are on/);
    mdPhone.received.length = 0;
  });
});

describe('instant notifications', () => {
  test('MD sends a chat message → the in-charge phone buzzes and opens the chat', async () => {
    const r = await api('POST', `/api/v1/projects/${project._id}/messages`, { token: md.token, body: { content: 'Concrete arrives at 7am' } });
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.body));
    assert.ok(await waitFor(() => icPhone.received.length >= 1), 'push received');
    const p = icPhone.received.pop();
    assert.match(p.body, /Concrete arrives at 7am/);
    assert.equal(p.url, `/messages/${project._id}`);
    assert.equal(p.tag, `chat-${project._id}`);
    assert.equal(mdPhone.received.length, 0, 'the sender does not get their own message');
  });

  test('in-charge chat message → MD phone', async () => {
    await api('POST', `/api/v1/projects/${project._id}/messages`, { token: ic.token, body: { content: 'Need 50 bags cement' } });
    assert.ok(await waitFor(() => mdPhone.received.length >= 1));
    assert.match(mdPhone.received.pop().body, /Need 50 bags cement/);
  });

  test('in-charge payment request → MD phone, opening that payment', async () => {
    const r = await api('POST', '/api/v1/payments/requests', {
      token: ic.token,
      body: { projectId: project._id, payeeKind: 'INCHARGE', amountRupees: 5000, purpose: 'Diesel for JCB' },
    });
    assert.equal(r.status, 201);
    assert.ok(await waitFor(() => mdPhone.received.length >= 1));
    const p = mdPhone.received.pop();
    assert.equal(p.url, `/payments?id=${r.body.payment._id}`);
    assert.match(p.title, /Payment Request/);
  });

  test('in-charge expense → MD phone (approvals); approval → in-charge phone', async () => {
    const form = new FormData();
    form.append('file', tinyPng(), 'bill.png');
    const up = await api('POST', '/api/v1/uploads/single', { token: ic.token, form });
    const exp = await api('POST', '/api/v1/expenses', {
      token: ic.token,
      body: { project: project._id, date: new Date().toISOString(), category: 'CONSTRUCTION_MATERIALS', description: 'Cement 50 bags', vendor: 'Sri Cements', amount: 18500, receiptUrl: up.body.fileUrl },
    });
    assert.equal(exp.status, 201, JSON.stringify(exp.body));
    assert.ok(await waitFor(() => mdPhone.received.length >= 1));
    const toMd = mdPhone.received.pop();
    assert.equal(toMd.url, '/approvals');
    assert.match(toMd.title, /₹18,500/);

    const id = exp.body.expense?._id || exp.body.data?._id;
    const ap = await api('POST', `/api/v1/expenses/${id}/approve`, { token: md.token, body: {} });
    assert.equal(ap.status, 200, JSON.stringify(ap.body));
    assert.ok(await waitFor(() => icPhone.received.length >= 1));
    const toIc = icPhone.received.pop();
    assert.match(toIc.title, /approved/i);
    assert.equal(toIc.url, '/expenses');
  });
});

describe('device housekeeping', () => {
  test('a phone used by a new person gets only the new person’s notifications', async () => {
    // The in-charge signs in on the MD's device
    await api('POST', '/api/v1/push/subscribe', { token: ic.token, body: { subscription: subscription(mdPhone) } });
    mdPhone.received.length = 0;
    await api('POST', `/api/v1/projects/${project._id}/messages`, { token: ic.token, body: { content: 'only for the MD' } });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(mdPhone.received.length, 0, 'the MD message is not pushed to a device now signed in as the in-charge');
    await api('POST', '/api/v1/push/subscribe', { token: md.token, body: { subscription: subscription(mdPhone) } });
  });

  test('unsubscribe stops notifications', async () => {
    await api('POST', '/api/v1/push/unsubscribe', { token: ic.token, body: { endpoint: icPhone.endpoint } });
    icPhone.received.length = 0;
    await api('POST', `/api/v1/projects/${project._id}/messages`, { token: md.token, body: { content: 'nobody should get this push' } });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(icPhone.received.length, 0);
  });

  test('an expired subscription (410 Gone) is removed automatically', async () => {
    mdPhone.respondWith = 410;
    const first = await api('POST', '/api/v1/push/test', { token: md.token, body: {} });
    assert.equal(first.body.sent, 0);
    mdPhone.respondWith = 201;
    const second = await api('POST', '/api/v1/push/test', { token: md.token, body: {} });
    assert.equal(second.body.sent, 0, 'removed after 410');
    assert.match(second.body.message, /No device/);
  });
});
