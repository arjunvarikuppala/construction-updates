# SiteTrack — Payment System, UPI/QR, Project Communication & Read Receipts Guide

## Executive Overview

SiteTrack has been extended with a secure, enterprise-grade financial and operational infrastructure:
1. **RazorpayX Payouts Engine**: Bank transfers (NEFT & RTGS) and UPI payouts to contractors, suppliers, and labour.
2. **Dual-Authorization Workflow**: Strict policy for high-value transactions (> ₹1,00,000 / 10,000,000 paise). The creator cannot authorize their own high-value payouts; independent executive approval is enforced on backend and frontend.
3. **UPI & QR Workflows**:
   - Device camera QR scanning (`jsQR`) and image upload fallback.
   - Parsing of `upi://pay?pa=...` treating payloads as untrusted input with backend sanitization and validation. Never auto-debits on scan.
   - Razorpay dynamic payment-collection QR generation with 15-minute countdown timers and status polling.
4. **Two-Way Project Communication**: Real-time project channels powered by Socket.IO with JWT authorization, contextual entity linking (Payment Requests, Daily Reports, Expenses), and media attachments.
5. **Daily Report Read Receipts**: Executive view tracking displaying:
   - `Not viewed yet`
   - `Seen by MD: [Name] at [Date/Time]`
   - `New revision not viewed` (if report is updated after MD view)
6. **In-App Notification Center**: Bell notifications with real-time push for payments, reviews, authorizations, messages, and report views.

---

## 1. Environment Configuration

Add the following environment variables to your backend `.env` file:

```env
# ==========================================
# RAZORPAYX PAYOUTS INTEGRATION
# ==========================================
RAZORPAYX_KEY_ID="rzp_test_YOUR_KEY_ID"
RAZORPAYX_KEY_SECRET="YOUR_KEY_SECRET"
RAZORPAYX_ACCOUNT_NUMBER="2323230000000000" # RazorpayX Current Account Number
RAZORPAYX_WEBHOOK_SECRET="YOUR_WEBHOOK_SECRET"

# Safety toggle: keep false until live onboarding and security verification are complete
RAZORPAYX_LIVE_TRANSFERS_ENABLED="false"

# Threshold in paise (₹1,00,000 = 10,000,000 paise)
HIGH_VALUE_THRESHOLD_PAISE="10000000"
```

---

## 2. RazorpayX Merchant Onboarding Checklist

To enable live bank transfers:

1. **RazorpayX Account Setup**:
   - Apply for a RazorpayX Current Account at [https://razorpay.com/x/](https://razorpay.com/x/).
   - Complete Video KYC and submit Business Registration / Partnership / Certificate of Incorporation documents.
2. **Payout Methods Activation**:
   - **NEFT**: Enabled by default for all transaction sizes.
   - **RTGS**: Enabled for transactions >= ₹2,00,000 as per RBI operating regulations.
   - **UPI Payouts**: Request approval from RazorpayX support to enable UPI payouts to verified VPAs (capped at ₹1,00,000 per transaction per NPCI guidelines).
3. **Webhook Setup**:
   - Navigate to **RazorpayX Dashboard → Settings → Webhooks**.
   - Add endpoint URL: `https://your-domain.com/api/v1/payments/webhooks`.
   - Secret: Configure identical string in `RAZORPAYX_WEBHOOK_SECRET`.
   - Select Events:
     - `payout.processed`
     - `payout.failed`
     - `payout.reversed`
     - `payout.initiated`
4. **Penny Drop Account Validation**:
   - Enable Bank Account Verification (Penny Drop) under API & Plugins.
   - Allows instant verification of contractor account numbers and legal registered names before dispatching transfers.

---

## 3. Architecture & Data Model Integrity

All operations maintain strict separation of concerns:
```
1. Recording an Expense       -> Existing Expense Register
2. Approving an Expense       -> Existing Executive Approval (NO MONEY IS TRANSFERRED)
3. Creating a Payment Request -> Sealed Beneficiary Snapshot + Integer Paise
4. Authorizing Payment        -> Independent MD Dual-Auth if > ₹1,00,000
5. Executing Transfer         -> Official RazorpayX Payout API with Idempotency Key
6. Final Reconciliation       -> Webhook HMAC-SHA256 signature verification / status inquiry
```

### Monetary Computation Rule
- All amounts are stored strictly as **integer paise** (`amountPaise`).
- ₹1.00 = 100 paise.
- No floating-point division is used in financial calculations to eliminate rounding discrepancies.

---

## 4. Verification Test Results

Run the verification suite at any time:
```bash
npm --prefix backend run verify:full
```

### Verified Scenarios:
- [x] In-Charge creates payment request (NEFT/UPI) linked to project.
- [x] High-value dual-authorization: self-approval blocked, second MD authorized.
- [x] Untrusted UPI QR parsed and malicious strings rejected.
- [x] Dynamic collection QR generated with 15-minute expiry.
- [x] RazorpayX payout dispatched with internal idempotency key.
- [x] Two-way project chat between MD and In-Charge with payment linking.
- [x] Daily report read receipts: initial unviewed, seen by MD timestamp, and revision invalidation.
- [x] In-app notification delivery.
- [x] HMAC-SHA256 cryptographic webhook signature verification and duplicate event suppression.
- [x] Frontend compilation (`tsc && vite build`) passed with zero errors.
- [x] Backend compilation (`tsc`) passed with zero errors.
