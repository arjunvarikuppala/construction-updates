import React, { useState, useEffect, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Close mobile drawer on navigation
  useEffect(() => {
    setIsMobileDrawerOpen(false);
  }, [location.pathname]);

  // Query pending approvals for badge count with near-real-time synchronization (20s interval + window focus)
  const { data: approvalsData } = useQuery({
    queryKey: ['pending-approvals-count'],
    queryFn: () => api.get<{ count: number; expenses: any[] }>('/expenses?status=PENDING'),
    enabled: isOwner,
    refetchInterval: 20000,
  });

  const pendingCount = approvalsData?.count || 0;
  const isMessagesPage = location.pathname.startsWith('/messages');

  return (
    <div className="flex h-screen h-[100dvh] overflow-hidden bg-background">
      {/* Desktop Sidebar & Mobile Collapsible Drawer */}
      <Sidebar
        pendingApprovalsCount={pendingCount}
        isMobileOpen={isMobileDrawerOpen}
        onMobileClose={() => setIsMobileDrawerOpen(false)}
      />

      {/* Main Layout Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 relative">
        <OfflineBanner />
        <TopHeader onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)} />

        {/* Scrollable Viewport with Top Header Clearance & Bottom Nav Clearance */}
        <main
          className={`flex-1 min-w-0 ${
            isMessagesPage
              ? 'overflow-hidden p-2 sm:p-4 md:p-6 pt-[calc(4.5rem+env(safe-area-inset-top,0px))] md:pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-6 flex flex-col min-h-0'
              : 'overflow-y-auto px-3 py-4 sm:px-6 sm:py-6 pt-[calc(4.75rem+env(safe-area-inset-top,0px))] md:pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:pb-8'
          }`}
        >
          <div className={`max-w-7xl mx-auto w-full ${isMessagesPage ? 'h-full flex flex-col flex-1 min-h-0' : ''}`}>
            <Suspense
              fallback={
                <div className="flex-1 flex items-center justify-center py-24" role="status" aria-label="Loading page">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
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
