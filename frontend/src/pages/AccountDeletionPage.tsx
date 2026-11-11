import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Trash2 } from 'lucide-react';
import { LegalLayout, ContactLine } from '../components/legal/LegalLayout.js';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../api/client.js';
import { Button } from '../components/common/Button.js';
import { COMPANY_NAME } from '../utils/legal.js';

/** Public page Google Play links to: how a user gets their account and data deleted. */
export const AccountDeletionPage: React.FC = () => {
  const { user, isMD } = useAuth();
  const [step, setStep] = useState<'idle' | 'confirm' | 'sending' | 'sent'>('idle');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const send = async () => {
    setStep('sending');
    setError('');
    try {
      const r = await api.post<{ success: boolean; message: string }>('/auth/deletion-request', { reason });
      setResult(r.message);
      setStep('sent');
    } catch (e: any) {
      setError(e?.message || 'Could not send the request. Please try again.');
      setStep('confirm');
    }
  };

  return (
    <LegalLayout title="Delete your account">
      <p>
        Anyone with a {COMPANY_NAME} app account can ask for it to be deleted, together with their personal details.
      </p>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <h2>Request deletion</h2>

        {!user && (
          <p>
            <Link to="/login">Sign in</Link> and open this page again (it is also in the app menu under{' '}
            <em>Delete account</em>) to send the request in one tap. If you can no longer sign in, <ContactLine /> with
            the email address of your account.
          </p>
        )}

        {user && isMD && (
          <p>
            You are the company owner (MD). Your account holds the whole company's records, so it is closed on request:{' '}
            <ContactLine />. To delete a Site In-Charge's account, open <Link to="/team">In-Charge Accounts</Link> and
            choose <strong>Delete account</strong>.
          </p>
        )}

        {user && !isMD && step !== 'sent' && (
          <div className="space-y-3">
            <p>
              Signed in as <strong>{user.name}</strong> ({user.email}). Your request goes to your Managing Director, who
              deletes the account.
            </p>
            {step === 'idle' ? (
              <Button variant="danger" leftIcon={<Trash2 className="w-4 h-4" />} onClick={() => setStep('confirm')}>
                Request account deletion
              </Button>
            ) : (
              <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
                <label className="block text-sm font-semibold text-slate-800" htmlFor="del-reason">
                  Reason (optional)
                </label>
                <textarea
                  id="del-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-500/20 focus:border-navy-500"
                />
                <p className="text-sm text-rose-800">
                  After deletion you will not be able to sign in again. This cannot be undone.
                </p>
                {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" isLoading={step === 'sending'} onClick={send}>
                    Yes, send the request
                  </Button>
                  <Button variant="outline" onClick={() => setStep('idle')} disabled={step === 'sending'}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'sent' && (
          <p className="flex items-start gap-2 text-emerald-800">
            <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
            <span>{result}</span>
          </p>
        )}
      </section>

      <section>
        <h2>What is deleted</h2>
        <ul>
          <li>Your name, email address, phone number and salary details are erased.</li>
          <li>You are signed out everywhere and can never sign in to that account again.</li>
          <li>Notifications to your devices stop.</li>
        </ul>
      </section>

      <section>
        <h2>What is kept, and for how long</h2>
        <p>
          Site reports, photos, expenses, bills, payments and project chat messages are the company's business records.
          They are kept for as long as Indian tax and accounting law requires (generally 6 to 8 years) and show
          “Deleted user” instead of your name.
        </p>
      </section>

      <section>
        <h2>How long it takes</h2>
        <p>Your account is deleted within 30 days of the request, usually much sooner.</p>
      </section>

      <p className="text-sm text-slate-500">
        See also our <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalLayout>
  );
};
