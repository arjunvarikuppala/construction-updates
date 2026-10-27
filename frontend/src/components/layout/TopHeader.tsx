import React from 'react';
import { HardHat, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useSync } from '../../hooks/useSync.js';
import { Badge } from '../common/Badge.js';
import { NotificationCenter } from './NotificationCenter.js';

export const TopHeader: React.FC = () => {
  const { user, logout } = useAuth();
  const { isSyncing, syncAll } = useSync();

  return (
    <header className="h-16 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      {/* Mobile Brand / Desktop Title */}
      <div className="flex items-center gap-3">
        <div className="md:hidden flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-navy-900 text-amber-500 flex items-center justify-center font-bold">
            <HardHat className="w-4 h-4" />
          </div>
          <span className="font-bold text-navy-950 text-base">SiteTrack</span>
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-navy-900">Enterprise Workspace</span>
          <span>/</span>
          <span>Real-time Construction Operations</span>
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-3">
        {/* Notification Bell Center */}
        <NotificationCenter />

        {/* Sync Indicator */}
        <button
          onClick={syncAll}
          disabled={isSyncing}
          title="Force near-real-time synchronization"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-500 ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
        </button>

        {/* User Role Badge */}
        <div className="hidden sm:block">
          <Badge role={user?.role} size="sm" />
        </div>

        {/* Mobile Logout */}
        <button
          onClick={logout}
          title="Sign out"
          className="md:hidden p-2 text-slate-500 hover:text-rose-600 rounded-lg hover:bg-slate-100"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
