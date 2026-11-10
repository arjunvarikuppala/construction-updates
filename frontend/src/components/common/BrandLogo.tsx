import React from 'react';

/**
 * BKR Infra Developers logo.
 * - `tile` (default): on a white tile, for dark backgrounds where the navy buildings would disappear.
 * - `plain`: transparent logo, for white / light backgrounds.
 */
export const BrandLogo: React.FC<{ className?: string; variant?: 'tile' | 'plain' }> = ({
  className = 'w-9 h-9',
  variant = 'tile',
}) =>
  variant === 'plain' ? (
    <img
      src="/brand/bkr-logo-transparent.png"
      alt="BKR Infra Developers"
      className={`object-contain flex-shrink-0 ${className}`}
      draggable={false}
    />
  ) : (
    <div className={`bg-white rounded-lg p-1 flex items-center justify-center flex-shrink-0 shadow-sm ring-1 ring-white/10 ${className}`}>
      <img src="/brand/bkr-logo-transparent.png" alt="BKR Infra Developers" className="w-full h-full object-contain" draggable={false} />
    </div>
  );
