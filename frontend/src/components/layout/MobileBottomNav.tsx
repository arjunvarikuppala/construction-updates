import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  ClipboardList,
  Receipt,
  FileCheck2,
  Plus,
  FileText,
  DollarSign,
  CreditCard,
  MessageSquare,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

interface MobileBottomNavProps {
  pendingApprovalsCount?: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ pendingApprovalsCount = 0 }) => {
  const { isOwner, isInCharge } = useAuth();
  const navigate = useNavigate();
  const [showActionSheet, setShowActionSheet] = useState(false);

  return (
    <>
      {/* Mobile Action Sheet Backdrop & Modal */}
      {showActionSheet && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-navy-950/70 backdrop-blur-xs flex flex-col justify-end p-4 animate-in fade-in"
          onClick={() => setShowActionSheet(false)}
        >
          <div
            className="bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-4 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-sm font-bold text-navy-950">Quick Site Actions</h4>
              <button
                onClick={() => setShowActionSheet(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => {
                  setShowActionSheet(false);
                  navigate('/reports/new');
                }}
                className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-950 text-center transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center mb-1.5 shadow-sm font-bold">
                  <FileText className="w-5 h-5" />
                </div>
                <span className="text-xs font-bold">Daily Report</span>
                <span className="text-[10px] text-amber-800 mt-0.5">Submit site log & photos</span>
              </button>

              <button
                onClick={() => {
                  setShowActionSheet(false);
                  navigate('/expenses/new');
                }}
                className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-navy-50 hover:bg-navy-100 border border-navy-200 text-navy-950 text-center transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-navy-900 text-amber-400 flex items-center justify-center mb-1.5 shadow-sm font-bold">
                  <DollarSign className="w-5 h-5" />
                </div>
                <span className="text-xs font-bold">Site Expense</span>
                <span className="text-[10px] text-navy-700 mt-0.5">Upload receipt & bill</span>
              </button>

              <button
                onClick={() => {
                  setShowActionSheet(false);
                  navigate('/payments');
                }}
                className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-950 text-center transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center mb-1.5 shadow-sm font-bold">
                  <CreditCard className="w-5 h-5" />
                </div>
                <span className="text-xs font-bold">Payment Request</span>
                <span className="text-[10px] text-emerald-800 mt-0.5">NEFT / RTGS / UPI</span>
              </button>

              <button
                onClick={() => {
                  setShowActionSheet(false);
                  navigate('/messages');
                }}
                className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-950 text-center transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center mb-1.5 shadow-sm font-bold">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <span className="text-xs font-bold">Project Chat</span>
                <span className="text-[10px] text-sky-800 mt-0.5">Message MD & site team</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Bottom Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200/90 shadow-lg z-40 px-2 py-1.5 pb-safe flex items-center justify-around select-none">
        {/* Tab 1: Dashboard */}
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold transition-colors ${
              isActive ? 'text-navy-900 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`
          }
        >
          <LayoutDashboard className="w-5 h-5 mb-0.5" />
          <span>Home</span>
        </NavLink>

        {/* Tab 2: Projects / Approvals */}
        {isOwner ? (
          <NavLink
            to="/approvals"
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold transition-colors ${
                isActive ? 'text-navy-900 font-bold' : 'text-slate-400 hover:text-slate-600'
              }`
            }
          >
            <FileCheck2 className="w-5 h-5 mb-0.5" />
            <span>Approvals</span>
            {pendingApprovalsCount > 0 && (
              <span className="absolute top-0 right-2 w-4 h-4 rounded-full bg-amber-500 text-navy-950 font-bold text-[9px] flex items-center justify-center">
                {pendingApprovalsCount}
              </span>
            )}
          </NavLink>
        ) : (
          <NavLink
            to="/projects"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold transition-colors ${
                isActive ? 'text-navy-900 font-bold' : 'text-slate-400 hover:text-slate-600'
              }`
            }
          >
            <Building2 className="w-5 h-5 mb-0.5" />
            <span>Projects</span>
          </NavLink>
        )}

        {/* Center Action Button for In-Charge */}
        {isInCharge && (
          <button
            onClick={() => setShowActionSheet(true)}
            aria-label="Quick Action"
            className="-mt-5 w-12 h-12 rounded-full bg-amber-500 text-navy-950 flex items-center justify-center shadow-lg border-2 border-white active:scale-95 transition-transform"
          >
            <Plus className="w-6 h-6 stroke-[2.5]" />
          </button>
        )}

        {/* Tab 3: Payments */}
        <NavLink
          to="/payments"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold transition-colors ${
              isActive ? 'text-navy-900 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`
          }
        >
          <CreditCard className="w-5 h-5 mb-0.5" />
          <span>Payments</span>
        </NavLink>

        {/* Tab 4: Messages */}
        <NavLink
          to="/messages"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-semibold transition-colors ${
              isActive ? 'text-navy-900 font-bold' : 'text-slate-400 hover:text-slate-600'
            }`
          }
        >
          <MessageSquare className="w-5 h-5 mb-0.5" />
          <span>Messages</span>
        </NavLink>
      </nav>
    </>
  );
};
