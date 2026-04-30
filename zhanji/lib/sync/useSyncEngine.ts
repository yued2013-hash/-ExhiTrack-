import { useEffect } from 'react';

import { useUserId } from '@/lib/auth';

import { startSyncEngine } from './index';

export function useSyncEngine() {
  const userId = useUserId();
  useEffect(() => {
    if (!userId) return;
    return startSyncEngine(userId);
  }, [userId]);
}
