import React from 'react';
import { ProjectStatus, ExpenseStatus, ReportStatus, ExpenseCategory, UserRole } from '../../types/index.js';

interface BadgeProps {
  children?: React.ReactNode;
  variant?: 'status' | 'category' | 'role' | 'default';
  status?: ProjectStatus | ExpenseStatus | ReportStatus | string;
  category?: ExpenseCategory | string;
  role?: UserRole | string;
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  status,
  category,
  role,
  size = 'md',
  className = '',
}) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  // Role badges
  if (role) {
    if (role === 'OWNER' || role === 'MD') {
      return (
        <span className={`inline-flex items-center font-semibold rounded-md bg-navy-100 text-navy-900 border border-navy-300 ${sizeClasses} ${className}`}>
          Managing Director
        </span>
      );
    }
    return (
      <span className={`inline-flex items-center font-medium rounded-md bg-amber-100 text-amber-900 border border-amber-300 ${sizeClasses} ${className}`}>
        Site In-Charge
      </span>
    );
  }

  // Category badges
  if (category) {
    const formatted = category.replace(/_/g, ' ');
    return (
      <span className={`inline-flex items-center font-medium rounded-md bg-slate-100 text-slate-800 border border-slate-200 ${sizeClasses} ${className}`}>
        {formatted}
      </span>
    );
  }

  // Status badges
  if (status) {
    switch (status) {
      case 'APPROVED':
        return (
          <span className={`inline-flex items-center font-semibold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 ${sizeClasses} ${className}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
            Approved
          </span>
        );
      case 'PENDING':
        return (
          <span className={`inline-flex items-center font-semibold rounded-md bg-amber-50 text-amber-800 border border-amber-200 ${sizeClasses} ${className}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 animate-pulse"></span>
            Pending Approval
          </span>
        );
      case 'REJECTED':
        return (
          <span className={`inline-flex items-center font-semibold rounded-md bg-rose-50 text-rose-700 border border-rose-200 ${sizeClasses} ${className}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mr-1.5"></span>
            Rejected
          </span>
        );
      case 'DRAFT':
        return (
          <span className={`inline-flex items-center font-medium rounded-md bg-slate-100 text-slate-600 border border-slate-300 ${sizeClasses} ${className}`}>
            Draft
          </span>
        );
      case 'SUBMITTED':
        return (
          <span className={`inline-flex items-center font-semibold rounded-md bg-blue-50 text-blue-700 border border-blue-200 ${sizeClasses} ${className}`}>
            Submitted
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className={`inline-flex items-center font-semibold rounded-md bg-emerald-50 text-emerald-800 border border-emerald-300 ${sizeClasses} ${className}`}>
            Active / In Progress
          </span>
        );
      case 'PLANNING':
        return (
          <span className={`inline-flex items-center font-medium rounded-md bg-sky-50 text-sky-700 border border-sky-200 ${sizeClasses} ${className}`}>
            Planning
          </span>
        );
      case 'ON_HOLD':
        return (
          <span className={`inline-flex items-center font-medium rounded-md bg-amber-50 text-amber-700 border border-amber-300 ${sizeClasses} ${className}`}>
            On Hold
          </span>
        );
      case 'COMPLETED':
        return (
          <span className={`inline-flex items-center font-semibold rounded-md bg-slate-100 text-slate-800 border border-slate-300 ${sizeClasses} ${className}`}>
            Completed
          </span>
        );
      default:
        return (
          <span className={`inline-flex items-center font-medium rounded-md bg-slate-100 text-slate-700 border border-slate-200 ${sizeClasses} ${className}`}>
            {status}
          </span>
        );
    }
  }

  return (
    <span className={`inline-flex items-center font-medium rounded-md bg-slate-100 text-slate-700 border border-slate-200 ${sizeClasses} ${className}`}>
      {children}
    </span>
  );
};
