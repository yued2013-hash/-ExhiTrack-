import {
  countPendingArtifacts,
  listAllArtifactsForUser,
  listPendingArtifacts,
  markArtifactLocallyDeleted,
  markArtifactSyncFailed,
  markArtifactSynced,
  resetArtifactSyncStateToRetry,
  setArtifactCloudUrls,
  upsertArtifactFromCloud,
  type ArtifactRow,
  type CloudArtifact,
} from '@/lib/db/artifacts';
import { getExhibition } from '@/lib/db/exhibitions';
import { toError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import { removeFromStorage, uploadFileToStorage } from './storage';

const MAX_RETRIES = 3;
const BACKOFF_MS = [0, 5_000, 30_000];
const PHOTOS_BUCKET = 'photos';
const ARTIFACT_COLUMNS =
  'id, user_id, exhibition_id, photo_url, thumbnail_url, photo_taken_at, latitude, longitude, imported_from, group_id, created_at, updated_at';
const LEGACY_ARTIFACT_COLUMNS =
  'id, user_id, exhibition_id, photo_url, thumbnail_url, photo_taken_at, group_id, created_at, updated_at';

export type ArtifactSyncResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  networkErrors: number;
};

export type ArtifactPullResult = {
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

function isMissingImportMetadataColumn(e: unknown): boolean {
  const err = toError(e);
  const msg = err.message.toLowerCase();
  return (
    msg.includes('column artifacts.latitude does not exist') ||
    msg.includes('column artifacts.longitude does not exist') ||
    msg.includes('column artifacts.imported_from does not exist') ||
    msg.includes("column 'latitude'") ||
    msg.includes("column 'longitude'") ||
    msg.includes("column 'imported_from'") ||
    (msg.includes('schema cache') &&
      (msg.includes('latitude') ||
        msg.includes('longitude') ||
        msg.includes('imported_from')))
  );
}

function shouldAttemptNow(row: ArtifactRow, now: number): boolean {
  if (row.retry_count >= MAX_RETRIES) return false;
  if (!row.last_attempt_at) return true;
  const elapsed = now - new Date(row.last_attempt_at).getTime();
  const required = BACKOFF_MS[row.retry_count] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return elapsed >= required;
}

function photoCloudPath(row: ArtifactRow): string {
  return `${row.user_id}/${row.exhibition_id}/${row.id}.jpg`;
}

function thumbCloudPath(row: ArtifactRow): string {
  return `${row.user_id}/${row.exhibition_id}/${row.id}-thumb.jpg`;
}

async function ensureCloudExhibitionForArtifact(row: ArtifactRow): Promise<boolean> {
  const exhibition = await getExhibition(row.exhibition_id);
  if (!exhibition) {
    await removeFromStorage(PHOTOS_BUCKET, [
      photoCloudPath(row),
      thumbCloudPath(row),
    ]);
    await markArtifactLocallyDeleted(row.id);
    console.warn('[sync.artifacts] orphan artifact marked locally deleted', {
      id: row.id,
      exhibitionId: row.exhibition_id,
    });
    return false;
  }
  const { error } = await supabase.from('exhibitions').upsert({
    id: exhibition.id,
    user_id: exhibition.user_id,
    name: exhibition.name,
    museum: exhibition.museum,
    visit_date: exhibition.visit_date,
    created_at: exhibition.created_at,
    updated_at: exhibition.updated_at,
  });
  if (error) {
    throw new Error(`父展览同步失败:${toError(error).message}`);
  }
  return true;
}

async function pushOne(row: ArtifactRow): Promise<void> {
  if (row.deleted_at) {
    // Remove cloud files (best effort), then delete the row.
    await removeFromStorage(PHOTOS_BUCKET, [
      photoCloudPath(row),
      thumbCloudPath(row),
    ]);
    const { data, error } = await supabase
      .from('artifacts')
      .delete()
      .eq('id', row.id)
      .select();
    if (error) throw toError(error);
    if (!data || data.length === 0) {
      // Nothing matched. Probe to confirm — if cloud still has the row, RLS denied us.
      const { data: probe, error: probeErr } = await supabase
        .from('artifacts')
        .select('id')
        .eq('id', row.id);
      if (probeErr) throw toError(probeErr);
      if (probe && probe.length > 0) {
        throw new Error(
          `文物删除被拒绝(RLS 或 id 不匹配):${row.id} 仍存在于云端`,
        );
      }
    }
    return;
  }

  const hasCloudExhibition = await ensureCloudExhibitionForArtifact(row);
  if (!hasCloudExhibition) return;

  // Upload photo if not yet stored on cloud.
  let photoUrl = row.photo_cloud_url;
  if (!photoUrl) {
    photoUrl = await uploadFileToStorage(
      PHOTOS_BUCKET,
      row.photo_local_path,
      photoCloudPath(row),
      'image/jpeg',
    );
  }
  let thumbUrl = row.thumbnail_cloud_url;
  if (!thumbUrl && row.thumbnail_local_path) {
    try {
      thumbUrl = await uploadFileToStorage(
        PHOTOS_BUCKET,
        row.thumbnail_local_path,
        thumbCloudPath(row),
        'image/jpeg',
      );
    } catch (e) {
      // Thumbnail is only an optimization for list rendering. Do not block the
      // canonical photo record if the thumbnail file was cleaned up or failed.
      console.warn('[sync.artifacts] thumbnail upload skipped', {
        id: row.id,
        error: toError(e).message,
      });
      thumbUrl = null;
    }
  }

  // Cache URLs locally so the next retry doesn't re-upload.
  if (
    photoUrl !== row.photo_cloud_url ||
    thumbUrl !== row.thumbnail_cloud_url
  ) {
    await setArtifactCloudUrls(row.id, photoUrl, thumbUrl);
  }

  const payload = {
    id: row.id,
    user_id: row.user_id,
    exhibition_id: row.exhibition_id,
    photo_url: photoUrl,
    thumbnail_url: thumbUrl,
    photo_taken_at: row.photo_taken_at,
    latitude: row.latitude,
    longitude: row.longitude,
    imported_from: row.imported_from,
    group_id: row.group_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  const { error } = await supabase.from('artifacts').upsert(payload);
  if (error && isMissingImportMetadataColumn(error)) {
    const { latitude: _latitude, longitude: _longitude, imported_from: _importedFrom, ...legacyPayload } = payload;
    const retry = await supabase.from('artifacts').upsert(legacyPayload);
    if (retry.error) throw toError(retry.error);
    console.warn(
      '[sync.artifacts] Supabase artifacts import metadata columns missing; pushed legacy payload. Run migration 0004_artifact_import_metadata.sql.',
    );
    return;
  }
  if (error) throw toError(error);
}

export async function pushPendingArtifacts(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<ArtifactSyncResult> {
  const { force = false } = opts;
  const rows = await listPendingArtifacts(userId);
  console.log(`[sync.artifacts] ${rows.length} candidate rows`);
  const now = Date.now();
  const result: ArtifactSyncResult = {
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
      await markArtifactSynced(row.id);
      result.succeeded++;
      console.log(`[sync.artifacts]   ✓ pushed ${row.id}`);
    } catch (e) {
      const err = toError(e);
      const errMsg = err.message;
      if (isNetworkError(err)) {
        result.networkErrors++;
        await markArtifactSyncFailed(row.id, errMsg, row.retry_count, 'pending');
        console.warn(`[sync.artifacts]   ⚠ network ${row.id}: ${errMsg}`);
      } else {
        const newRetry = row.retry_count + 1;
        const status = newRetry >= MAX_RETRIES ? 'failed' : 'pending';
        await markArtifactSyncFailed(row.id, errMsg, newRetry, status);
        result.failed++;
        console.warn(
          `[sync.artifacts]   ✗ ${row.id} retry ${newRetry}/${MAX_RETRIES} status=${status}: ${errMsg}`,
        );
      }
    }
  }

  return result;
}

export async function pullArtifacts(
  userId: string,
): Promise<ArtifactPullResult> {
  const { data, error } = await supabase
    .from('artifacts')
    .select(ARTIFACT_COLUMNS)
    .eq('user_id', userId);
  let cloudRows: CloudArtifact[];
  if (error && isMissingImportMetadataColumn(error)) {
    const legacy = await supabase
      .from('artifacts')
      .select(LEGACY_ARTIFACT_COLUMNS)
      .eq('user_id', userId);
    if (legacy.error) throw toError(legacy.error);
    cloudRows = (legacy.data ?? []).map((row) => ({
      ...row,
      latitude: null,
      longitude: null,
      imported_from: null,
    }));
    console.warn(
      '[sync.artifacts] Supabase artifacts import metadata columns missing; pulled legacy columns. Run migration 0004_artifact_import_metadata.sql.',
    );
  } else {
    if (error) throw toError(error);
    cloudRows = data ?? [];
  }

  const localRows = await listAllArtifactsForUser(userId);
  const localById = new Map(localRows.map((r) => [r.id, r]));
  const cloudIds = new Set(cloudRows.map((r) => r.id));

  const result: ArtifactPullResult = {
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
      await upsertArtifactFromCloud(cloud);
      result.inserted++;
      continue;
    }
    if (local.deleted_at && local.sync_status === 'synced') {
      // Local thinks deleted but cloud still has it — re-push the delete.
      await resetArtifactSyncStateToRetry(local.id);
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
      await upsertArtifactFromCloud(cloud);
      result.updatedFromCloud++;
    } else {
      result.unchanged++;
    }
  }

  for (const local of localRows) {
    if (cloudIds.has(local.id)) continue;
    if (local.sync_status !== 'synced') continue;
    if (local.deleted_at) continue;
    await markArtifactLocallyDeleted(local.id);
    result.locallyDeleted++;
  }

  return result;
}

export { countPendingArtifacts };
