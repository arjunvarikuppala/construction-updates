import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { HardHat, Lock, Mail, ArrowRight, Eye, EyeOff } from 'lucide-react';
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
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      {/* Brand Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center px-4">
        <div className="w-14 h-14 rounded-2xl bg-navy-900 text-amber-500 mx-auto flex items-center justify-center shadow-lg border border-navy-800">
          <HardHat className="w-8 h-8" />
        </div>
        <h2 className="mt-4 text-2xl sm:text-3xl font-extrabold text-navy-950 tracking-tight">
          BKR INFRA
        </h2>
        <p className="mt-1 text-sm text-slate-500 font-medium">
          Site Reports &amp; Payments
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-8 px-6 shadow-card rounded-2xl border border-slate-200/90 sm:px-10">
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
        <p className="mt-4 text-center text-xs text-slate-400">
          BKR INFRA • Internal site management
        </p>
      </div>
    </div>
  );
};
