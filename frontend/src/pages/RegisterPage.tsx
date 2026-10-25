import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  HardHat,
  Lock,
  Mail,
  ArrowRight,
  User as UserIcon,
  Phone,
  Eye,
  EyeOff,
  ShieldAlert,
  Building2,
  CheckCircle2,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { Button } from '../components/common/Button.js';
import { Input } from '../components/common/Input.js';
import { api } from '../api/client.js';

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('token');

  const { login } = useAuth();
  const { success, error: toastError } = useToast();

  // Invitation state
  const [invitationData, setInvitationData] = useState<any>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [isLoadingInvite, setIsLoadingInvite] = useState(false);

  // Form fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Validate invitation token if present in query params
  useEffect(() => {
    if (inviteToken) {
      setIsLoadingInvite(true);
      api
        .get<{ success: boolean; invitation: any }>(`/auth/invitation/${inviteToken}`)
        .then((res) => {
          if (res.success && res.invitation) {
            setInvitationData(res.invitation);
            setFullName(res.invitation.name);
            setEmail(res.invitation.email);
          }
        })
        .catch((err) => {
          setInvitationError(err.message || 'Invitation is invalid, expired, or already used.');
        })
        .finally(() => {
          setIsLoadingInvite(false);
        });
    }
  }, [inviteToken]);

  // Handle Managing Director / Owner Registration
  const handleRegisterMD = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim() || !email.trim() || !password) {
      setErrorMessage('Full name, email address, and password are required.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify both password entries.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const res = await api.post<{
        success: boolean;
        message: string;
        token: string;
        user: any;
      }>('/auth/register', {
        name: fullName.trim(),
        email: email.toLowerCase().trim(),
        password,
        phone: phone.trim() || undefined,
      });

      if (res.success && res.token && res.user) {
        login(res.token, res.user);
        success('Managing Director account created! Welcome to SiteTrack.');
        navigate('/');
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to register Managing Director account.';
      setErrorMessage(msg);
      toastError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Invitation Acceptance (Site In-Charge)
  const handleAcceptInvitation = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password) {
      setErrorMessage('Please enter a secure password.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify both password entries.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const res = await api.post<{
        success: boolean;
        message: string;
        token: string;
        user: any;
      }>('/auth/accept-invitation', {
        token: inviteToken,
        password,
        phone: phone.trim() || undefined,
      });

      if (res.success && res.token && res.user) {
        login(res.token, res.user);
        success('Account activated! You are now logged in as Site In-Charge.');
        navigate('/');
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to activate invitation.';
      setErrorMessage(msg);
      toastError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingInvite) {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-center items-center py-12 px-4">
        <div className="w-10 h-10 border-4 border-navy-900 border-t-amber-500 rounded-full animate-spin" />
        <p className="text-xs font-semibold text-slate-500 mt-3">Verifying invitation link...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      {/* Brand Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center px-4">
        <div className="w-14 h-14 rounded-2xl bg-navy-900 text-amber-500 mx-auto flex items-center justify-center shadow-lg border border-navy-800">
          <HardHat className="w-8 h-8" />
        </div>
        <h2 className="mt-4 text-2xl sm:text-3xl font-extrabold text-navy-950 tracking-tight">
          SiteTrack
        </h2>
        <p className="mt-1 text-sm text-slate-500 font-medium">
          Construction Management SaaS & Mobile PWA
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-8 px-6 shadow-card rounded-2xl border border-slate-200/90 sm:px-10">
          {inviteToken ? (
            /* CASE 1: Invitation Token Provided for Site In-Charge */
            invitationError ? (
              <div className="text-center py-6 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 mx-auto flex items-center justify-center">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-navy-950">Invalid or Expired Invitation</h3>
                <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                  {invitationError}
                </p>
                <div className="pt-2 flex flex-col gap-2">
                  <Button variant="outline" onClick={() => navigate('/register')} className="w-full">
                    Register as Managing Director Instead
                  </Button>
                  <Button variant="ghost" onClick={() => navigate('/login')} className="w-full text-xs">
                    Return to Sign In
                  </Button>
                </div>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleAcceptInvitation}>
                <div className="text-center pb-2 border-b border-slate-100">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                    Site In-Charge Account Setup
                  </span>
                  <p className="text-xs text-slate-500 mt-1.5">
                    You have been invited by your Managing Director to access SiteTrack.
                  </p>
                </div>

                {invitationData?.project && (
                  <div className="p-3 bg-navy-50 rounded-xl border border-navy-100 flex items-center gap-2.5 text-xs text-navy-950">
                    <Building2 className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <div>
                      <span className="font-bold block">Assigned Project:</span>
                      <span className="text-slate-600">
                        {invitationData.project.name} ({invitationData.project.code})
                      </span>
                    </div>
                  </div>
                )}

                {errorMessage && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
                    {errorMessage}
                  </div>
                )}

                <Input
                  label="Full Name"
                  type="text"
                  value={fullName}
                  disabled
                  className="bg-slate-50 text-slate-500"
                  leftIcon={<UserIcon className="w-4 h-4" />}
                />

                <Input
                  label="Email Address"
                  type="email"
                  value={email}
                  disabled
                  className="bg-slate-50 text-slate-500"
                  leftIcon={<Mail className="w-4 h-4" />}
                />

                <Input
                  label="Establish Secure Password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  leftIcon={<Lock className="w-4 h-4" />}
                  rightIcon={
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-1 text-slate-400 hover:text-navy-900 focus:outline-none transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />

                <Input
                  label="Confirm Password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  leftIcon={<Lock className="w-4 h-4" />}
                  rightIcon={
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="p-1 text-slate-400 hover:text-navy-900 focus:outline-none transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />

                <Input
                  label="Phone Number (Optional)"
                  type="tel"
                  placeholder="+91 98765 43210"
                  leftIcon={<Phone className="w-4 h-4" />}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full py-2.5 font-bold mt-2"
                  isLoading={isSubmitting}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Activate Site In-Charge Account
                </Button>
              </form>
            )
          ) : (
            /* CASE 2: Managing Director / Owner Registration Form */
            <form className="space-y-4" onSubmit={handleRegisterMD}>
              <div className="text-center pb-2 border-b border-slate-100">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900">
                  <UserPlus className="w-3.5 h-3.5 text-amber-700" />
                  Create Managing Director Account
                </span>
                <p className="text-xs text-slate-500 mt-1.5">
                  Register your account to manage construction projects, track budgets, and authorize site engineers.
                </p>
              </div>

              {/* Information pill for Site In-Charges */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-start gap-2.5 text-xs text-slate-600">
                <HardHat className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <span className="font-semibold text-navy-950">Site In-Charge?</span> In-charge accounts are activated using the invitation link generated by your Managing Director.
                </p>
              </div>

              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium">
                  {errorMessage}
                </div>
              )}

              <Input
                label="Full Name"
                type="text"
                placeholder="e.g. Vikram Singhania"
                leftIcon={<UserIcon className="w-4 h-4" />}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />

              <Input
                label="Email Address"
                type="email"
                placeholder="e.g. md@constructioncorp.com"
                leftIcon={<Mail className="w-4 h-4" />}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                leftIcon={<Lock className="w-4 h-4" />}
                rightIcon={
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 text-slate-400 hover:text-navy-900 focus:outline-none transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <Input
                label="Confirm Password"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                leftIcon={<Lock className="w-4 h-4" />}
                rightIcon={
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="p-1 text-slate-400 hover:text-navy-900 focus:outline-none transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />

              <Input
                label="Phone Number (Optional)"
                type="tel"
                placeholder="+91 98765 43210"
                leftIcon={<Phone className="w-4 h-4" />}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />

              <Button
                type="submit"
                variant="amber"
                className="w-full py-2.5 font-bold mt-2"
                isLoading={isSubmitting}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Create Managing Director Account
              </Button>

              <div className="mt-4 pt-4 border-t border-slate-100 text-center">
                <p className="text-xs text-slate-500">
                  Already have an account?{' '}
                  <Link to="/login" className="font-bold text-navy-900 hover:underline">
                    Sign In
                  </Link>
                </p>
              </div>
            </form>
          )}
        </div>

        {/* Footer info */}
        <p className="mt-4 text-center text-xs text-slate-400">
          SiteTrack Enterprise • MongoDB Atlas • PWA Ready
        </p>
      </div>
    </div>
  );
};
