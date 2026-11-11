import React from 'react';
import { Link } from 'react-router-dom';
import { LegalLayout, ContactLine } from '../components/legal/LegalLayout.js';
import { APP_NAME, COMPANY_NAME, POLICY_UPDATED } from '../utils/legal.js';

export const PrivacyPolicyPage: React.FC = () => (
  <LegalLayout title="Privacy Policy" updated={POLICY_UPDATED}>
    <p>
      This policy explains what information the <strong>{APP_NAME}</strong> app (website and Android app) collects, why,
      and how it is protected. The app is run by <strong>{COMPANY_NAME}</strong> for its own staff — the Managing
      Director (MD) and Site In-Charges. It is not open to the public: accounts are created only by the MD.
    </p>

    <section>
      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> name, email address, phone number, role, and a password (stored only in
          scrambled, hashed form). For Site In-Charges the MD may also record salary details.
        </li>
        <li>
          <strong>Work records you add:</strong> daily site reports, labour and material details, photos, videos,
          documents, voice notes, project chat messages, expenses, bills and GST details.
        </li>
        <li>
          <strong>Payment details:</strong> names, UPI IDs, bank account numbers and IFSC codes of people and vendors
          who are paid, payment amounts and bank reference (UTR) numbers.
        </li>
        <li>
          <strong>Technical information:</strong> a notification token for your device (only if you turn on
          notifications), your IP address in security logs, and a record of actions taken in the app (audit log).
        </li>
      </ul>
      <p className="mt-2">
        We do <strong>not</strong> track your location, read your contacts, show ads, or use analytics or tracking
        tools.
      </p>
    </section>

    <section>
      <h2>Phone permissions</h2>
      <ul>
        <li><strong>Camera</strong> — to take site photos and videos, and to scan vendor UPI QR codes.</li>
        <li><strong>Microphone</strong> — only while you record a voice note in chat.</li>
        <li><strong>Notifications</strong> — to alert you about new reports, messages and payments.</li>
      </ul>
      <p className="mt-2">Each permission is asked for only when you use that feature, and you can refuse it.</p>
    </section>

    <section>
      <h2>How we use it</h2>
      <ul>
        <li>To run the app: sign-in, site reports, chat, expense approvals and payments.</li>
        <li>To keep the company's accounts and GST records.</li>
        <li>To keep the app secure and investigate misuse.</li>
      </ul>
      <p className="mt-2">We never sell your information or use it for advertising.</p>
    </section>

    <section>
      <h2>Who can see it</h2>
      <p>
        Your MD and the people working on the same projects see the work records you share there. Other companies
        using the app cannot see your data. We use these service providers only to run the app:
      </p>
      <ul className="mt-2">
        <li><strong>MongoDB Atlas</strong> — database (Mumbai, India)</li>
        <li><strong>Render</strong> — app server (Singapore)</li>
        <li><strong>Cloudflare</strong> — website delivery and security</li>
        <li><strong>Cloudinary</strong> — storage for photos, videos and documents</li>
        <li><strong>Razorpay</strong> — sending bank and UPI payments, only when the MD pays through it</li>
        <li><strong>Google, Apple or Mozilla push services</strong> — delivering notifications to your device</li>
        <li><strong>Open-Meteo</strong> — site weather (receives only the project's location, no personal data)</li>
      </ul>
      <p className="mt-2">We may also share information if the law requires it.</p>
    </section>

    <section>
      <h2>How long we keep it</h2>
      <p>
        Your account is kept while you work with {COMPANY_NAME}. When your account is deleted, your name, email, phone
        number and salary details are erased within 30 days. Work and financial records (reports, expenses, bills and
        payments) are business records of the company and are kept for as long as Indian tax and accounting law
        requires (generally 6 to 8 years); after deletion they show “Deleted user” instead of your name.
      </p>
    </section>

    <section>
      <h2>Security</h2>
      <p>
        All data travels over encrypted HTTPS connections. Passwords are hashed, access is limited by role and
        project, and important actions are logged.
      </p>
    </section>

    <section>
      <h2>Your rights</h2>
      <p>
        You can ask to see, correct or delete your personal information, in line with India's Digital Personal Data
        Protection Act, 2023. To delete your account, follow the steps on the{' '}
        <Link to="/delete-account">Delete account</Link> page.
      </p>
    </section>

    <section>
      <h2>Children</h2>
      <p>The app is for adult employees of {COMPANY_NAME} only and is not meant for anyone under 18.</p>
    </section>

    <section>
      <h2>Changes and contact</h2>
      <p>
        If this policy changes, the new version will be posted here with a new date. For any privacy question,{' '}
        <ContactLine />.
      </p>
    </section>
  </LegalLayout>
);
