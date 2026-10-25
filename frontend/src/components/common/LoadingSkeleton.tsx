import React from 'react';

export const LoadingSkeleton: React.FC<{ rows?: number; height?: string; className?: string }> = ({
  rows = 4,
  height = 'h-10',
  className = '',
}) => {
  return (
    <div className={`space-y-3 animate-pulse ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`w-full bg-slate-200/70 rounded-lg ${height}`} />
      ))}
    </div>
  );
};

export const CardSkeleton: React.FC = () => {
  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-card animate-pulse space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-4 w-28 bg-slate-200 rounded" />
        <div className="h-6 w-16 bg-slate-200 rounded-full" />
      </div>
      <div className="h-7 w-36 bg-slate-200 rounded" />
      <div className="h-3 w-48 bg-slate-200 rounded" />
    </div>
  );
};
