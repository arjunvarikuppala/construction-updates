import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.js';
import { AppLayout } from './components/layout/AppLayout.js';
import { Login } from './pages/Login.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';

// Route-level code splitting: each page loads only when first visited
const RegisterPage = lazy(() => import('./pages/RegisterPage.js').then((m) => ({ default: m.RegisterPage })));
const OwnerDashboard = lazy(() => import('./pages/OwnerDashboard.js').then((m) => ({ default: m.OwnerDashboard })));
const InChargeDashboard = lazy(() => import('./pages/InChargeDashboard.js').then((m) => ({ default: m.InChargeDashboard })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage.js').then((m) => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage.js').then((m) => ({ default: m.ProjectDetailPage })));
const DailyReportsPage = lazy(() => import('./pages/DailyReportsPage.js').then((m) => ({ default: m.DailyReportsPage })));
const DailyReportFormPage = lazy(() => import('./pages/DailyReportFormPage.js').then((m) => ({ default: m.DailyReportFormPage })));
const DailyReportDetailPage = lazy(() => import('./pages/DailyReportDetailPage.js').then((m) => ({ default: m.DailyReportDetailPage })));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage.js').then((m) => ({ default: m.ExpensesPage })));
const ExpenseFormPage = lazy(() => import('./pages/ExpenseFormPage.js').then((m) => ({ default: m.ExpenseFormPage })));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage.js').then((m) => ({ default: m.ApprovalsPage })));
const InChargeUsersPage = lazy(() => import('./pages/InChargeUsersPage.js').then((m) => ({ default: m.InChargeUsersPage })));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage.js').then((m) => ({ default: m.AuditLogsPage })));
const PaymentsPage = lazy(() => import('./pages/PaymentsPage.js').then((m) => ({ default: m.PaymentsPage })));
const ProjectMessagesPage = lazy(() => import('./pages/ProjectMessagesPage.js').then((m) => ({ default: m.ProjectMessagesPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage.js').then((m) => ({ default: m.NotificationsPage })));

// Protected Route Guard
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-navy-900 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-xs font-semibold text-navy-950">Initializing SiteTrack session...</p>
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Owner Role Guard
const OwnerRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isOwner } = useAuth();
  if (!isOwner) return <Navigate to="/" replace />;
  return <>{children}</>;
};

export const App: React.FC = () => {
  const { isOwner } = useAuth();

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />
      <Route
        path="/register"
        element={
          <Suspense fallback={null}>
            <RegisterPage />
          </Suspense>
        }
      />

      {/* Protected App Shell */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <ErrorBoundary level="page">
              <AppLayout />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      >
        {/* Role-adaptive Home Dashboard */}
        <Route index element={isOwner ? <OwnerDashboard /> : <InChargeDashboard />} />

        {/* Projects */}
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />

        {/* Daily Reports */}
        <Route path="reports" element={<DailyReportsPage />} />
        <Route path="reports/new" element={<DailyReportFormPage />} />
        <Route path="reports/:id" element={<DailyReportDetailPage />} />

        {/* Expenses */}
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="expenses/new" element={<ExpenseFormPage />} />

        {/* Payments & Financial Transfers */}
        <Route path="payments" element={<PaymentsPage />} />

        {/* Project Communication */}
        <Route path="messages" element={<ProjectMessagesPage />} />
        <Route path="messages/:projectId" element={<ProjectMessagesPage />} />

        {/* Notifications History */}
        <Route path="notifications" element={<NotificationsPage />} />

        {/* Owner Executive Approvals */}
        <Route
          path="approvals"
          element={
            <OwnerRoute>
              <ApprovalsPage />
            </OwnerRoute>
          }
        />

        {/* In-Charge Team Management */}
        <Route
          path="team"
          element={
            <OwnerRoute>
              <InChargeUsersPage />
            </OwnerRoute>
          }
        />


        {/* Audit Trail */}
        <Route
          path="audit-logs"
          element={
            <OwnerRoute>
              <AuditLogsPage />
            </OwnerRoute>
          }
        />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
