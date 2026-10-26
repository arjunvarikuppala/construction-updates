import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  FileCheck2,
  ClipboardList,
  Receipt,
  Users,
  History,
  LogOut,
  RefreshCw,
  HardHat,
  Banknote,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useSync } from '../../hooks/useSync.js';
import { Badge } from '../common/Badge.js';

interface SidebarProps {
  pendingApprovalsCount?: number;
}

interface NavItem {
  to: string;
  label: string;
  icon: any;
  badge?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ pendingApprovalsCount = 0 }) => {
  const { user, isOwner, logout } = useAuth();
  const { isSyncing, syncAll } = useSync();

  const ownerLinks: NavItem[] = [
    { to: '/', label: 'Owner Dashboard', icon: LayoutDashboard },
    { to: '/projects', label: 'Projects', icon: Building2 },
    {
      to: '/approvals',
      label: 'Expense Approvals',
      icon: FileCheck2,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
    },
    { to: '/reports', label: 'Daily Reports', icon: ClipboardList },
    { to: '/expenses', label: 'Expenses Register', icon: Receipt },
    { to: '/payments', label: 'Vendor Payouts', icon: Banknote },
    { to: '/team', label: 'In-Charge Accounts', icon: Users },
    { to: '/audit-logs', label: 'Activity Audit Log', icon: History },
  ];

  const inChargeLinks: NavItem[] = [
    { to: '/', label: 'Site Dashboard', icon: LayoutDashboard },
    { to: '/projects', label: 'My Projects', icon: Building2 },
    { to: '/reports', label: 'Daily Reports', icon: ClipboardList },
    { to: '/expenses', label: 'My Expenses', icon: Receipt },
    { to: '/payments', label: 'Payment Requests', icon: Banknote },
  ];

  const links = isOwner ? ownerLinks : inChargeLinks;

  return (
    <aside className="hidden md:flex flex-col w-64 bg-navy-950 text-slate-300 border-r border-navy-900 select-none">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-navy-900 gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-black shadow-sm">
          <HardHat className="w-5 h-5 text-navy-950" />
        </div>
        <div>
          <span className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
            SiteTrack
            <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.2 rounded">
              PRO
            </span>
          </span>
          <span className="text-[11px] block text-slate-400 font-medium -mt-0.5">Construction PM SaaS</span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-6 px-3 space-y-1.5 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
          {isOwner ? 'Executive Management' : 'Site Operations'}
        </div>

        {links.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-amber-500 text-navy-950 font-semibold shadow-sm'
                    : 'text-slate-300 hover:bg-navy-900 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-navy-950' : 'text-slate-400'}`} />
                    <span>{link.label}</span>
                  </div>
                  {link.badge !== undefined && (
                    <span
                      className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                        isActive
                          ? 'bg-navy-950 text-amber-400'
                          : 'bg-amber-500 text-navy-950'
                      }`}
                    >
                      {link.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>

      {/* Sync Status Button */}
      <div className="px-4 py-2">
        <button
          onClick={syncAll}
          disabled={isSyncing}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg bg-navy-900 hover:bg-navy-850 text-slate-300 border border-navy-800 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Synchronizing...' : 'Sync Cloud Data'}</span>
        </button>
      </div>

      {/* User Footer Profile */}
      <div className="p-4 border-t border-navy-900 bg-navy-950/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-full bg-navy-800 border border-navy-700 flex items-center justify-center font-bold text-amber-400 flex-shrink-0">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user?.name || 'User'}</p>
              <Badge role={user?.role} size="sm" className="mt-0.5" />
            </div>
          </div>
          <button
            onClick={logout}
            title="Log out"
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-navy-900 rounded-lg transition-colors flex-shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
