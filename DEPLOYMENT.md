# Going live — BKR Infra Site Reports & Payments

This guide puts the app online on **the client's own accounts**, so BKR Infra owns the data, billing and access from day one.

| Part | Service | Plan | Approx. cost |
|---|---|---|---|
| Website (what people open) | Cloudflare Pages | Free (commercial use allowed) | ₹0 |
| Backend API + live chat | Render — web service | Starter (always on) | ~$7 / month |
| Database | MongoDB Atlas | M0 Free (512 MB) | ₹0 |
| Photos, receipts, PDFs | Cloudinary | Free | ₹0 |
| Web address | Client's domain (e.g. `bkrinfra.com`) | — | Existing domain |

> **Why paid Starter for the backend:** Render's free web services sleep after 15 minutes idle. The first person each morning would wait ~50 s, and live chat / push notifications drop while asleep.

Final addresses (replace `bkrinfra.com` with the real domain throughout):

- Website: **https://app.bkrinfra.com**
- API: **https://api.bkrinfra.com**

Allow about **1–2 hours** the first time, plus up to a few hours for the domain (DNS) to take effect.

---

## 0. Before you start

You need:

1. A **company email** for BKR Infra (e.g. `it@bkrinfra.com`). Use it to sign up for every service below, so access stays with the company if staff change.
2. Access to the **domain's DNS settings** (GoDaddy, Hostinger, Cloudflare, etc.).
3. The **code on GitHub, owned by the client.** Either:
   - the client creates a GitHub account and the developer **transfers** the repository to it (GitHub → repo → *Settings* → *Danger Zone* → *Transfer ownership*), or
   - the client creates a GitHub account and is added to the repository as an *Admin*.

   Render and Cloudflare deploy straight from GitHub, so whoever connects them needs access to this repository.

---

## 1. Database — MongoDB Atlas

1. Sign up at **mongodb.com/atlas** with the company email.
2. **Create a cluster** → choose **M0 (Free)** → provider **AWS**, region **Mumbai (ap-south-1)** → name it `bkr-infra`.
3. **Database Access** → *Add New Database User* → username `bkrinfra_app` → *Autogenerate Secure Password* → **copy the password somewhere safe** → role *Read and write to any database*.
4. **Network Access** → *Add IP Address* → **Allow access from anywhere** (`0.0.0.0/0`).
   Render doesn't use fixed IP addresses, so this is required. The database is still protected by the username and password.
5. **Connect** → *Drivers* → copy the connection string. It looks like:
   ```
   mongodb+srv://bkrinfra_app:<password>@bkr-infra.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   Put the password in, and add the database name `bkrinfra` before the `?`:
   ```
   mongodb+srv://bkrinfra_app:YOUR_PASSWORD@bkr-infra.xxxxx.mongodb.net/bkrinfra?retryWrites=true&w=majority
   ```
   This is the **`MONGODB_URI`**.

---

## 2. File storage — Cloudinary

1. Sign up at **cloudinary.com** with the company email.
2. On the **Dashboard**, copy the three values:
   - **Cloud name** → `CLOUDINARY_CLOUD_NAME`
   - **API Key** → `CLOUDINARY_API_KEY`
   - **API Secret** → `CLOUDINARY_API_SECRET`

> ⚠️ **Don't skip this.** Without Cloudinary, every photo, receipt and PDF is saved on the Render server's disk and is **deleted on every update or restart**. The server log shows a loud *NO CLOUD FILE STORAGE CONFIGURED* warning if these are missing.

---

## 3. Backend API — Render

1. Sign up at **render.com** with the company email and **connect GitHub** (the account that has access to the repository).
2. Add a payment card under *Billing*. It's needed for the Starter API plan.
3. **New +** → **Blueprint** → choose this repository. Render reads `render.yaml` and creates the `bkr-infra-api` service (Starter).
4. Render asks for the secret values:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | from step 1 |
   | `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | from step 2 |
   | `CORS_ORIGIN` | leave as `https://bkr-infra.pages.dev` for now (the website address from step 4) |

   `JWT_SECRET` (login security) is generated automatically. **Don't change it later**, or everyone is signed out.

5. Click **Apply** and wait for the service to show **Live** (about 5–10 minutes).
6. Check it: open `https://bkr-infra-api.onrender.com/api/health`. It should show `"status":"online"`.
   If Render added a suffix (e.g. `bkr-infra-api-x1y2.onrender.com`), use the exact address shown on the service page.

---

## 4. Website — Cloudflare Pages

Cloudflare Pages is free for business use, has unlimited bandwidth, and serves from data centres across India.

1. Sign up at **dash.cloudflare.com** with the company email.
2. **Workers & Pages** → **Create** → choose the **Pages** tab → **Connect to Git** → pick this repository.
   (Choose *Pages*, not *Workers*. The Workers option needs extra config files this project doesn't have.)
3. Fill in the build settings:

   | Setting | Value |
   |---|---|
   | Project name | `bkr-infra` (gives `https://bkr-infra.pages.dev`) |
   | Production branch | `main` |
   | Framework preset | `React (Vite)` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | `frontend` |

4. Under **Environment variables**, add:

   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | `https://bkr-infra-api.onrender.com` (the API address from step 3) |
   | `NODE_VERSION` | `22` |

5. **Save and Deploy**. When it finishes, open `https://bkr-infra.pages.dev`. The login page with the BKR logo should appear.
6. If the project name was taken, Cloudflare picks another address (e.g. `bkr-infra-abc.pages.dev`). Put that exact address in Render → **bkr-infra-api** → *Environment* → `CORS_ORIGIN`.

Page routing and caching are already set up in the code: `frontend/public/_headers` sets the caching rules, and Cloudflare automatically sends every page address to the app.

### Moving from Vercel (if the site is already live there)

Keep Vercel running until Cloudflare works, so nobody is cut off:

1. Do steps 1–5 above.
2. Render → **bkr-infra-api** → *Environment* → set `CORS_ORIGIN` to **both** addresses, comma-separated, then *Save*:
   `https://your-app.vercel.app,https://bkr-infra.pages.dev`
3. Test on `https://bkr-infra.pages.dev`: log in, open a project chat, upload a photo.
4. Move the domain (section 5) to Cloudflare.
5. Once the domain works, remove the Vercel address from `CORS_ORIGIN` and delete the Vercel project.
   People who installed the app on their phone from the **Vercel address** need to install it again from the new address. Installs from the custom domain keep working.

---

## 5. Connect the client's domain

### Website → `app.bkrinfra.com`
1. Cloudflare → **Workers & Pages** → **bkr-infra** → *Custom domains* → **Set up a custom domain** → `app.bkrinfra.com`.
2. If the domain's DNS is on Cloudflare, it adds the record for you. Otherwise, add this at the domain provider:
   `CNAME` · name `app` · value `bkr-infra.pages.dev`
   (If this domain was pointing at Vercel, **replace** the old Vercel record. Don't add a second one.)

### API → `api.bkrinfra.com`
1. Render → **bkr-infra-api** → *Settings* → *Custom Domains* → add `api.bkrinfra.com`.
2. Add the DNS record: `CNAME` · name `api` · value `bkr-infra-api.onrender.com`
   If the DNS is on Cloudflare, set this record to **DNS only** (grey cloud), so Render can issue its certificate.

Wait until both show as active with HTTPS. This usually takes minutes, but can take a few hours.

### Point the app at the real addresses
1. Render → **bkr-infra-api** → *Environment* → set `CORS_ORIGIN` = `https://app.bkrinfra.com` → *Save* (it redeploys).
2. Cloudflare → **bkr-infra** → *Settings* → *Variables and Secrets* → set `VITE_API_URL` = `https://api.bkrinfra.com`.
   Then *Deployments* → latest → **Retry deployment**. The website must be **rebuilt** after this change, because the address is built into the website files.
3. Open **https://app.bkrinfra.com** and check it loads.

> Want the website on the main domain (`bkrinfra.com`) instead of `app.`? Add `bkrinfra.com` as the custom domain in Cloudflare Pages instead (this needs the domain's DNS on Cloudflare). Then set `CORS_ORIGIN` to `https://bkrinfra.com`.

---

## 6. First-time setup inside the app

1. Open the website. Because no Managing Director account exists yet, the login page shows **"First-time setup? Create the MD account."**
2. The MD creates their account. **After that, public sign-up closes automatically.**
3. The MD adds the company details under **Company & GST**.
4. The MD creates projects and **invites Site In-Charges**. In-Charges join only through the MD's invitation.
5. Install the app on phones: open the website in Chrome (Android) or Safari (iPhone) → *Add to Home screen*. It works like an app and can send notifications.

---

## 7. Optional extras

| Feature | What to set on **bkr-infra-api** |
|---|---|
| UPI QR codes for collections | `MERCHANT_UPI_VPA` = company UPI ID (e.g. `bkrinfra@icici`) |
| Real bank payouts (RazorpayX) | See `PAYMENTS_ONBOARDING.md`. Start with `rzp_test_…` keys; switch on live payouts only with `PAYMENTS_LIVE_ENABLED=true` and the webhook secret set. |

Without RazorpayX keys, the MD still records payments by hand. Everything else works.

---

## 8. Handover checklist

- [ ] GitHub repository owned by (or shared with) the client
- [ ] MongoDB Atlas, Cloudinary, Render and Cloudflare accounts all on the **company email**
- [ ] Render billing on the **client's card**
- [ ] `https://app.bkrinfra.com` opens, with the padlock (HTTPS)
- [ ] `https://api.bkrinfra.com/api/health` shows `online`
- [ ] MD account created, and a test In-Charge invited and signed in
- [ ] A test daily report with a photo submitted. Restart **bkr-infra-api** (*Manual Deploy → Restart*) and confirm the photo is still there (proves Cloudinary is working).
- [ ] Notifications allowed on the MD's phone, and a test message received
- [ ] Passwords stored in the company's password manager (Atlas DB password, Cloudinary, Render, Cloudflare, GitHub)

## 9. Day-to-day

- **Updates:** pushing to the `main` branch on GitHub redeploys the website (Cloudflare) and the API (Render) automatically.
- **Logs / problems:** API → Render → service → *Logs*. Website build → Cloudflare → **bkr-infra** → *Deployments*.
- **Backups:** Atlas M0 has no automatic backups. For important data, upgrade to an Atlas **M10** cluster (backups included). Or periodically export from Atlas → *Collections* → *Export*.
- **Storage limits:** Atlas M0 = 512 MB of data (text only; files live in Cloudinary). Cloudinary Free = 25 monthly credits. Both dashboards show usage, so upgrade when they get close.
