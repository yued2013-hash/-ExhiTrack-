import {
  countPendingArtifactPhotos,
  listAllArtifactPhotoLinksForUser,
  listAllArtifactPhotosForUser,
  listPendingArtifactPhotoLinks,
  listPendingArtifactPhotos,
  markArtifactPhotoLinkLocallyDeleted,
  markArtifactPhotoLinkSyncFailed,
  markArtifactPhotoLinkSynced,
  markArtifactPhotoLocallyDeleted,
  markArtifactPhotoSyncFailed,
  markArtifactPhotoSynced,
  resetArtifactPhotoLinkSyncStateToRetry,
  resetArtifactPhotoSyncStateToRetry,
  setArtifactPhotoCloudUrls,
  upsertArtifactPhotoFromCloud,
  upsertArtifactPhotoLinkFromCloud,
  type ArtifactPhotoLinkRow,
  type ArtifactPhotoRow,
  type CloudArtifactPhoto,
  type CloudArtifactPhotoLink,
} from '@/lib/db/artifactPhotos';
import { toError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import { removeFromStorage, uploadFileToStorage } from './storage';

const MAX_RETRIES = 3;
const BACKOFF_MS = [0, 5_000, 30_000];
const PHOTOS_BUCKET = 'photos';

export type ArtifactPhotoSyncResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  networkErrors: number;
};

export type ArtifactPhotoPullResult = {
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

function shouldAttemptNow(
  row: { retry_count: number; last_attempt_at: string | null },
  now: number,
): boolean {
  if (row.retry_count >= MAX_RETRIES) return false;
  if (!row.last_attempt_at) return true;
  const elapsed = now - new Date(row.last_attempt_at).getTime();
  const required = BACKOFF_MS[row.retry_count] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return elapsed >= required;
}

function photoCloudPath(row: ArtifactPhotoRow): string {
  return `${row.user_id}/${row.exhibition_id}/${row.id}.jpg`;
}

function thumbCloudPath(row: ArtifactPhotoRow): string {
  return `${row.user_id}/${row.exhibition_id}/${row.id}-thumb.jpg`;
}

async function pushOnePhoto(row: ArtifactPhotoRow): Promise<void> {
  if (row.deleted_at) {
    await removeFromStorage(PHOTOS_BUCKET, [
      photoCloudPath(row),
      thumbCloudPath(row),
    ]);
    const { error } = await supabase
      .from('artifact_photos')
      .delete()
      .eq('id', row.id);
    if (error) throw toError(error);
    return;
  }

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
      console.warn('[sync.artifactPhotos] thumbnail upload skipped', {
        id: row.id,
        error: toError(e).message,
      });
      thumbUrl = null;
    }
  }

  if (
    photoUrl !== row.photo_cloud_url ||
    thumbUrl !== row.thumbnail_cloud_url
  ) {
    await setArtifactPhotoCloudUrls(row.id, photoUrl, thumbUrl);
  }

  const { error } = await supabase.from('artifact_photos').upsert({
    id: row.id,
    user_id: row.user_id,
    exhibition_id: row.exhibition_id,
    photo_url: photoUrl,
    thumbnail_url: thumbUrl,
    photo_taken_at: row.photo_taken_at,
    latitude: row.latitude,
    longitude: row.longitude,
    imported_from: row.imported_from,
    raw_ocr_text: row.raw_ocr_text,
    ocr_status: row.ocr_status,
    ocr_error: row.ocr_error,
    ocr_updated_at: row.ocr_updated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
  if (error) throw toError(error);
}

async function pushOneLink(row: ArtifactPhotoLinkRow): Promise<void> {
  if (row.deleted_at) {
    const { error } = await supabase
      .from('artifact_photo_links')
      .delete()
      .eq('id', row.id);
    if (error) throw toError(error);
    return;
  }

  const { error } = await supabase.from('artifact_photo_links').upsert({
    id: row.id,
    user_id: row.user_id,
    exhibition_id: row.exhibition_id,
    artifact_id: row.artifact_id,
    photo_id: row.photo_id,
    role: row.role,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
  if (error) throw toError(error);
}

export async function pushPendingArtifactPhotos(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<ArtifactPhotoSyncResult> {
  const { force = false } = opts;
  const photoRows = await listPendingArtifactPhotos(userId);
  const linkRows = await listPendingArtifactPhotoLinks(userId);
  console.log(
    `[sync.artifactPhotos] ${photoRows.length} photo candidates, ${linkRows.length} link candidates`,
  );
  const now = Date.now();
  const result: ArtifactPhotoSyncResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    networkErrors: 0,
  };

  for (const row of photoRows) {
    if (!force && !shouldAttemptNow(row, now)) {
      result.skipped++;
      continue;
    }
    result.attempted++;
    try {
      await pushOnePhoto(row);
      await markArtifactPhotoSynced(row.id);
      result.succeeded++;
    } catch (e) {
      const err = toError(e);
      if (isNetworkError(err)) {
        result.networkErrors++;
        await markArtifactPhotoSyncFailed(row.id, err.message, row.retry_count, 'pending');
      } else {
        const newRetry = row.retry_count + 1;
        await markArtifactPhotoSyncFailed(
          row.id,
          err.message,
          newRetry,
          newRetry >= MAX_RETRIES ? 'failed' : 'pending',
        );
        result.failed++;
      }
    }
  }

  for (const row of linkRows) {
    if (!force && !shouldAttemptNow(row, now)) {
      result.skipped++;
      continue;
    }
    result.attempted++;
    try {
      await pushOneLink(row);
      await markArtifactPhotoLinkSynced(row.id);
      result.succeeded++;
    } catch (e) {
      const err = toError(e);
      if (isNetworkError(err)) {
        result.networkErrors++;
        await markArtifactPhotoLinkSyncFailed(row.id, err.message, row.retry_count, 'pending');
      } else {
        const newRetry = row.retry_count + 1;
        await markArtifactPhotoLinkSyncFailed(
          row.id,
          err.message,
          newRetry,
          newRetry >= MAX_RETRIES ? 'failed' : 'pending',
        );
        result.failed++;
      }
    }
  }

  return result;
}

export async function pullArtifactPhotos(
  userId: string,
): Promise<ArtifactPhotoPullResult> {
  const result: ArtifactPhotoPullResult = {
    fetched: 0,
    inserted: 0,
    updatedFromCloud: 0,
    unchanged: 0,
    locallyDeleted: 0,
    resyncedDelete: 0,
  };

  const { data: photoData, error: photoError } = await supabase
    .from('artifact_photos')
    .select(
      'id, user_id, exhibition_id, photo_url, thumbnail_url, photo_taken_at, latitude, longitude, imported_from, raw_ocr_text, ocr_status, ocr_error, ocr_updated_at, created_at, updated_at',
    )
    .eq('user_id', userId);
  if (photoError) throw toError(photoError);

  const cloudPhotos: CloudArtifactPhoto[] = photoData ?? [];
  const localPhotos = await listAllArtifactPhotosForUser(userId);
  const localPhotosById = new Map(localPhotos.map((r) => [r.id, r]));
  const cloudPhotoIds = new Set(cloudPhotos.map((r) => r.id));
  result.fetched += cloudPhotos.length;

  for (const cloud of cloudPhotos) {
    const local = localPhotosById.get(cloud.id);
    if (!local) {
      await upsertArtifactPhotoFromCloud(cloud);
      result.inserted++;
      continue;
    }
    if (local.deleted_at && local.sync_status === 'synced') {
      await resetArtifactPhotoSyncStateToRetry(local.id);
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
      await upsertArtifactPhotoFromCloud(cloud);
      result.updatedFromCloud++;
    } else {
      result.unchanged++;
    }
  }

  for (const local of localPhotos) {
    if (cloudPhotoIds.has(local.id)) continue;
    if (local.sync_status !== 'synced') continue;
    if (local.deleted_at) continue;
    await markArtifactPhotoLocallyDeleted(local.id);
    result.locallyDeleted++;
  }

  const { data: linkData, error: linkError } = await supabase
    .from('artifact_photo_links')
    .select(
      'id, user_id, exhibition_id, artifact_id, photo_id, role, sort_order, created_at, updated_at',
    )
    .eq('user_id', userId);
  if (linkError) throw toError(linkError);

  const cloudLinks: CloudArtifactPhotoLink[] = linkData ?? [];
  const localLinks = await listAllArtifactPhotoLinksForUser(userId);
  const localLinksById = new Map(localLinks.map((r) => [r.id, r]));
  const cloudLinkIds = new Set(cloudLinks.map((r) => r.id));
  result.fetched += cloudLinks.length;

  for (const cloud of cloudLinks) {
    const local = localLinksById.get(cloud.id);
    if (!local) {
      await upsertArtifactPhotoLinkFromCloud(cloud);
      result.inserted++;
      continue;
    }
    if (local.deleted_at && local.sync_status === 'synced') {
      await resetArtifactPhotoLinkSyncStateToRetry(local.id);
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
      await upsertArtifactPhotoLinkFromCloud(cloud);
      result.updatedFromCloud++;
    } else {
      result.unchanged++;
    }
  }

  for (const local of localLinks) {
    if (cloudLinkIds.has(local.id)) continue;
    if (local.sync_status !== 'synced') continue;
    if (local.deleted_at) continue;
    await markArtifactPhotoLinkLocallyDeleted(local.id);
    result.locallyDeleted++;
  }

  return result;
}

export { countPendingArtifactPhotos };
