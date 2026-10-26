# SiteTrack — RazorpayX Corporate Payouts Onboarding & Integration Guide

This guide details the architecture, security safeguards, provider onboarding requirements, environment variables, transaction limits, fee structure, and step-by-step activation checklist for **RazorpayX Payouts** in SiteTrack.

---

## 1. Architecture & Safe Payment Workflow

SiteTrack implements a segregated, multi-stage financial lifecycle designed for construction cash flows:

```
+---------------------------------------------------------------------------------------------------+
|                                       SiteTrack Application                                       |
+---------------------------------------------------------------------------------------------------+
|  1. Expense Register           2. Beneficiary Management   3. Payment Request & Review            |
|  - Records site expenses       - Contractors, Suppliers    - Linked to Project & Expense          |
|  - NO automatic fund debit     - Masked account display    - High-Value Rule (> ₹1,00,000)         |
|  - Preserves site receipts     - RazorpayX Contact & FA    - Strict Dual-Authorization            |
|                                - Automated Penny-Drop      - Creator CANNOT self-approve          |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                               RazorpayX Payouts Engine Service                                    |
|                                    (razorpayXService.ts)                                          |
+---------------------------------------------------------------------------------------------------+
|  - Contact Provisioning: POST /v1/contacts                                                        |
|  - Fund Account Creation: POST /v1/fund_accounts                                                  |
|  - Penny Drop Account Validation: POST /v1/fund_accounts/validations                              |
|  - Payout Initiation: POST /v1/payouts with X-Payout-Idempotency header                           |
|  - Status Inquiry & Reconciliation: GET /v1/payouts/{id}                                          |
|  - Webhook HMAC-SHA256 Raw-Body Verification: X-Razorpay-Signature                                |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                      Security Safeguards                                          |
|  - Killswitch: PAYMENTS_LIVE_ENABLED=false keeps transactions in safe sandbox simulation          |
|  - Dual-Authorization Enforcement: High-value creator cannot approve their own payment            |
|  - Never retry in-flight/unknown transfers without prior provider status reconciliation           |
|  - Webhook deduplication with unique event IDs                                                    |
|  - Immutable beneficiary snapshot sealed at payment creation                                      |
|  - Integer paise storage across models, controllers, and APIs                                     |
|  - Zero storage of bank logins, OTPs, PINs, or raw card security credentials                      |
|  - Historical records preserved: legacy provider payments remain untouched and non-executable     |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. RazorpayX Payout Lifecycle & Status Mapping

SiteTrack maps RazorpayX Payout lifecycle events directly into internal states:

| SiteTrack Internal Status | RazorpayX API Status | Description |
| :--- | :--- | :--- |
| `DRAFT` | *Local* | Payment created (under ₹1,00,000) and ready for dispatch. |
| `AWAITING_AUTHORIZATION` | *Local* | Transaction exceeds ₹1,00,000. Locked until independent MD authorizes. |
| `AUTHORIZED` | *Local* | Authorized by an independent MD (different from creator). Ready for transfer. |
| `SUBMITTED` | `queued` / `pending` | Dispatched to RazorpayX API; queued for banking rails processing. |
| `PROCESSING` | `initiated` / `processing`| Transmitted into RBI clearing cycle (NEFT / RTGS). |
| `PAID` | `processed` / `paid` | Successfully settled into beneficiary's account. UTR captured. Linked expense marked `PAID`. |
| `REVERSED` | `reversed` | Returned by recipient bank (e.g., account frozen, invalid branch). Linked expense reopened to `UNPAID`. |
| `FAILED` | `rejected` / `cancelled` / `failed` | Rejected by clearing network or insufficient business balance. |
| `UNKNOWN` | *Network Timeout / Gateway Error* | Indeterminate outcome. System strictly blocks blind retries until reconciled. |

---

## 3. High-Value Authorization & Dual Control Policy

To prevent corporate fraud and satisfy internal financial audit controls:
1. **Threshold:** Any payment request where `amountPaise > 10000000` (₹1,00,000) automatically enters `AWAITING_AUTHORIZATION`.
2. **Dual-Authorization Rule:** The user who created the payment request **cannot approve their own high-value disbursement**, even if they are a Managing Director (`payment.createdBy !== req.user.userId`).
3. **Transition to Authorized:** An independent Managing Director must review the beneficiary details, invoice snapshot, and amount, then submit authorization, which transitions the status to `AUTHORIZED`.
4. **Initiation:** Only an authorized payment (or a sub-threshold draft) can be dispatched to RazorpayX.

---

## 4. RazorpayX Onboarding Prerequisites & KYC Checklist

Before enabling live payouts, execute the following corporate onboarding steps with Razorpay:

| Step | Requirement | Purpose |
| :--- | :--- | :--- |
| **1. Entity Registration** | Certificate of Incorporation (CIN), MOA & AOA | Corporate entity verification |
| **2. Tax Compliance** | Company PAN & GSTIN Certificate | Statutory verification & invoice compliance |
| **3. Bank Mandate** | Board Resolution on Company Letterhead | Designates authorized directors for banking payouts |
| **4. Current Account** | RBL, ICICI, or Yes Bank Current Account | Primary corporate funding account linked to RazorpayX |
| **5. IP Whitelisting** | Static production server egress IP addresses | Restricts API access exclusively to approved infrastructure |
| **6. Webhook Endpoint** | HTTPS callback URL with SSL/TLS | Receives real-time asynchronous settlement notifications |

---

## 5. Server-Side Environment Variables & Secrets

All credentials **must remain server-side** in protected environment variables. Never expose these in frontend code, client bundles, or public repositories.

In `backend/.env`:

```env
# ==============================================================================
# PAYMENTS ENGINE CONFIGURATION
# ==============================================================================

# Active Provider: RAZORPAYX (Exclusive active provider)
PAYMENTS_PROVIDER=razorpayx

# SAFETY KILLSWITCH: Keep 'false' until onboarding, credentials, and IP whitelisting are verified.
# When 'false', the application runs in a safe, deterministic test simulation.
PAYMENTS_LIVE_ENABLED=false

# High-Value Dual-Authorization Threshold in integer Paise (₹1,00,000 = 10,000,000 paise)
PAYMENT_HIGH_VALUE_THRESHOLD_PAISE=10000000

# Webhook Secret configured in the RazorpayX Dashboard for HMAC-SHA256 verification
RAZORPAYX_WEBHOOK_SECRET=your_razorpayx_webhook_secret_here

# ------------------------------------------------------------------------------
# RazorpayX API Credentials
# ------------------------------------------------------------------------------
RAZORPAYX_KEY_ID=rzp_live_xxxxxxxxxxxxxxxx
RAZORPAYX_KEY_SECRET=your_razorpayx_key_secret_here
RAZORPAYX_ACCOUNT_NUMBER=787878xxxxxxxxxx
```

---

## 6. Transaction Limits & RBI Regulatory Rules

1. **NEFT (National Electronic Funds Transfer):**
   - **Minimum Amount:** ₹1 (100 paise).
   - **Maximum Amount:** Per corporate limit assigned by banking partner.
   - **Operating Hours:** Available 24x7x365 in batch settlements.

2. **RTGS (Real Time Gross Settlement):**
   - **Minimum Amount:** **₹2,00,000** (20,000,000 paise) per Reserve Bank of India (RBI) regulations.
   - **Enforcement:** SiteTrack UI and API strictly reject RTGS requests under ₹2,00,000 and enforce NEFT selection.
   - **Settlement:** Continuous, real-time gross settlement directly across RBI books.

3. **Penny Drop Validation:**
   - Initiates a ₹1 (100 paise) credit to verify account existence and registered account holder name.
   - Validates that the account is active before high-value payouts are initiated.

---

## 7. Commercial Fee Structure (Estimated)

| Service | Estimated Rate | Billing Model |
| :--- | :--- | :--- |
| **Penny Drop Account Verification** | ₹1.50 – ₹2.50 + GST | Per verification attempt |
| **NEFT Payout** | ₹2.50 – ₹4.00 + GST | Per successful transfer |
| **RTGS Payout** | ₹15.00 – ₹25.00 + GST | Per successful transfer |
| **Virtual Account / Fund Account** | Included | Standard RazorpayX account feature |

---

## 8. Webhook Configuration in RazorpayX Dashboard

1. Navigate to **RazorpayX Dashboard → Settings → Webhooks**.
2. Click **Add New Webhook**.
3. **Webhook URL:** `https://<your-sitetrack-domain>/api/v1/payments/webhook`
4. **Secret:** Generate a cryptographically secure random string (e.g., `openssl rand -hex 24`) and save in `RAZORPAYX_WEBHOOK_SECRET`.
5. **Subscribed Events:**
   - `payout.queued`
   - `payout.initiated`
   - `payout.processed`
   - `payout.reversed`
   - `payout.rejected`
   - `payout.failed`
6. Click **Save Webhook**.

---

## 9. Historical Legacy Records Preservation

SiteTrack strictly protects all historical payment records:
- Historical records created under previous providers (`providerName: 'SANDBOX_CORPORATE_PAYOUT'` or legacy providers) are preserved intact with their original transaction IDs, UTRs, and statuses.
- Legacy records are visibly badged in the UI as `Historical Record (<Provider>)` to distinguish them from active `RazorpayX Payout` transactions.
- Legacy records **cannot be re-executed** through RazorpayX, preventing unintended duplicate debits.

---

## 10. Step-by-Step Production Go-Live Checklist

- [ ] **Step 1:** Finalize KYC and activate the primary corporate current account on RazorpayX.
- [ ] **Step 2:** Generate Live API Key ID and Key Secret from **Settings → API Keys**.
- [ ] **Step 3:** Whitelist production server IP addresses in the RazorpayX security settings.
- [ ] **Step 4:** Set up the Webhook URL and secret in the RazorpayX Dashboard.
- [ ] **Step 5:** Configure production environment variables in the server environment:
  - `RAZORPAYX_KEY_ID`
  - `RAZORPAYX_KEY_SECRET`
  - `RAZORPAYX_ACCOUNT_NUMBER`
  - `RAZORPAYX_WEBHOOK_SECRET`
- [ ] **Step 6:** Run a test ₹1 penny drop validation for a known vendor account.
- [ ] **Step 7:** Run a test ₹100 NEFT payout in staging/production to confirm end-to-end receipt.
- [ ] **Step 8:** Set `PAYMENTS_LIVE_ENABLED=true` in production environment variables.
- [ ] **Step 9:** Monitor the Payments audit log and RazorpayX Dashboard for real-time settlements!
