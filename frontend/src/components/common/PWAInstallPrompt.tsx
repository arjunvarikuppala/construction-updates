import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from './Button.js';

export const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (!deferredPrompt || isDismissed) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 left-4 md:left-auto md:max-w-md bg-navy-900 text-white p-4 rounded-2xl shadow-2xl border border-navy-700/80 z-40 animate-in slide-in-from-bottom-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-navy-950 flex items-center justify-center font-bold flex-shrink-0">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Install SiteTrack App</h4>
            <p className="text-xs text-navy-200 mt-0.5">
              Add SiteTrack to your home screen for rapid offline site reporting and instant sync.
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsDismissed(true)}
          className="text-navy-300 hover:text-white p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" className="text-navy-200 hover:text-white" onClick={() => setIsDismissed(true)}>
          Not now
        </Button>
        <Button variant="amber" size="sm" onClick={handleInstallClick} leftIcon={<Download className="w-3.5 h-3.5" />}>
          Install App
        </Button>
      </div>
    </div>
  );
};
