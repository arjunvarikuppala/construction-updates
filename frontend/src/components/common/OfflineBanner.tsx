import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOffline } from '../../hooks/useOffline.js';

export const OfflineBanner: React.FC = () => {
  const isOffline = useOffline();

  if (!isOffline) return null;

  return (
    <div className="bg-amber-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 shadow-sm sticky top-0 z-50">
      <WifiOff className="w-4 h-4 animate-bounce" />
      <span>You are currently offline. SiteTrack will automatically synchronize when connectivity is restored.</span>
    </div>
  );
};
