import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  FileCheck2,
  ClipboardList,
  Receipt,
  Users,
  History,
  CreditCard,
  MessageSquare,
  LogOut,
  RefreshCw,
  HardHat,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useSync } from '../../hooks/useSync.js';
import { useUnreadReports } from '../../hooks/useUnreadReports.js';
import { Badge } from '../common/Badge.js';
import { UnreadDot } from '../common/UnreadDot.js';

interface SidebarProps {
  pendingApprovalsCount?: number;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: any;
  badge?: number;
  hasUnreadDot?: boolean;
  unreadCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  pendingApprovalsCount = 0,
  isMobileOpen = false,
  onMobileClose,
}) => {
  const { user, isOwner, logout } = useAuth();
  const { isSyncing, syncAll } = useSync();
  const { totalUnread } = useUnreadReports();

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileOpen) {
        onMobileClose?.();
      }
    };
    if (isMobileOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileOpen, onMobileClose]);

  const ownerLinks: NavItem[] = [
    { to: '/', label: 'Owner Dashboard', icon: LayoutDashboard },
    {
      to: '/projects',
      label: 'Projects',
      icon: Building2,
      hasUnreadDot: totalUnread > 0,
      unreadCount: totalUnread > 0 ? totalUnread : undefined,
    },
    {
      to: '/approvals',
      label: 'Expense Approvals',
      icon: FileCheck2,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
    },
    {
      to: '/reports',
      label: 'Daily Reports',
      icon: ClipboardList,
      hasUnreadDot: totalUnread > 0,
      unreadCount: totalUnread > 0 ? totalUnread : undefined,
    },
    { to: '/expenses', label: 'Expenses Register', icon: Receipt },
    { to: '/payments', label: 'Payments & Transfers', icon: CreditCard },
    { to: '/messages', label: 'Project Messages', icon: MessageSquare },
    { to: '/team', label: 'In-Charge Accounts', icon: Users },
    { to: '/audit-logs', label: 'Activity Audit Log', icon: History },
  ];

  const inChargeLinks: NavItem[] = [
    { to: '/', label: 'Site Dashboard', icon: LayoutDashboard },
    { to: '/projects', label: 'My Projects', icon: Building2 },
    { to: '/reports', label: 'Daily Reports', icon: ClipboardList },
    { to: '/expenses', label: 'My Expenses', icon: Receipt },
    { to: '/payments', label: 'Payment Requests', icon: CreditCard },
    { to: '/messages', label: 'Project Messages', icon: MessageSquare },
  ];

  const links = isOwner ? ownerLinks : inChargeLinks;

  const renderNavLinks = (onItemClick?: () => void) => (
    <div className="flex-1 py-4 sm:py-6 px-3 space-y-1 overflow-y-auto">
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
            onClick={onItemClick}
            className={({ isActive }) =>
              `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 min-h-[44px] ${
                isActive
                  ? 'bg-amber-500 text-navy-950 font-bold shadow-sm'
                  : 'text-slate-300 hover:bg-navy-900 hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-navy-950' : 'text-slate-400'}`} />
                  <span className="truncate">{link.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {link.hasUnreadDot && (
                    <div className="flex items-center gap-1.5">
                      <UnreadDot size="sm" title={`${link.unreadCount || 1} unread daily report(s)`} />
                      {link.to === '/reports' && link.unreadCount !== undefined && link.unreadCount > 0 && (
                        <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                          {link.unreadCount}
                        </span>
                      )}
                    </div>
                  )}
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
                </div>
              </>
            )}
          </NavLink>
        );
      })}
    </div>
  );

  const renderUserFooter = () => (
    <div className="p-4 border-t border-navy-900 bg-navy-950/90 flex-shrink-0">
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
          aria-label="Log out"
          className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-navy-900 rounded-lg transition-colors flex-shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-navy-950 text-slate-300 border-r border-navy-900 select-none flex-shrink-0">
        {/* Brand Header */}
        <div className="h-16 flex items-center px-6 border-b border-navy-900 gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-black shadow-sm flex-shrink-0">
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
        {renderNavLinks()}

        {/* Sync Status Button */}
        <div className="px-4 py-2 flex-shrink-0">
          <button
            onClick={syncAll}
            disabled={isSyncing}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 min-h-[38px] text-xs font-semibold rounded-lg bg-navy-900 hover:bg-navy-850 text-slate-300 border border-navy-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Synchronizing...' : 'Sync Cloud Data'}</span>
          </button>
        </div>

        {/* User Footer Profile */}
        {renderUserFooter()}
      </aside>

      {/* Mobile Accessible Collapsible Drawer */}
      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-navy-950/70 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
            onClick={onMobileClose}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <div className="relative w-4/5 max-w-xs bg-navy-950 text-slate-300 flex flex-col h-full shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            {/* Drawer Header */}
            <div className="h-16 flex items-center justify-between px-5 border-b border-navy-900 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-black shadow-sm">
                  <HardHat className="w-4 h-4 text-navy-950" />
                </div>
                <div>
                  <span className="text-base font-bold text-white flex items-center gap-1">
                    SiteTrack
                    <span className="text-[9px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1 py-0.2 rounded">
                      PRO
                    </span>
                  </span>
                  <span className="text-[10px] block text-slate-400 font-medium -mt-0.5">Mobile Navigation</span>
                </div>
              </div>

              <button
                onClick={onMobileClose}
                aria-label="Close navigation drawer"
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-white rounded-lg hover:bg-navy-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nav Links */}
            {renderNavLinks(onMobileClose)}

            {/* Sync Button */}
            <div className="px-4 py-2 border-t border-navy-900/60 flex-shrink-0">
              <button
                onClick={() => {
                  syncAll();
                  onMobileClose?.();
                }}
                disabled={isSyncing}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 min-h-[42px] text-xs font-semibold rounded-xl bg-navy-900 text-slate-300 border border-navy-800"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Synchronizing...' : 'Sync Cloud Data'}</span>
              </button>
            </div>

            {/* Profile Footer */}
            {renderUserFooter()}
          </div>
        </div>
      )}
    </>
  );
};
