/**
 * GST on purchase bills: GSTIN validation, CGST/SGST vs IGST split, server-computed
 * totals on standalone and report expenses, company settings and the monthly register.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, api, registerMD, createProject, assignNewInCharge } from './helpers.js';
import { isValidGstin, computeGst } from '../src/services/gstService.js';

// Valid checksums (generated with the official mod-36 algorithm)
const COMPANY_TS = '36AAACB1234K1ZZ'; // Telangana (36)
const VENDOR_TS = '36AABCU9603R1ZO'; // Telangana (36) → CGST + SGST
const VENDOR_MH = '27AAPFU0939F1ZV'; // Maharashtra (27) → IGST

let md: { token: string; userId: string };
let otherMd: { token: string; userId: string };
let project: any;
let ic: { token: string; userId: string };
const month = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString();

before(async () => {
  await startTestServer();
  md = await registerMD('GstMD');
  otherMd = await registerMD('OtherGstMD');
  project = await createProject(md.token, 'GstSite');
  ic = await assignNewInCharge(md.token, project._id, 'Srinu');
});

after(async () => {
  await stopTestServer();
});

describe('GSTIN and GST maths', () => {
  test('GSTIN checksum validation', () => {
    assert.equal(isValidGstin(COMPANY_TS), true);
    assert.equal(isValidGstin(VENDOR_MH), true);
    assert.equal(isValidGstin('27AAPFU0939F1ZX'), false, 'wrong check digit');
    assert.equal(isValidGstin('99AAPFU0939F1ZV'), false, 'unknown state');
    assert.equal(isValidGstin('27AAPFU0939F1Z'), false, 'too short');
    assert.equal(isValidGstin(12345), false);
  });

  test('same state → CGST + SGST, other state → IGST', () => {
    const intra = computeGst(1000000, 18, VENDOR_TS, COMPANY_TS); // ₹10,000 @ 18%
    assert.deepEqual([intra.cgstPaise, intra.sgstPaise, intra.igstPaise, intra.totalPaise], [90000, 90000, 0, 1180000]);
    const inter = computeGst(1000000, 18, VENDOR_MH, COMPANY_TS);
    assert.deepEqual([inter.cgstPaise, inter.sgstPaise, inter.igstPaise, inter.interState], [0, 0, 180000, true]);
    const odd = computeGst(101, 5, VENDOR_TS, COMPANY_TS); // 5.05 paise of GST rounds to 5 → 2 + 3
    assert.equal(odd.cgstPaise + odd.sgstPaise, 5);
  });
});

describe('company settings', () => {
  test('only the MD can set the GSTIN; invalid GSTIN rejected', async () => {
    const bad = await api('PUT', '/api/v1/company-settings', { token: md.token, body: { gstin: '36AAACB1234K1ZA' } });
    assert.equal(bad.status, 400);
    const byIc = await api('PUT', '/api/v1/company-settings', { token: ic.token, body: { gstin: COMPANY_TS } });
    assert.equal(byIc.status, 403);
    const ok = await api('PUT', '/api/v1/company-settings', {
      token: md.token,
      body: { legalName: 'BKR INFRA PRIVATE LIMITED', gstin: COMPANY_TS.toLowerCase(), address: 'Hyderabad' },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.settings.gstin, COMPANY_TS);
    assert.equal(ok.body.settings.stateCode, '36');
  });

  test("in-charge reads their MD's settings; another company does not see them", async () => {
    const forIc = await api('GET', '/api/v1/company-settings', { token: ic.token });
    assert.equal(forIc.body.settings.gstin, COMPANY_TS);
    const forOther = await api('GET', '/api/v1/company-settings', { token: otherMd.token });
    assert.equal(forOther.body.settings.gstin, '');
  });
});

describe('GST bills', () => {
  test('standalone GST expense: total computed on the server (client amount ignored)', async () => {
    const r = await api('POST', '/api/v1/expenses', {
      token: ic.token,
      body: {
        project: project._id,
        date: today,
        category: 'CONSTRUCTION_MATERIALS',
        description: 'Cement 100 bags',
        vendor: 'Sri Cement Traders',
        amount: 1, // tampered
        gst: { isGstBill: true, vendorGstin: VENDOR_TS, invoiceNumber: 'SCT/2026/118', invoiceDate: today, taxable: 38000, ratePercent: 28 },
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const e = r.body.expense;
    assert.equal(e.amount, 4864000); // ₹38,000 + 28% = ₹48,640
    assert.equal(e.gst.cgstPaise, 532000);
    assert.equal(e.gst.sgstPaise, 532000);
    assert.equal(e.gst.igstPaise, 0);
  });

  test('invalid GST details are rejected', async () => {
    const r = await api('POST', '/api/v1/expenses', {
      token: ic.token,
      body: {
        project: project._id,
        date: today,
        category: 'CONSTRUCTION_MATERIALS',
        description: 'Steel',
        vendor: 'X',
        amount: 100,
        gst: { isGstBill: true, vendorGstin: 'NOTAGSTIN', invoiceNumber: '', taxable: 100, ratePercent: 7 },
      },
    });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.length >= 3);
  });

  test('report bill from another state gets IGST; cash bill stays without GST', async () => {
    const r = await api('POST', '/api/v1/daily-reports', {
      token: ic.token,
      body: {
        project: project._id,
        titleOfWork: 'Steel delivery',
        workDate: today,
        workSummary: 'Unloaded TMT',
        status: 'DRAFT',
        expenses: [
          {
            category: 'CONSTRUCTION_MATERIALS',
            description: 'TMT 12mm',
            vendor: 'Mumbai Steels',
            gst: { isGstBill: true, vendorGstin: VENDOR_MH, invoiceNumber: 'MS-77', invoiceDate: today, taxable: 50000, ratePercent: 18 },
          },
          { category: 'FOOD_AND_ACCOMMODATION', description: 'Tea', amount: 300 },
        ],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const detail = await api('GET', `/api/v1/daily-reports/${r.body.report._id}`, { token: ic.token });
    const bills = detail.body.report.expenses || detail.body.expenses;
    const steel = bills.find((b: any) => b.description === 'TMT 12mm');
    const tea = bills.find((b: any) => b.description === 'Tea');
    assert.equal(steel.amount, 5900000);
    assert.equal(steel.gst.igstPaise, 900000);
    assert.equal(steel.gst.interState, true);
    assert.equal(tea.gst, undefined);
  });

  test('monthly GST register: MD only, Excel of own bills', async () => {
    const byIc = await api('GET', `/api/v1/export/gst-register?month=${month}`, { token: ic.token });
    assert.equal(byIc.status, 403);
    const bad = await api('GET', '/api/v1/export/gst-register?month=2026-13', { token: md.token });
    assert.equal(bad.status, 400);
    const ok = await api('GET', `/api/v1/export/gst-register?month=${month}`, { token: md.token });
    assert.equal(ok.status, 200);
    assert.match(String(ok.headers.get('content-type')), /spreadsheetml/);
    assert.match(String(ok.headers.get('content-disposition')), /GST-Register/);
  });
});
