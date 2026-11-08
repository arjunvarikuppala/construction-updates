/**
 * Test harness: boots the real Express app against an in-memory MongoDB and
 * talks to it over HTTP. Payments always run in RazorpayX simulation mode
 * (NODE_ENV=test forces mock mode) — no real payouts are ever attempted.
 */
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import crypto from 'crypto';

// Uploads are written relative to cwd; isolate them in a throwaway directory.
const originalCwd = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sitetrack-test-'));
process.chdir(tempRoot);

process.env.NODE_ENV = 'test';
process.env.SITETRACK_NO_LISTEN = 'true';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.RAZORPAYX_WEBHOOK_SECRET = 'test-webhook-secret-' + crypto.randomBytes(8).toString('hex');
process.env.PAYMENTS_LIVE_ENABLED = 'false';
process.env.RAZORPAYX_KEY_ID = '';
process.env.RAZORPAYX_KEY_SECRET = '';
process.env.LOGIN_RATE_LIMIT_MAX = '5';
process.env.REGISTER_RATE_LIMIT_MAX = '1000';
// The suite creates several companies to prove isolation
process.env.ALLOW_PUBLIC_REGISTRATION = 'true';
process.env.CORS_ORIGIN = '';

let server: http.Server | null = null;
let baseUrl = '';
let memoryServer: any = null;

export async function startTestServer(): Promise<string> {
  const mongoose = (await import('mongoose')).default;
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri());

  const { default: app } = await import('../src/server.js');
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  const mongoose = (await import('mongoose')).default;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  process.chdir(originalCwd);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

export interface ApiResult {
  status: number;
  body: any;
  headers: Headers;
}

export async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: any; form?: FormData; headers?: Record<string, string> } = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: any;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* binary or text body */
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

export async function rawGet(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

let counter = 0;
export function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export const STRONG_PASSWORD = 'SiteTrack2026';

export async function registerMD(name: string): Promise<{ token: string; userId: string; email: string }> {
  const email = `${uniq(name.toLowerCase())}@example.test`;
  const r = await api('POST', '/api/v1/auth/register', {
    body: { name, email, password: STRONG_PASSWORD },
  });
  if (r.status !== 201) throw new Error(`registerMD failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.token, userId: String(r.body.user.id), email };
}

export async function login(email: string, password = STRONG_PASSWORD): Promise<string> {
  const r = await api('POST', '/api/v1/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

export async function createProject(token: string, label: string, extra: Record<string, any> = {}) {
  const r = await api('POST', '/api/v1/projects', {
    token,
    body: {
      name: `${label} Tower`,
      code: uniq('PRJ').toUpperCase().slice(0, 14),
      location: 'Hyderabad',
      budget: 5000000, // ₹50,00,000
      status: 'IN_PROGRESS',
      startDate: new Date(Date.now() - 20 * 86400000).toISOString(),
      ...extra,
    },
  });
  if (r.status !== 201) throw new Error(`createProject failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.project;
}

export async function assignNewInCharge(mdToken: string, projectId: string, name: string) {
  const email = `${uniq(name.toLowerCase())}@example.test`;
  const r = await api('POST', `/api/v1/projects/${projectId}/assignments`, {
    token: mdToken,
    body: { newUser: { name, email, password: STRONG_PASSWORD } },
  });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`assignNewInCharge failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const token = await login(email);
  const me = await api('GET', '/api/v1/auth/me', { token });
  return { token, email, userId: String(me.body.user.id) };
}

/** 1x1 PNG */
export function tinyPng(): Blob {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' });
}

export function webhookSignature(rawBody: string): string {
  return crypto.createHmac('sha256', process.env.RAZORPAYX_WEBHOOK_SECRET!).update(rawBody).digest('hex');
}
