import React from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './Sidebar.js';
import { TopHeader } from './TopHeader.js';
import { MobileBottomNav } from './MobileBottomNav.js';
import { OfflineBanner } from '../common/OfflineBanner.js';
import { PWAInstallPrompt } from '../common/PWAInstallPrompt.js';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../api/client.js';

export const AppLayout: React.FC = () => {
  const { isOwner } = useAuth();

  // Query pending approvals for badge count with near-real-time synchronization (20s interval + window focus)
  const { data: approvalsData } = useQuery({
    queryKey: ['pending-approvals-count'],
    queryFn: () => api.get<{ count: number; expenses: any[] }>('/expenses?status=PENDING'),
    enabled: isOwner,
    refetchInterval: 20000,
  });

  const pendingCount = approvalsData?.count || 0;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <Sidebar pendingApprovalsCount={pendingCount} />

      {/* Main Layout Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <OfflineBanner />
        <TopHeader />

        {/* Scrollable Viewport */}
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 pb-28 md:pb-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>

        {/* Mobile Persistent Bottom Nav */}
        <MobileBottomNav pendingApprovalsCount={pendingCount} />

        {/* PWA Install Notification Prompt */}
        <PWAInstallPrompt />
      </div>
    </div>
  );
};
