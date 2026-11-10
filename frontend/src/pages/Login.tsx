import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, Mail, ArrowRight, Eye, EyeOff, ClipboardList, ShieldCheck, IndianRupee } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Button } from '../components/common/Button.js';
import { Input } from '../components/common/Input.js';
import { api } from '../api/client.js';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { user, token, isLoading: authLoading, login } = useAuth();
  const { success, error: toastError } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // Only offered before BKR INFRA's MD account exists (first-time setup)
  const [firstSetup, setFirstSetup] = useState(false);
  useEffect(() => {
    api
      .get<{ registrationOpen?: boolean; hasMD?: boolean }>('/auth/first-md-status')
      .then((r) => setFirstSetup(Boolean(r.registrationOpen ?? !r.hasMD)))
      .catch(() => setFirstSetup(false));
  }, []);

  // Check for session expired or authentication message on mount
  useEffect(() => {
    const authMsg = sessionStorage.getItem('sitetrack_auth_message');
    if (authMsg) {
      sessionStorage.removeItem('sitetrack_auth_message');
      setErrorMessage(authMsg);
    }
  }, []);

  // If already authenticated with a valid session, redirect immediately away from login
  useEffect(() => {
    if (!authLoading && token && user) {
      navigate('/', { replace: true });
    }
  }, [token, user, authLoading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const targetEmail = email.trim();
    const targetPassword = password;

    if (!targetEmail || !targetPassword) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const res = await api.post<{
        success: boolean;
        message: string;
        token: string;
        user: any;
      }>('/auth/login', {
        email: targetEmail,
        password: targetPassword,
      });

      if (res.success && res.token && res.user) {
        login(res.token, res.user);
        success(`Welcome back, ${res.user.name}`);
        navigate('/');
      }
    } catch (err: any) {
      const message = err.message || 'Invalid email or password. Please verify credentials.';
      setErrorMessage(message);
      toastError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Brand panel (desktop) */}
      <aside className="hidden lg:flex lg:w-[46%] xl:w-1/2 relative flex-col justify-between bg-white border-r border-slate-200 px-12 xl:px-16 py-12 overflow-hidden">
        {/* Soft brand-colour wash */}
        <div aria-hidden className="pointer-events-none absolute -top-40 -right-40 w-[28rem] h-[28rem] rounded-full bg-[#2A3384]/[0.06]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-32 w-[30rem] h-[30rem] rounded-full bg-[#D9262E]/[0.05]" />

        <div className="relative">
          <img src="/brand/bkr-logo-transparent.png" alt="BKR Infra Developers" className="w-56 xl:w-64 h-auto" draggable={false} />
        </div>

        <div className="relative max-w-md">
          <p className="text-xs font-bold tracking-[0.18em] uppercase text-[#D9262E]">Site Reports &amp; Payments</p>
          <h1 className="mt-3 text-3xl xl:text-4xl font-extrabold text-navy-950 leading-tight tracking-tight">
            Every site, every report, every payment — in one place.
          </h1>
          <ul className="mt-8 space-y-4">
            {[
              { icon: ClipboardList, title: 'Daily site reports', text: 'Work, labour, materials and machinery, straight from the site.' },
              { icon: ShieldCheck, title: 'Expense approvals', text: 'Bills and GST receipts reviewed by the Managing Director.' },
              { icon: IndianRupee, title: 'Payments on record', text: 'Every payout tracked against the project it belongs to.' },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="w-10 h-10 rounded-xl bg-[#2A3384]/[0.08] text-[#2A3384] flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-navy-950">{title}</span>
                  <span className="block text-sm text-slate-500">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-3 text-xs text-slate-400">
          <span className="h-0.5 w-8 bg-[#D9262E] rounded-full" />
          <span>© {new Date().getFullYear()} BKR Infra Developers</span>
        </div>
      </aside>

      {/* Sign-in panel */}
      <main className="flex-1 flex flex-col justify-center px-4 py-10 sm:px-6 lg:px-12">
        <div className="w-full max-w-md mx-auto">
          {/* Logo for phones / tablets */}
          <div className="lg:hidden text-center mb-8">
            <img src="/brand/bkr-logo-transparent.png" alt="BKR Infra Developers" className="w-32 sm:w-36 h-auto mx-auto" draggable={false} />
            <p className="mt-3 text-xs font-bold tracking-[0.18em] uppercase text-slate-500">Site Reports &amp; Payments</p>
          </div>

          <div className="mb-6 hidden lg:block">
            <h2 className="text-2xl font-bold text-navy-950 tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Use the email and password registered for you.</p>
          </div>

        <div className="bg-white py-8 px-6 shadow-card rounded-2xl border border-slate-200/90 sm:px-8">
          <h2 className="lg:hidden text-lg font-bold text-navy-950 mb-4">Sign in to your account</h2>
          <form className="space-y-4" onSubmit={handleLogin}>
            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
                {errorMessage}
              </div>
            )}

            <Input
              label="Email Address"
              type="email"
              autoComplete="email"
              placeholder="e.g. md@constructioncorp.com"
              leftIcon={<Mail className="w-4 h-4" />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              leftIcon={<Lock className="w-4 h-4" />}
              rightIcon={
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1 text-slate-400 hover:text-navy-900 focus:outline-none transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <Button
              type="submit"
              variant="primary"
              className="w-full py-2.5 font-bold mt-2"
              isLoading={isLoading}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              Sign in
            </Button>
          </form>

          {/* No public sign-up: In-Charges join through the MD's invitation link */}
          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-500">
              New Site In-Charge? Ask the Managing Director to send you an invitation.
            </p>
            {firstSetup && (
              <p className="text-xs text-slate-500 mt-2">
                First-time setup?{' '}
                <Link to="/register" className="font-bold text-amber-700 hover:text-amber-800 underline transition-colors">
                  Create the MD account
                </Link>
              </p>
            )}
          </div>
        </div>

        {/* Footer info */}
        <p className="mt-6 text-center text-xs text-slate-400">
          Authorised BKR Infra staff only
        </p>
        </div>
      </main>
    </div>
  );
};
