import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  onClick,
  hoverable = false,
}) => {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-slate-200/80 shadow-card overflow-hidden ${
        hoverable ? 'hover:shadow-card-hover hover:border-slate-300 transition-all cursor-pointer' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => {
  return (
    <div className={`p-3.5 sm:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 ${className}`}>
      {children}
    </div>
  );
};

export const CardTitle: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => {
  return <h3 className={`text-base font-semibold text-navy-950 tracking-tight ${className}`}>{children}</h3>;
};

export const CardDescription: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => {
  return <p className={`text-xs text-slate-500 mt-0.5 ${className}`}>{children}</p>;
};

export const CardContent: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => {
  return <div className={`p-3.5 sm:p-5 ${className}`}>{children}</div>;
};

export const CardFooter: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className = '' }) => {
  return (
    <div className={`p-3.5 sm:p-5 bg-slate-50/60 border-t border-slate-100 rounded-b-2xl flex flex-wrap items-center justify-between gap-3 ${className}`}>
      {children}
    </div>
  );
};
