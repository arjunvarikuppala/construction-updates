# SiteTrack Corporate Banking & Payouts Onboarding Guide

This document details the architecture, security safeguards, provider onboarding requirements, credentials, transaction limits, fees, and verification checklist for the **Contractor, Supplier, and Labour Payment Module** in SiteTrack.

---

## 1. Architecture Overview

SiteTrack implements a decoupled, event-driven payment architecture designed specifically for construction cash flows:

```
+---------------------------------------------------------------------------------------------------+
|                                       SiteTrack Application                                       |
+---------------------------------------------------------------------------------------------------+
|  1. Expense Register           2. Beneficiary Book         3. Payment Request  & Review           |
|  - Records site expenses       - Contractors, Suppliers    - Linked to Project & Expense          |
|  - NO automatic fund debit     - Masked account storage    - High-Value Rule (> ₹1,00,000)         |
|  - Preserves site receipts     - Penny-Drop verification   - Independent MD Authorization         |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                  Provider Abstraction Layer                                       |
|                                     (IPaymentProvider)                                            |
+---------------------------------------------------------------------------------------------------+
|                 |                                                 |                               |
|                 v                                                 v                               v
|   [Mock Sandbox Provider]                         [RazorpayX Payouts]                 [ICICI CIB Host-to-Host]
|   - Deterministic test mode                       - Official REST API                 - Corporate PKI Encrypted
|   - Zero risk to real funds                       - Automated Penny Drop              - Direct Bank Ledger
|   - Instant settlement & UTR                      - Webhook HMAC-SHA256               - Host-to-Host API
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                      Security Safeguards                                          |
|   - Hard killswitch: PAYMENTS_LIVE_ENABLED=false until onboarding & security checks complete      |
|   - Idempotency keys prevent duplicate debits                                                     |
|   - Never retry in-flight/unknown payments without running bank reconciliation first              |
|   - Zero storage of bank logins, OTPs, PINs, or raw card data                                     |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Supported Corporate Banking & Payout Providers

### Option A: RazorpayX Corporate Payouts (Recommended for Fast Deployment)
- **Supported rails:** NEFT, RTGS, IMPS, UPI.
- **Beneficiary verification:** Real-time automated Penny Drop validation with registered account name matching.
- **Workflow:** Virtual Account / Current Account integration, automated webhooks, instant UTR generation.
- **Best for:** Rapid onboarding (1–3 business days), modern developer REST APIs, automated reconciliation.

### Option B: ICICI Bank Corporate Internet Banking (CIB) API
- **Supported rails:** NEFT, RTGS, Internal Book Transfer.
- **Beneficiary verification:** Account number & IFSC validation via ICICI Corporate Developer Portal.
- **Workflow:** Direct debit from primary Corporate Current Account using public-key cryptography (RSA-2048) and Digital Signatures (Class 3 DSC).
- **Best for:** Direct primary bank settlement without intermediary escrow/virtual accounts.

### Option C: Cashfree Corporate Payouts / Yes Bank
- **Supported rails:** NEFT, RTGS, IMPS.
- **Beneficiary verification:** Bank account verification API (penny drop).
- **Workflow:** Direct API dispatch with dual-approval support.

---

## 3. Bank Onboarding Prerequisites & KYC Checklist

Before enabling live payouts, the following corporate documentation must be approved by the banking partner:

| Item | Document Required | Purpose |
| :--- | :--- | :--- |
| **1. Entity KYC** | Certificate of Incorporation (CIN), MOA & AOA | Verifies legal status of the construction firm |
| **2. Tax Registration** | Company PAN Card & GSTIN Certificate | Statutory compliance & invoice reconciliation |
| **3. Bank Mandate** | Board Resolution on Company Letterhead | Authorizes electronic corporate payouts and designates authorized officers |
| **4. Signatory KYC** | PAN Card & Aadhaar of Managing Director / Directors | Individual identity verification for corporate officers |
| **5. Bank Account** | Cancelled Cheque / Bank Statement (last 3 months) | Links the primary funding current account |
| **6. DSC** | Class 3 Digital Signature Certificate (for Direct Bank APIs) | Signs outbound payment payloads cryptographically |

---

## 4. Server-Side Secret & Environment Variable Configuration

All payment gateway secrets **must remain server-side** in protected environment variables or a managed secret store (e.g., AWS Secrets Manager, HashiCorp Vault). Never check these keys into source code repositories.

In `backend/.env`:

```env
# ==============================================================================
# PAYMENTS CONFIGURATION
# ==============================================================================

# Active Provider: 'sandbox' | 'razorpayx' | 'icici'
PAYMENTS_PROVIDER=sandbox

# SAFETY KILLSWITCH: Must remain 'false' until bank KYC, credentials,
# and IP whitelisting are verified.
PAYMENTS_LIVE_ENABLED=false

# High-Value Authorization Threshold in integer Paise (₹1,00,000 = 10,000,000 paise)
PAYMENT_HIGH_VALUE_THRESHOLD_PAISE=10000000

# Webhook Verification Secret (used to verify HMAC-SHA256 signatures)
PAYMENTS_WEBHOOK_SECRET=your_production_webhook_secret_here

# ------------------------------------------------------------------------------
# Provider-Specific Credentials (e.g., RazorpayX)
# ------------------------------------------------------------------------------
RAZORPAYX_KEY_ID=rzp_live_xxxxxxxxxxxxxxxx
RAZORPAYX_KEY_SECRET=your_secret_key_here
RAZORPAYX_ACCOUNT_NUMBER=787878xxxxxx
```

---

## 5. Transaction Limits & RBI Regulatory Rules

1. **NEFT (National Electronic Funds Transfer):**
   - **Minimum Amount:** ₹1 (100 paise).
   - **Maximum Amount:** Determined by corporate banking limit.
   - **Operating Hours:** Available 24x7x365 in half-hourly settlement batches or real-time.

2. **RTGS (Real Time Gross Settlement):**
   - **Minimum Amount:** **₹2,00,000** (20,000,000 paise) per Reserve Bank of India (RBI) regulations.
   - **Enforcement:** SiteTrack automatically prevents RTGS requests under ₹2,00,000 and prompts the user to select NEFT.
   - **Settlement:** Continuous, real-time gross settlement by RBI.

3. **High-Value Authorization Rule:**
   - Any transaction exceeding **₹1,00,000** (configurable via `PAYMENT_HIGH_VALUE_THRESHOLD_PAISE`) is automatically placed into `AWAITING_AUTHORIZATION`.
   - Outbound bank transfer **cannot be triggered** until an authorized Managing Director explicitly approves the request in SiteTrack.

---

## 6. Provider Pricing & Fees (Standard Commercial Estimates)

| Service | Estimated Pricing | Billing Basis |
| :--- | :--- | :--- |
| **Penny Drop Account Verification** | ₹1.00 – ₹2.00 + GST | Per verification attempt |
| **NEFT Transfer** | ₹2.00 – ₹4.00 + GST | Per successful transfer |
| **RTGS Transfer** | ₹15.00 – ₹25.00 + GST | Per successful transfer |
| **API Account Maintenance** | ₹0 – ₹5,000 / month | Depends on bank plan |

---

## 7. Security Best Practices Enforced by SiteTrack

1. **Separation of Concerns:**
   - Entering an expense in the SiteTrack Expense Register records cost accounting data. It **never** triggers an automatic bank transfer.
   - Payments are discrete, audited requests that can be linked to approved expenses.

2. **Beneficiary Snapshot Integrity:**
   - At payment request creation, the beneficiary's name, masked account number, and IFSC are permanently captured in the `PaymentRequest` record. Future changes in the beneficiary address book do not alter in-flight or completed payment records.

3. **No-Blind-Retry Guard:**
   - If a bank request times out or returns an `UNKNOWN` status, SiteTrack strictly blocks re-submitting the transfer.
   - The user or scheduled reconciler must run **"Reconcile Bank Status"** to query the provider ledger before any further action is allowed.

4. **Webhook Security & Deduplication:**
   - Every webhook payload is verified using constant-time cryptographic HMAC-SHA256 signature checking.
   - Webhook event IDs are tracked in `WebhookEvent` with unique indexing. Duplicate deliveries from the bank return `HTTP 200` immediately without double-settling.

---

## 8. Step-by-Step Go-Live Checklist

- [ ] **Step 1:** Complete KYC and execute corporate banking agreements with the chosen payout partner (RazorpayX, ICICI, or Cashfree).
- [ ] **Step 2:** Generate production API Keys and assign outbound transaction debit limits with bank account managers.
- [ ] **Step 3:** Whitelist production server IP addresses in the bank's developer console.
- [ ] **Step 4:** Configure the webhook callback endpoint in the provider dashboard:
      `https://<your-domain>/api/v1/payments/webhook`
- [ ] **Step 5:** Save the production webhook signing secret into `PAYMENTS_WEBHOOK_SECRET`.
- [ ] **Step 6:** Run a ₹10 test penny drop and a ₹100 NEFT test transfer in staging.
- [ ] **Step 7:** Set `PAYMENTS_LIVE_ENABLED=true` and `PAYMENTS_PROVIDER=razorpayx` (or `icici`) in the production environment.
- [ ] **Step 8:** Begin disbursing approved contractor, supplier, and labour payments securely!
