import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.js';
import { AppLayout } from './components/layout/AppLayout.js';
import { Login } from './pages/Login.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { OwnerDashboard } from './pages/OwnerDashboard.js';
import { InChargeDashboard } from './pages/InChargeDashboard.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { ProjectDetailPage } from './pages/ProjectDetailPage.js';
import { DailyReportsPage } from './pages/DailyReportsPage.js';
import { DailyReportFormPage } from './pages/DailyReportFormPage.js';
import { DailyReportDetailPage } from './pages/DailyReportDetailPage.js';
import { ExpensesPage } from './pages/ExpensesPage.js';
import { ExpenseFormPage } from './pages/ExpenseFormPage.js';
import { ApprovalsPage } from './pages/ApprovalsPage.js';
import { InChargeUsersPage } from './pages/InChargeUsersPage.js';
import { AuditLogsPage } from './pages/AuditLogsPage.js';

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
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected App Shell */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
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
