import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import { resetFailedRetries } from '@/lib/db/exhibitions';
import { queryClient } from '@/lib/queryClient';

import {
  pullExhibitions,
  pushPendingExhibitions,
  type PullResult,
  type SyncResult,
} from './exhibitions';

let running = false;

export type RunSyncOptions = { pull?: boolean };

export type RunSyncOutcome = {
  push: SyncResult | null;
  pull: PullResult | null;
};

function invalidateSyncRelated() {
  queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
  queryClient.invalidateQueries({ queryKey: ['sync-status'] });
}

export async function runSync(
  userId: string | undefined,
  opts: RunSyncOptions = {},
): Promise<RunSyncOutcome | null> {
  const { pull = true } = opts;
  console.log('[sync] runSync called', { userId, running, pull });
  if (!userId) {
    console.log('[sync] skip: no userId');
    return null;
  }
  if (running) {
    console.log('[sync] skip: already running');
    return null;
  }
  running = true;
  try {
    const netState = await NetInfo.fetch();
    console.log('[sync] runSync triggered', {
      isConnected: netState.isConnected,
      isInternetReachable: netState.isInternetReachable,
      type: netState.type,
    });
    if (netState.isConnected === false) {
      console.log('[sync] skip: not connected');
      return null;
    }

    const pushResult = await pushPendingExhibitions(userId);
    console.log('[sync] push result', pushResult);

    let pullResult: PullResult | null = null;
    if (pull) {
      pullResult = await pullExhibitions(userId);
      console.log('[sync] pull result', pullResult);
      // If pull surfaced rows that need pushing (e.g. resynced deletes),
      // do one more push pass.
      if (pullResult.resyncedDelete > 0) {
        const followup = await pushPendingExhibitions(userId);
        console.log('[sync] followup push after pull', followup);
      }
    }

    invalidateSyncRelated();
    return { push: pushResult, pull: pullResult };
  } catch (e) {
    console.error('[sync] runSync error', e);
    return null;
  } finally {
    running = false;
  }
}

export async function runManualSync(
  userId: string | undefined,
): Promise<RunSyncOutcome | null> {
  if (!userId) return null;
  console.log('[sync] manual sync requested');
  await resetFailedRetries(userId);
  invalidateSyncRelated();
  return runSync(userId, { pull: true });
}

export function startSyncEngine(userId: string): () => void {
  console.log('[sync] engine starting for', userId);
  const fire = (reason: string) => {
    console.log('[sync] trigger:', reason);
    runSync(userId, { pull: true }).catch((e) =>
      console.error('[sync] fire error', e),
    );
  };

  fire('initial');

  // Only treat as reconnect on offline → online transition.
  // Optimistic default avoids a duplicate trigger right after `fire('initial')`,
  // since addEventListener immediately delivers the current state.
  let prevOnline = true;
  const netUnsub = NetInfo.addEventListener((state) => {
    const online =
      state.isConnected === true && state.isInternetReachable !== false;
    if (!prevOnline && online) {
      fire('network-reconnect');
    }
    prevOnline = online;
  });

  const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') fire('app-foreground');
  });

  return () => {
    console.log('[sync] engine stopping');
    netUnsub();
    appStateSub.remove();
  };
}
