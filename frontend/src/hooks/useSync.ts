import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../context/ToastContext.js';

export function useSync() {
  const queryClient = useQueryClient();
  const { success } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  const syncAll = useCallback(async () => {
    setIsSyncing(true);
    try {
      await queryClient.invalidateQueries();
      success('Data synchronized with SiteTrack cloud');
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setTimeout(() => setIsSyncing(false), 500);
    }
  }, [queryClient, success]);

  return { isSyncing, syncAll };
}
