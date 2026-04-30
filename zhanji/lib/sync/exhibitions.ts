import {
  listAllExhibitions,
  listPendingExhibitions,
  markLocallyDeleted,
  markSyncFailed,
  markSynced,
  resetSyncStateToRetry,
  upsertExhibitionFromCloud,
  type CloudExhibition,
  type ExhibitionRow,
} from '@/lib/db/exhibitions';
import { toError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const MAX_RETRIES = 3;
// Min ms since last attempt before re-trying. Index = retry_count BEFORE this attempt.
const BACKOFF_MS = [0, 5_000, 30_000];

export type SyncResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  networkErrors: number;
};

export type PullResult = {
  fetched: number;
  inserted: number;
  updatedFromCloud: number;
  unchanged: number;
  locallyDeleted: number;
  resyncedDelete: number;
};

function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  );
}

function shouldAttemptNow(row: ExhibitionRow, now: number): boolean {
  if (row.retry_count >= MAX_RETRIES) return false;
  if (!row.last_attempt_at) return true;
  const elapsed = now - new Date(row.last_attempt_at).getTime();
  const required = BACKOFF_MS[row.retry_count] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return elapsed >= required;
}

async function pushOne(row: ExhibitionRow): Promise<void> {
  if (row.deleted_at) {
    // .select() forces PostgREST to return the deleted rows, so we can verify
    // the delete actually hit a row. Without this, RLS-filtered no-ops succeed
    // silently and we'd incorrectly mark synced.
    const { data, error } = await supabase
      .from('exhibitions')
      .delete()
      .eq('id', row.id)
      .select();
    if (error) throw toError(error);
    if (!data || data.length === 0) {
      // No row matched. Either it was already deleted (idempotent — fine) or
      // RLS denied us (real problem). Treat already-deleted as success.
      const { data: probe, error: probeErr } = await supabase
        .from('exhibitions')
        .select('id')
        .eq('id', row.id);
      if (probeErr) throw toError(probeErr);
      if (probe && probe.length > 0) {
        throw new Error(
          `删除被拒绝（RLS 或 id 不匹配）：行 ${row.id} 仍存在于云端`,
        );
      }
      // Row truly absent on cloud — accept as deleted.
    }
    return;
  }
  const { error } = await supabase.from('exhibitions').upsert({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    museum: row.museum,
    visit_date: row.visit_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
  if (error) throw toError(error);
}

export async function pushPendingExhibitions(userId: string): Promise<SyncResult> {
  const rows = await listPendingExhibitions(userId);
  console.log(`[sync] pushPendingExhibitions: ${rows.length} candidate rows`);
  const now = Date.now();
  const result: SyncResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    networkErrors: 0,
  };

  for (const row of rows) {
    if (!shouldAttemptNow(row, now)) {
      result.skipped++;
      console.log(`[sync]   skip ${row.id} (retry=${row.retry_count}, backoff)`);
      continue;
    }
    result.attempted++;
    try {
      await pushOne(row);
      await markSynced(row.id);
      result.succeeded++;
      console.log(`[sync]   ✓ pushed ${row.id} (${row.name})`);
    } catch (e) {
      const err = toError(e);
      const errMsg = err.message;
      if (isNetworkError(err)) {
        // Network failure: don't bump retry. We'll retry on next trigger.
        result.networkErrors++;
        console.warn(`[sync]   ⚠ network error on ${row.id}: ${errMsg}`);
        // Still update last_attempt_at to throttle hot loops
        await markSyncFailed(row.id, errMsg, row.retry_count, 'pending');
      } else {
        // Server / data error: bump retry count.
        const newRetry = row.retry_count + 1;
        const status = newRetry >= MAX_RETRIES ? 'failed' : 'pending';
        await markSyncFailed(row.id, errMsg, newRetry, status);
        result.failed++;
        console.warn(
          `[sync]   ✗ server error on ${row.id} (retry ${newRetry}/${MAX_RETRIES}, status=${status}): ${errMsg}`,
        );
      }
    }
  }

  return result;
}

/**
 * Pull cloud state into local SQLite. Only handles 'synced' local rows;
 * pending/failed local rows are owned by push-sync and left alone.
 */
export async function pullExhibitions(userId: string): Promise<PullResult> {
  const { data, error } = await supabase
    .from('exhibitions')
    .select('id, user_id, name, museum, visit_date, created_at, updated_at')
    .eq('user_id', userId);
  if (error) throw toError(error);
  const cloudRows: CloudExhibition[] = data ?? [];

  const localRows = await listAllExhibitions(userId);
  const localById = new Map(localRows.map((r) => [r.id, r]));
  const cloudIds = new Set(cloudRows.map((r) => r.id));

  const result: PullResult = {
    fetched: cloudRows.length,
    inserted: 0,
    updatedFromCloud: 0,
    unchanged: 0,
    locallyDeleted: 0,
    resyncedDelete: 0,
  };

  for (const cloud of cloudRows) {
    const local = localById.get(cloud.id);
    if (!local) {
      await upsertExhibitionFromCloud(cloud);
      result.inserted++;
      continue;
    }
    if (local.deleted_at && local.sync_status === 'synced') {
      // Local thinks deleted but cloud still has it (a previous delete
      // silently no-op'd). Reset to pending so push retries with the
      // batch 2.2 .select() verification.
      await resetSyncStateToRetry(local.id);
      result.resyncedDelete++;
      continue;
    }
    if (local.sync_status !== 'synced') {
      // Push-sync owns this row.
      result.unchanged++;
      continue;
    }
    if (new Date(cloud.updated_at).getTime() > new Date(local.updated_at).getTime()) {
      await upsertExhibitionFromCloud(cloud);
      result.updatedFromCloud++;
    } else {
      result.unchanged++;
    }
  }

  for (const local of localRows) {
    if (cloudIds.has(local.id)) continue;
    if (local.sync_status !== 'synced') continue;
    if (local.deleted_at) continue; // already aligned (both gone)
    // Cloud lost this row → another device deleted it.
    await markLocallyDeleted(local.id);
    result.locallyDeleted++;
  }

  return result;
}
