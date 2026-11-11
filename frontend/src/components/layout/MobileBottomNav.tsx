import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  FileCheck2,
  Plus,
  FileText,
  IndianRupee,
  CreditCard,
  MessageSquare,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useUnreadReports } from '../../hooks/useUnreadReports.js';

interface MobileBottomNavProps {
  pendingApprovalsCount?: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ pendingApprovalsCount = 0 }) => {
  const { isOwner } = useAuth();
  const { totalUnread } = useUnreadReports();
  const navigate = useNavigate();
  const [showActionSheet, setShowActionSheet] = useState(false);

  return (
    <>
      {/* Mobile Action Sheet Backdrop & Modal */}
      {showActionSheet && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-navy-950/70 backdrop-blur-xs flex flex-col justify-end p-3 sm:p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] animate-in fade-in"
          onClick={() => setShowActionSheet(false)}
        >
          <div
            className="bg-white rounded-3xl p-4 sm:p-5 shadow-2xl border border-slate-200 space-y-3.5 max-h-[85dvh] overflow-y-auto animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-sm font-bold text-navy-950">Quick Site Actions</h4>
              <button
                onClick={() => setShowActionSheet(false)}
                className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
                aria-label="Close quick actions"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 pt-1">
              <button
                onClick={() => {
                  setShowActionSheet(false);
                  navigate('/reports/new');
                }}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-brand-50 hover:bg-brand-100 active:bg-brand-200 border border-brand-200 text-brand-950 text-center transition-colors min-h-[96px]"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center mb-1.5 shadow-xs font-bold">
                  <FileText className="w-5 h-5" />
                </div>
                <span className="text-xs font-bold">Daily Report</span>
                <span className="text-[10px] text-brand-800 mt-0.5 line-clamp-1">Submit site log & photos</span>
              </button>

              <button
                onClick={() => {
                  setShowActionSheet(false);
                  navigate('/expenses/new');
                }}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-navy-50 hover:bg-navy-100 active:bg-navy-200 border border-navy-200 text-navy-950 text-center transition-colors min-h-[96px]"
              >
                <div className="w-10 h-10 rounded-xl bg-navy-900 text-brand-400 flex items-center justify-center mb-1.5 shadow-xs font-bold">
                  <IndianRupee className="w-5 h-5" />
                </div>
                <span className="text-xs font-bold">Site Expense</span>
                <span className="text-[10px] text-navy-700 mt-0.5 line-clamp-1">Upload receipt & bill</span>
              </button>

              {isOwner ? (
                <button
                  onClick={() => {
                    setShowActionSheet(false);
                    navigate('/approvals');
                  }}
                  className="flex flex-col items-center justify-center p-3 rounded-2xl bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-200 text-emerald-950 text-center transition-colors min-h-[96px]"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center mb-1.5 shadow-xs font-bold">
                    <FileCheck2 className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold">Approvals</span>
                  <span className="text-[10px] text-emerald-800 mt-0.5 line-clamp-1">
                    {pendingApprovalsCount > 0 ? `${pendingApprovalsCount} pending review` : 'Verify expense claims'}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowActionSheet(false);
                    navigate('/payments');
                  }}
                  className="flex flex-col items-center justify-center p-3 rounded-2xl bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-200 text-emerald-950 text-center transition-colors min-h-[96px]"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center mb-1.5 shadow-xs font-bold">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold">Payment Request</span>
                  <span className="text-[10px] text-emerald-800 mt-0.5 line-clamp-1">NEFT / RTGS / UPI</span>
                </button>
              )}

              <button
                onClick={() => {
                  setShowActionSheet(false);
                  navigate('/messages');
                }}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-sky-50 hover:bg-sky-100 active:bg-sky-200 border border-sky-200 text-sky-950 text-center transition-colors min-h-[96px]"
              >
                <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center mb-1.5 shadow-xs font-bold">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <span className="text-xs font-bold">Project Chat</span>
                <span className="text-[10px] text-sky-800 mt-0.5 line-clamp-1">Message MD & site team</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Bottom Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-lg z-40 px-1 py-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] flex items-center justify-between select-none">
        {/* Tab 1: Dashboard */}
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center min-w-0 py-1 px-1 rounded-xl text-[10px] font-semibold transition-colors ${
              isActive ? 'text-navy-900 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`
          }
        >
          <LayoutDashboard className="w-5 h-5 mb-0.5 shrink-0" />
          <span className="truncate">Home</span>
        </NavLink>

        {/* Tab 2: Projects */}
        <NavLink
          to="/projects"
          className={({ isActive }) =>
            `relative flex-1 flex flex-col items-center justify-center min-w-0 py-1 px-1 rounded-xl text-[10px] font-semibold transition-colors ${
              isActive ? 'text-navy-900 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`
          }
        >
          <Building2 className="w-5 h-5 mb-0.5 shrink-0" />
          <span className="truncate">Projects</span>
          {isOwner && totalUnread > 0 && (
            <span
              className="absolute top-1 right-2 sm:right-4 w-2 h-2 rounded-full bg-brand-600 ring-2 ring-white"
              title={`${totalUnread} unread daily report(s)`}
            />
          )}
        </NavLink>

        {/* Center Action Button (Visually prominent & centered for all roles) */}
        <div className="flex items-center justify-center px-1 shrink-0">
          <button
            onClick={() => setShowActionSheet(true)}
            aria-label="Quick Action Menu"
            className="-mt-5 w-12 h-12 rounded-full bg-brand-600 text-white flex items-center justify-center shadow-lg border-2 border-white active:scale-95 transition-transform hover:bg-brand-700 shrink-0"
          >
            <Plus className="w-6 h-6 stroke-[2.5]" />
          </button>
        </div>

        {/* Tab 3: Payments */}
        <NavLink
          to="/payments"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center min-w-0 py-1 px-1 rounded-xl text-[10px] font-semibold transition-colors ${
              isActive ? 'text-navy-900 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`
          }
        >
          <CreditCard className="w-5 h-5 mb-0.5 shrink-0" />
          <span className="truncate">Payments</span>
        </NavLink>

        {/* Tab 4: Messages */}
        <NavLink
          to="/messages"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center min-w-0 py-1 px-1 rounded-xl text-[10px] font-semibold transition-colors ${
              isActive ? 'text-navy-900 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`
          }
        >
          <MessageSquare className="w-5 h-5 mb-0.5 shrink-0" />
          <span className="truncate">Messages</span>
        </NavLink>
      </nav>
    </>
  );
};
