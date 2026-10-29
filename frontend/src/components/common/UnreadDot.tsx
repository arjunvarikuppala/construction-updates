import React from 'react';
import { useAuth } from '../../context/AuthContext.js';

interface UnreadDotProps {
  count?: number;
  showCount?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
  title?: string;
  pulse?: boolean;
}

export const UnreadDot: React.FC<UnreadDotProps> = ({
  count,
  showCount = false,
  className = '',
  size = 'md',
  ariaLabel,
  title,
  pulse = true,
}) => {
  const { isMD, isOwner } = useAuth();

  // Role-specific enforcement: Site In-Charge must NEVER see orange unread dots or unread count badges anywhere
  if (!isMD && !isOwner) {
    return null;
  }

  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-2.5 h-2.5',
    lg: 'w-3 h-3',
  }[size];

  const label =
    title ||
    ariaLabel ||
    (count && count > 0
      ? `${count} unread daily report${count > 1 ? 's' : ''}`
      : 'Unread daily report');

  if (showCount && count !== undefined && count > 0) {
    return (
      <span
        className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black bg-amber-500 text-white shadow-2xs ${className}`}
        title={label}
        aria-label={label}
      >
        {count}
      </span>
    );
  }

  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      title={label}
      aria-label={label}
    >
      {pulse && (
        <span
          className={`absolute inline-flex rounded-full bg-amber-400 opacity-75 animate-ping ${sizeClasses}`}
        />
      )}
      <span
        className={`relative inline-flex rounded-full bg-amber-500 ring-2 ring-white ${sizeClasses}`}
      />
    </span>
  );
};
