import React from 'react';
import { LucideIcon, FolderSearch } from 'lucide-react';
import { Button } from './Button.js';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  actionVariant?: 'primary' | 'amber';
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = FolderSearch,
  title,
  description,
  actionText,
  onAction,
  actionVariant = 'amber',
}) => {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 sm:p-12 bg-white rounded-2xl border border-dashed border-slate-300">
      <div className="w-14 h-14 rounded-2xl bg-navy-50 flex items-center justify-center text-navy-800 mb-4 border border-navy-100">
        <Icon className="w-7 h-7" />
      </div>
      <h4 className="text-base font-bold text-navy-950 mb-1">{title}</h4>
      <p className="text-sm text-slate-500 max-w-sm mb-5">{description}</p>
      {actionText && onAction && (
        <Button variant={actionVariant} onClick={onAction}>
          {actionText}
        </Button>
      )}
    </div>
  );
};
