# SiteTrack — Construction Project Management SaaS & PWA

**SiteTrack** is a unified, production-ready construction project and expense management application designed for construction managing directors, general contractors, and on-site project in-charges.

It functions simultaneously as an executive **web application on laptops** and an **installable app-like Progressive Web App (PWA) on mobile phones** — powered by **one single codebase, one backend API, and one MongoDB Atlas database**.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, React Router v7, TanStack Query v5, Lucide React, Recharts, jsPDF, SheetJS (XLSX) |
| **Backend** | Node.js, Express.js, TypeScript, Mongoose ODM, JWT, BcryptJS, Helmet, Morgan, Express-Rate-Limit, ExcelJS |
| **Database** | MongoDB Atlas (Production) / Embedded MongoDB Memory Server (Instant Local Zero-Setup Fallback) |
| **Media & Receipts** | Static Uploads (`/uploads/`) with Cloudinary production integration |
| **PWA & Mobile** | Web App Manifest (`manifest.webmanifest`), Service Worker (`sw.js`), Offline Banner, PWA Installation Prompt |
| **Design System** | Deep Navy (`#142B4A`), Construction Amber (`#F5A623`), Light Background (`#F6F8FB`), Inter Typography |

---

## 🌟 Key Highlights & Engineering Features

### 1. Integer Paise Financial Precision
- All monetary amounts (project budgets, expense claims, approved totals) are strictly stored and computed as **integer paise** (e.g., ₹5,000 = `500000` paise).
- Completely prevents IEEE-754 floating point inaccuracies common in financial applications.

### 2. Dual-Role Architecture with Backend Enforcement
- **Owner / Managing Director:**
  - Executive overview of all projects, active burn rates, remaining budgets.
  - Reviews and approves or rejects expenses. **Rejection strictly enforces a documented reason.**
  - Tracks daily reports submitted vs expected; highlights projects requiring attention.
  - Exports reports to branded PDF statements and Excel registers.
  - Provisions and manages site in-charge engineer accounts.
  - Full activity audit trail (`/audit-logs`).
- **Project In-Charge:**
  - **Scoped project access:** Backend middleware strictly prevents viewing or submitting against unassigned projects (HTTP 403 Forbidden).
  - Submits daily construction reports with task quantities, units (`sq.m`, `tons`, `cu.m`, `bags`), labour trade headcounts, equipment hours, site issues, and next-day plans.
  - Camera/gallery site photo uploads.
  - Submits expenses with receipt attachments.
  - Receives instant rejection notes with one-click **"Correct & Resubmit"** workflow.

### 3. Cross-Device Near-Real-Time Synchronization
- Submissions from an In-Charge's phone appear on the Owner's laptop automatically.
- Approvals or rejections from the laptop update on the mobile phone within seconds.
- Powered by TanStack Query refetching on window focus, connectivity restoration, and periodic polling.
- Private authenticated financial endpoints are never insecurely cached in public browser service worker caches.

### 4. Installable Progressive Web App (PWA)
- Standard Web App Manifest (`manifest.webmanifest`) with standalone display mode.
- Custom vector branding icon (`icon.svg`).
- Service Worker (`sw.js`) provides safe offline fallback and network-first API dispatching.
- Includes in-app "Install App" prompt on supported mobile and desktop browsers.

---

## 🔑 Pre-Seeded Demo Accounts

The database comes pre-seeded with realistic construction data, projects, reports, and expenses:

| Role | Email | Password | Assigned Projects |
|---|---|---|---|
| **Owner / Managing Director** | `owner@sitetrack.com` | `SiteTrack@123` | *All Projects (Executive Access)* |
| **Site In-Charge 1** | `rajesh.incharge@sitetrack.com` | `SiteTrack@123` | *Metro Heights (PRJ-MHC-01), Highland Flyover (PRJ-HEF-03)* |
| **Site In-Charge 2** | `amit.incharge@sitetrack.com` | `SiteTrack@123` | *Greenfield Luxury Villas (PRJ-GLV-02)* |

> Quick login buttons are available on the login page for 1-click credential auto-fill!

---

## 🚀 Running Locally

### Prerequisites
- Node.js v18+ (tested on v24.12.0)
- npm v9+

### 1. Clone & Install Dependencies
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Environment Configuration
Backend `.env` file (`backend/.env`):
```env
PORT=5000
NODE_ENV=development
JWT_SECRET=sitetrack_super_secure_jwt_secret_dev_2026_key

# Optional: Provide MongoDB Atlas URI, or leave empty for embedded zero-setup memory DB:
# MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/sitetrack?retryWrites=true&w=majority
MONGODB_URI=
```

### 3. Run Development Servers
In terminal 1 (Backend):
```bash
cd backend
npm run dev
# Starts REST API on http://localhost:5000
```

In terminal 2 (Frontend):
```bash
cd frontend
npm run dev
# Starts Vite application on http://localhost:5173
# Also accessible on local network (e.g. http://192.168.x.x:5173) for mobile testing
```

### 4. Run Automated Workflow Verification
To verify all 14 business workflows (owner creation, report logging, paise math, duplicate checks, permission boundaries, rejection & resubmission):
```bash
cd backend
npx tsx src/scripts/verify-workflows.ts
```

---

## ☁️ Deployment Instructions

### 1. MongoDB Atlas Setup
1. Create a free M0 or production cluster on [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Under **Database Access**, create a user with read/write privileges.
3. Under **Network Access**, whitelist `0.0.0.0/0` (or the IP ranges of your Render backend).
4. Copy the connection string into the `MONGODB_URI` environment variable.

### 2. Backend Deployment (Render / Railway)
1. Link your Git repository on [Render](https://render.com).
2. Select **Web Service** with runtime `Node`.
3. Set **Root Directory** to `backend`.
4. Build command: `npm install && npm run build`
5. Start command: `npm start`
6. Configure Environment Variables:
   - `NODE_ENV`: `production`
   - `PORT`: `5000` (or default `$PORT`)
   - `JWT_SECRET`: `your_random_64_char_secret`
   - `MONGODB_URI`: `mongodb+srv://...`

### 3. Frontend Deployment (Vercel)
1. Link your repository on [Vercel](https://vercel.com).
2. Set **Root Directory** to `frontend`.
3. Framework Preset: `Vite`.
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Add rewrite in `vercel.json` to proxy `/api` requests to your Render backend:
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://your-backend.onrender.com/api/$1" },
    { "source": "/uploads/(.*)", "destination": "https://your-backend.onrender.com/uploads/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### 4. Media Storage (Cloudinary)
For production persistence of receipts and site photos across container restarts, provide:
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

---

## 📋 Verified Business Requirements Checklist

- [x] One React codebase & one Node.js REST API serving laptops and mobile phones.
- [x] Brand palette: Deep Navy `#142B4A`, Construction Amber `#F5A623`, Light `#F6F8FB`.
- [x] Role-based permissions enforced on every backend endpoint.
- [x] Projects with unique codes, locations, budgets in integer paise, and assigned site in-charge.
- [x] Daily reports with summary, work items + units, labour trades + total headcount, equipment, delays, next-day plans, photos.
- [x] Draft vs Submitted report separation (drafts never appear as submitted).
- [x] Missing reports indicator for active projects.
- [x] 8 standard expense categories, receipt photo uploads, duplicate prevention.
- [x] Mandatory rejection reason and full resubmission lifecycle.
- [x] Executive Owner Dashboard with KPI cards, Recharts visualizations, and attention lists.
- [x] Mobile-optimized In-Charge Dashboard with rapid logging and resubmission shortcuts.
- [x] Branded PDF export (jsPDF) & Excel workbook export (SheetJS / ExcelJS).
- [x] PWA manifest, service worker, and home screen install support.
- [x] 14/14 automated end-to-end integration tests passing.
