import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import { resetFailedArtifactRetries } from '@/lib/db/artifacts';
import { resetFailedRetries } from '@/lib/db/exhibitions';
import { resetFailedImpressionRetries } from '@/lib/db/impressions';
import { queryClient } from '@/lib/queryClient';

import {
  pullArtifacts,
  pushPendingArtifacts,
} from './artifacts';
import {
  pullExhibitions,
  pushPendingExhibitions,
  type PullResult,
  type SyncResult,
} from './exhibitions';
import {
  pullImpressions,
  pushPendingImpressions,
} from './impressions';

let running = false;
let currentRun: Promise<RunSyncOutcome | null> | null = null;
let currentStartedAt = 0;

const ACTIVE_SYNC_WAIT_MS = 5_000;

export type RunSyncOptions = { pull?: boolean; force?: boolean };

export type RunSyncOutcome = {
  push: SyncResult | null;
  pull: PullResult | null;
};

function invalidateSyncRelated() {
  queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
  queryClient.invalidateQueries({ queryKey: ['artifacts'] });
  queryClient.invalidateQueries({ queryKey: ['impressions'] });
  queryClient.invalidateQueries({ queryKey: ['sync-status'] });
}

export async function runSync(
  userId: string | undefined,
  opts: RunSyncOptions = {},
): Promise<RunSyncOutcome | null> {
  if (currentRun) {
    console.log('[sync] join existing run');
    return currentRun;
  }
  currentStartedAt = Date.now();
  currentRun = runSyncInternal(userId, opts);
  try {
    return await currentRun;
  } finally {
    currentRun = null;
    currentStartedAt = 0;
  }
}

async function runSyncInternal(
  userId: string | undefined,
  opts: RunSyncOptions = {},
): Promise<RunSyncOutcome | null> {
  const { pull = true, force = false } = opts;
  console.log('[sync] runSync called', { userId, running, pull, force });
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

    // Push order: exhibitions → artifacts → impressions
    // (artifact rows reference exhibition_id; impression rows reference both)
    const pushResult = await pushPendingExhibitions(userId, { force });
    console.log('[sync] push exhibitions', pushResult);
    const artifactsPush = await pushPendingArtifacts(userId, { force });
    console.log('[sync] push artifacts', artifactsPush);
    const impressionsPush = await pushPendingImpressions(userId, { force });
    console.log('[sync] push impressions', impressionsPush);

    let pullResult: PullResult | null = null;
    if (pull) {
      pullResult = await pullExhibitions(userId);
      console.log('[sync] pull exhibitions', pullResult);
      const artifactsPull = await pullArtifacts(userId);
      console.log('[sync] pull artifacts', artifactsPull);
      const impressionsPull = await pullImpressions(userId);
      console.log('[sync] pull impressions', impressionsPull);

      // If any pull surfaced resynced-deletes, push once more to drain them.
      const needsFollowup =
        pullResult.resyncedDelete > 0 ||
        artifactsPull.resyncedDelete > 0 ||
        impressionsPull.resyncedDelete > 0;
      if (needsFollowup) {
        await pushPendingExhibitions(userId, { force });
        await pushPendingArtifacts(userId, { force });
        await pushPendingImpressions(userId, { force });
        console.log('[sync] followup pushes done');
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
  if (currentRun) {
    console.log('[sync] manual sync waiting briefly for active run', {
      activeForMs: Date.now() - currentStartedAt,
    });
    const settled = await waitForActiveRunToSettle();
    if (!settled) {
      console.warn('[sync] manual sync skipped: active run still in progress');
      invalidateSyncRelated();
      return null;
    }
  }
  await resetFailedRetries(userId);
  await resetFailedArtifactRetries(userId);
  await resetFailedImpressionRetries(userId);
  invalidateSyncRelated();
  return runSync(userId, { pull: true, force: true });
}

async function waitForActiveRunToSettle(): Promise<boolean> {
  if (!currentRun) return true;
  return Promise.race([
    currentRun.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), ACTIVE_SYNC_WAIT_MS);
    }),
  ]);
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
