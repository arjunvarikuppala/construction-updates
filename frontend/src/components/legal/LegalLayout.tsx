import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BrandLogo } from '../common/BrandLogo.js';
import { useAuth } from '../../context/AuthContext.js';
import { COMPANY_NAME, SUPPORT_EMAIL } from '../../utils/legal.js';

/** Public page shell for the Privacy Policy and Delete Account pages (no sign-in needed). */
export const LegalLayout: React.FC<{ title: string; updated?: string; children: React.ReactNode }> = ({
  title,
  updated,
  children,
}) => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link to={user ? '/' : '/login'} className="flex items-center gap-2.5 min-w-0">
            <BrandLogo variant="plain" className="w-9 h-9" />
            <span className="font-black text-navy-900 truncate">BKR INFRA</span>
          </Link>
          <Link
            to={user ? '/' : '/login'}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-900 hover:text-brand-600 min-h-[40px] shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            {user ? 'Back to app' : 'Sign in'}
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <h1 className="text-2xl sm:text-3xl font-black text-navy-900">{title}</h1>
        {updated && <p className="mt-1 text-sm text-slate-500">Last updated: {updated}</p>}
        <div className="mt-6 space-y-6 text-[15px] leading-relaxed text-slate-700 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-navy-900 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-brand-700 [&_a]:font-semibold [&_a]:underline">
          {children}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-500">
          <span>© {COMPANY_NAME}</span>
          <Link to="/privacy" className="hover:text-navy-900">Privacy Policy</Link>
          <Link to="/delete-account" className="hover:text-navy-900">Delete account</Link>
          {SUPPORT_EMAIL && (
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-navy-900">
              {SUPPORT_EMAIL}
            </a>
          )}
        </div>
      </footer>
    </div>
  );
};

/** "email us at …" when a support email is set, otherwise "contact your Managing Director". */
export const ContactLine: React.FC = () =>
  SUPPORT_EMAIL ? (
    <>
      email us at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
    </>
  ) : (
    <>contact the {COMPANY_NAME} Managing Director</>
  );
