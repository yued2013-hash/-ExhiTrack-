import {
  countPendingImpressions,
  listAllImpressionsForUser,
  listPendingImpressions,
  markImpressionLocallyDeleted,
  markImpressionSyncFailed,
  markImpressionSynced,
  resetImpressionSyncStateToRetry,
  setImpressionCloudUrl,
  upsertImpressionFromCloud,
  type CloudImpression,
  type ImpressionRow,
} from '@/lib/db/impressions';
import { toError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import { removeFromStorage, uploadFileToStorage } from './storage';

const MAX_RETRIES = 3;
const BACKOFF_MS = [0, 5_000, 30_000];
const VOICES_BUCKET = 'voices';

export type ImpressionSyncResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  networkErrors: number;
};

export type ImpressionPullResult = {
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

function shouldAttemptNow(row: ImpressionRow, now: number): boolean {
  if (row.retry_count >= MAX_RETRIES) return false;
  if (!row.last_attempt_at) return true;
  const elapsed = now - new Date(row.last_attempt_at).getTime();
  const required = BACKOFF_MS[row.retry_count] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return elapsed >= required;
}

function voiceCloudPath(row: ImpressionRow): string {
  return `${row.user_id}/${row.exhibition_id}/${row.id}.m4a`;
}

async function pushOne(row: ImpressionRow): Promise<void> {
  if (row.deleted_at) {
    await removeFromStorage(VOICES_BUCKET, [voiceCloudPath(row)]);
    const { data, error } = await supabase
      .from('impressions')
      .delete()
      .eq('id', row.id)
      .select();
    if (error) throw toError(error);
    if (!data || data.length === 0) {
      const { data: probe, error: probeErr } = await supabase
        .from('impressions')
        .select('id')
        .eq('id', row.id);
      if (probeErr) throw toError(probeErr);
      if (probe && probe.length > 0) {
        throw new Error(`录音删除被拒绝(RLS 或 id 不匹配):${row.id} 仍存在于云端`);
      }
    }
    return;
  }

  let voiceUrl = row.voice_cloud_url;
  if (!voiceUrl) {
    voiceUrl = await uploadFileToStorage(
      VOICES_BUCKET,
      row.voice_local_path,
      voiceCloudPath(row),
      'audio/m4a',
    );
    await setImpressionCloudUrl(row.id, voiceUrl);
  }

  const { error } = await supabase.from('impressions').upsert({
    id: row.id,
    user_id: row.user_id,
    exhibition_id: row.exhibition_id,
    artifact_id: row.artifact_id,
    voice_url: voiceUrl,
    voice_duration_ms: row.voice_duration_ms,
    raw_text: row.raw_text,
    polished_text: row.polished_text,
    recorded_at: row.recorded_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
  if (error) throw toError(error);
}

export async function pushPendingImpressions(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<ImpressionSyncResult> {
  const { force = false } = opts;
  const rows = await listPendingImpressions(userId);
  console.log(`[sync.impressions] ${rows.length} candidate rows`);
  const now = Date.now();
  const result: ImpressionSyncResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    networkErrors: 0,
  };

  for (const row of rows) {
    if (!force && !shouldAttemptNow(row, now)) {
      result.skipped++;
      continue;
    }
    result.attempted++;
    try {
      await pushOne(row);
      await markImpressionSynced(row.id);
      result.succeeded++;
      console.log(`[sync.impressions]   ✓ pushed ${row.id}`);
    } catch (e) {
      const err = toError(e);
      const errMsg = err.message;
      if (isNetworkError(err)) {
        result.networkErrors++;
        await markImpressionSyncFailed(row.id, errMsg, row.retry_count, 'pending');
        console.warn(`[sync.impressions]   ⚠ network ${row.id}: ${errMsg}`);
      } else {
        const newRetry = row.retry_count + 1;
        const status = newRetry >= MAX_RETRIES ? 'failed' : 'pending';
        await markImpressionSyncFailed(row.id, errMsg, newRetry, status);
        result.failed++;
        console.warn(
          `[sync.impressions]   ✗ ${row.id} retry ${newRetry}/${MAX_RETRIES} status=${status}: ${errMsg}`,
        );
      }
    }
  }

  return result;
}

export async function pullImpressions(
  userId: string,
): Promise<ImpressionPullResult> {
  const { data, error } = await supabase
    .from('impressions')
    .select(
      'id, user_id, exhibition_id, artifact_id, voice_url, voice_duration_ms, raw_text, polished_text, recorded_at, created_at, updated_at',
    )
    .eq('user_id', userId);
  if (error) throw toError(error);
  const cloudRows: CloudImpression[] = data ?? [];

  const localRows = await listAllImpressionsForUser(userId);
  const localById = new Map(localRows.map((r) => [r.id, r]));
  const cloudIds = new Set(cloudRows.map((r) => r.id));

  const result: ImpressionPullResult = {
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
      await upsertImpressionFromCloud(cloud);
      result.inserted++;
      continue;
    }
    if (local.deleted_at && local.sync_status === 'synced') {
      await resetImpressionSyncStateToRetry(local.id);
      result.resyncedDelete++;
      continue;
    }
    if (local.sync_status !== 'synced') {
      result.unchanged++;
      continue;
    }
    if (
      new Date(cloud.updated_at).getTime() >
      new Date(local.updated_at).getTime()
    ) {
      await upsertImpressionFromCloud(cloud);
      result.updatedFromCloud++;
    } else {
      result.unchanged++;
    }
  }

  for (const local of localRows) {
    if (cloudIds.has(local.id)) continue;
    if (local.sync_status !== 'synced') continue;
    if (local.deleted_at) continue;
    await markImpressionLocallyDeleted(local.id);
    result.locallyDeleted++;
  }

  return result;
}

export { countPendingImpressions };
