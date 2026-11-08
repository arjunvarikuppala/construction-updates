import React from 'react';
import { HardHat, RefreshCw, LogOut, Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useSync } from '../../hooks/useSync.js';
import { useUnreadReports } from '../../hooks/useUnreadReports.js';
import { Badge } from '../common/Badge.js';
import { NotificationCenter } from './NotificationCenter.js';

interface TopHeaderProps {
  onOpenMobileDrawer?: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ onOpenMobileDrawer }) => {
  const { user, activeRole, isMD, isOwner, logout } = useAuth();
  const { isSyncing, syncAll } = useSync();
  const { totalUnread } = useUnreadReports();

  return (
    <header className="h-[calc(4rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] bg-white border-b border-slate-200/90 px-2.5 sm:px-6 flex items-center justify-between fixed top-0 inset-x-0 z-40 md:sticky md:top-0 md:z-30 shadow-xs flex-shrink-0 transition-all">
      {/* Mobile Brand / Desktop Title */}
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
        {/* Mobile Hamburger Drawer Trigger */}
        <button
          onClick={onOpenMobileDrawer}
          aria-label="Open navigation menu"
          className="relative md:hidden p-1.5 sm:p-2 rounded-xl text-slate-600 hover:text-navy-950 hover:bg-slate-100 min-w-[40px] min-h-[40px] sm:min-w-[44px] sm:min-h-[44px] flex items-center justify-center transition-colors -ml-1 shrink-0"
        >
          <Menu className="w-5 h-5" />
          {(isMD || isOwner) && totalUnread > 0 && (
            <span
              className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white animate-pulse"
              title={`${totalUnread} unread daily report(s)`}
            />
          )}
        </button>

        <div className="md:hidden flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-navy-900 text-amber-500 flex items-center justify-center font-bold flex-shrink-0">
            <HardHat className="w-4 h-4" />
          </div>
          <span className="font-bold text-navy-950 text-sm sm:text-base tracking-tight">SiteTrack</span>
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap min-w-0">
          <span className="font-semibold text-navy-900">Enterprise Workspace</span>
          <span className="hidden xl:inline">/</span>
          <span className="hidden xl:inline truncate">Real-time Construction Operations</span>
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-1 sm:gap-2.5 flex-shrink-0">
        {/* Notification Bell Center */}
        <NotificationCenter />

        {/* Sync Indicator */}
        <button
          onClick={syncAll}
          disabled={isSyncing}
          title="Force near-real-time synchronization"
          aria-label="Synchronize data"
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 min-w-[38px] min-h-[38px] sm:min-h-[40px] rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-500 ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
        </button>

        {/* User Identity & Role Badge */}
        <div className="hidden sm:flex items-center gap-2">
          {user?.name && (
            <span className="text-xs font-semibold text-slate-700 truncate max-w-[160px]" title={user.email}>
              {user.name}
            </span>
          )}
          <Badge role={activeRole} size="sm" />
        </div>

        {/* Desktop Logout / Switch Account */}
        <button
          onClick={logout}
          title="Sign out / Switch account"
          aria-label="Sign out"
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 min-h-[40px] rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Logout</span>
        </button>

        {/* Mobile Logout */}
        <button
          onClick={logout}
          title="Sign out"
          aria-label="Sign out"
          className="md:hidden p-1.5 sm:p-2 min-w-[40px] min-h-[40px] sm:min-w-[44px] sm:min-h-[44px] flex items-center justify-center text-slate-500 hover:text-rose-600 rounded-lg hover:bg-slate-100 shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
