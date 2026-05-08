import * as Crypto from 'expo-crypto';

import { getArtifact, type ArtifactRow } from './artifacts';
import { getDb } from './index';

export type ArtifactPhotoRole = 'primary' | 'label' | 'detail' | 'scene' | 'other';
export type SyncStatus = 'pending' | 'synced' | 'failed';

export type ArtifactPhotoRow = {
  id: string;
  user_id: string;
  exhibition_id: string;
  photo_local_path: string;
  thumbnail_local_path: string | null;
  photo_cloud_url: string | null;
  thumbnail_cloud_url: string | null;
  photo_taken_at: string;
  latitude: number | null;
  longitude: number | null;
  imported_from: string | null;
  raw_ocr_text: string | null;
  ocr_status: string;
  ocr_error: string | null;
  ocr_updated_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
};

export type ArtifactPhotoLinkRow = {
  id: string;
  user_id: string;
  exhibition_id: string;
  artifact_id: string;
  photo_id: string;
  role: ArtifactPhotoRole;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
};

export type LinkedArtifactPhoto = ArtifactPhotoRow & {
  link_id: string;
  role: ArtifactPhotoRole;
  sort_order: number;
};

export type ArtifactPhotoSyncCounts = {
  pending: number;
  failed: number;
};

export type CloudArtifactPhoto = {
  id: string;
  user_id: string;
  exhibition_id: string;
  photo_url: string | null;
  thumbnail_url: string | null;
  photo_taken_at: string;
  latitude: number | null;
  longitude: number | null;
  imported_from: string | null;
  raw_ocr_text: string | null;
  ocr_status: string;
  ocr_error: string | null;
  ocr_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CloudArtifactPhotoLink = {
  id: string;
  user_id: string;
  exhibition_id: string;
  artifact_id: string;
  photo_id: string;
  role: ArtifactPhotoRole;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export async function listPhotosForArtifact(
  artifactId: string,
): Promise<LinkedArtifactPhoto[]> {
  const db = await getDb();
  return db.getAllAsync<LinkedArtifactPhoto>(
    `SELECT p.*, l.id AS link_id, l.role, l.sort_order
       FROM artifact_photo_links l
       JOIN artifact_photos p ON p.id = l.photo_id
      WHERE l.artifact_id = ?
        AND l.deleted_at IS NULL
        AND p.deleted_at IS NULL
      ORDER BY
        CASE l.role WHEN 'primary' THEN 0 WHEN 'label' THEN 1 WHEN 'detail' THEN 2 ELSE 3 END,
        l.sort_order ASC,
        p.photo_taken_at ASC`,
    artifactId,
  );
}

export async function ensurePhotoFromArtifact(
  artifact: ArtifactRow,
): Promise<ArtifactPhotoRow> {
  const db = await getDb();
  const existing = await db.getFirstAsync<ArtifactPhotoRow>(
    'SELECT * FROM artifact_photos WHERE id = ?',
    artifact.id,
  );
  if (existing) return existing;

  await db.runAsync(
    `INSERT INTO artifact_photos (
       id, user_id, exhibition_id, photo_local_path, thumbnail_local_path,
       photo_cloud_url, thumbnail_cloud_url,
       photo_taken_at, latitude, longitude, imported_from,
       raw_ocr_text, ocr_status, ocr_error, ocr_updated_at,
       created_at, updated_at, deleted_at, sync_status, retry_count,
       last_error, last_attempt_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL)`,
    artifact.id,
    artifact.user_id,
    artifact.exhibition_id,
    artifact.photo_local_path,
    artifact.thumbnail_local_path,
    artifact.photo_cloud_url,
    artifact.thumbnail_cloud_url,
    artifact.photo_taken_at,
    artifact.latitude,
    artifact.longitude,
    artifact.imported_from,
    artifact.raw_ocr_text,
    artifact.extraction_status ?? 'idle',
    artifact.extraction_error,
    artifact.extraction_updated_at,
    artifact.created_at,
    artifact.updated_at,
    artifact.deleted_at,
  );

  const row = await db.getFirstAsync<ArtifactPhotoRow>(
    'SELECT * FROM artifact_photos WHERE id = ?',
    artifact.id,
  );
  if (!row) throw new Error('Artifact photo was not created.');
  return row;
}

export async function linkArtifactToPhoto(
  input: {
    artifact_id: string;
    photo_artifact_id: string;
    role: ArtifactPhotoRole;
    sort_order?: number;
  },
): Promise<ArtifactPhotoLinkRow> {
  const artifact = await getArtifact(input.artifact_id);
  if (!artifact) throw new Error('Artifact not found.');
  const photoArtifact = await getArtifact(input.photo_artifact_id);
  if (!photoArtifact) throw new Error('Photo artifact not found.');
  if (artifact.exhibition_id !== photoArtifact.exhibition_id) {
    throw new Error('Cannot link photos across exhibitions.');
  }

  const photo = await ensurePhotoFromArtifact(photoArtifact);
  const db = await getDb();
  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<ArtifactPhotoLinkRow>(
    `SELECT * FROM artifact_photo_links
      WHERE artifact_id = ? AND photo_id = ? AND role = ? AND deleted_at IS NULL`,
    artifact.id,
    photo.id,
    input.role,
  );
  if (existing) return existing;

  const id = Crypto.randomUUID();
  await db.runAsync(
    `INSERT INTO artifact_photo_links (
       id, user_id, exhibition_id, artifact_id, photo_id, role, sort_order,
       created_at, updated_at, sync_status
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    id,
    artifact.user_id,
    artifact.exhibition_id,
    artifact.id,
    photo.id,
    input.role,
    input.sort_order ?? 0,
    now,
    now,
  );

  const row = await db.getFirstAsync<ArtifactPhotoLinkRow>(
    'SELECT * FROM artifact_photo_links WHERE id = ?',
    id,
  );
  if (!row) throw new Error('Artifact photo link was not created.');
  return row;
}

export async function listPendingArtifactPhotos(
  userId: string,
): Promise<ArtifactPhotoRow[]> {
  const db = await getDb();
  return db.getAllAsync<ArtifactPhotoRow>(
    `SELECT * FROM artifact_photos
     WHERE user_id = ? AND sync_status IN ('pending', 'failed')
     ORDER BY created_at ASC`,
    userId,
  );
}

export async function listAllArtifactPhotosForUser(
  userId: string,
): Promise<ArtifactPhotoRow[]> {
  const db = await getDb();
  return db.getAllAsync<ArtifactPhotoRow>(
    'SELECT * FROM artifact_photos WHERE user_id = ?',
    userId,
  );
}

export async function listPendingArtifactPhotoLinks(
  userId: string,
): Promise<ArtifactPhotoLinkRow[]> {
  const db = await getDb();
  return db.getAllAsync<ArtifactPhotoLinkRow>(
    `SELECT * FROM artifact_photo_links
     WHERE user_id = ? AND sync_status IN ('pending', 'failed')
     ORDER BY created_at ASC`,
    userId,
  );
}

export async function listAllArtifactPhotoLinksForUser(
  userId: string,
): Promise<ArtifactPhotoLinkRow[]> {
  const db = await getDb();
  return db.getAllAsync<ArtifactPhotoLinkRow>(
    'SELECT * FROM artifact_photo_links WHERE user_id = ?',
    userId,
  );
}

export async function countPendingArtifactPhotos(
  userId: string,
): Promise<ArtifactPhotoSyncCounts> {
  const db = await getDb();
  const photos = await db.getFirstAsync<ArtifactPhotoSyncCounts>(
    `SELECT
       SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM artifact_photos WHERE user_id = ?`,
    userId,
  );
  const links = await db.getFirstAsync<ArtifactPhotoSyncCounts>(
    `SELECT
       SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM artifact_photo_links WHERE user_id = ?`,
    userId,
  );
  return {
    pending: (photos?.pending ?? 0) + (links?.pending ?? 0),
    failed: (photos?.failed ?? 0) + (links?.failed ?? 0),
  };
}

export async function setArtifactPhotoCloudUrls(
  id: string,
  photoUrl: string | null,
  thumbnailUrl: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifact_photos
       SET photo_cloud_url = ?, thumbnail_cloud_url = ?
     WHERE id = ?`,
    photoUrl,
    thumbnailUrl,
    id,
  );
}

export async function markArtifactPhotoSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifact_photos
       SET sync_status = 'synced', retry_count = 0,
           last_error = NULL, last_attempt_at = ?
     WHERE id = ?`,
    new Date().toISOString(),
    id,
  );
}

export async function markArtifactPhotoLinkSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifact_photo_links
       SET sync_status = 'synced', retry_count = 0,
           last_error = NULL, last_attempt_at = ?
     WHERE id = ?`,
    new Date().toISOString(),
    id,
  );
}

export async function markArtifactPhotoSyncFailed(
  id: string,
  errorMessage: string,
  newRetryCount: number,
  status: SyncStatus,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifact_photos
       SET sync_status = ?, retry_count = ?, last_error = ?, last_attempt_at = ?
     WHERE id = ?`,
    status,
    newRetryCount,
    errorMessage,
    new Date().toISOString(),
    id,
  );
}

export async function markArtifactPhotoLinkSyncFailed(
  id: string,
  errorMessage: string,
  newRetryCount: number,
  status: SyncStatus,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifact_photo_links
       SET sync_status = ?, retry_count = ?, last_error = ?, last_attempt_at = ?
     WHERE id = ?`,
    status,
    newRetryCount,
    errorMessage,
    new Date().toISOString(),
    id,
  );
}

export async function resetFailedArtifactPhotoRetries(
  userId: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifact_photos
       SET sync_status = 'pending', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE user_id = ? AND sync_status = 'failed'`,
    userId,
  );
  await db.runAsync(
    `UPDATE artifact_photo_links
       SET sync_status = 'pending', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE user_id = ? AND sync_status = 'failed'`,
    userId,
  );
}

export async function upsertArtifactPhotoFromCloud(
  cloud: CloudArtifactPhoto,
): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string; sync_status: SyncStatus }>(
    'SELECT id, sync_status FROM artifact_photos WHERE id = ?',
    cloud.id,
  );
  if (existing) {
    if (existing.sync_status !== 'synced') return;
    await db.runAsync(
      `UPDATE artifact_photos SET
         user_id = ?, exhibition_id = ?,
         photo_cloud_url = ?, thumbnail_cloud_url = ?,
         photo_taken_at = ?, latitude = ?, longitude = ?, imported_from = ?,
         raw_ocr_text = ?, ocr_status = ?, ocr_error = ?, ocr_updated_at = ?,
         created_at = ?, updated_at = ?, deleted_at = NULL,
         sync_status = 'synced', retry_count = 0,
         last_error = NULL, last_attempt_at = NULL
       WHERE id = ?`,
      cloud.user_id,
      cloud.exhibition_id,
      cloud.photo_url,
      cloud.thumbnail_url,
      cloud.photo_taken_at,
      cloud.latitude,
      cloud.longitude,
      cloud.imported_from,
      cloud.raw_ocr_text,
      cloud.ocr_status ?? 'idle',
      cloud.ocr_error,
      cloud.ocr_updated_at,
      cloud.created_at,
      cloud.updated_at,
      cloud.id,
    );
  } else {
    await db.runAsync(
      `INSERT INTO artifact_photos (
         id, user_id, exhibition_id, photo_local_path, thumbnail_local_path,
         photo_cloud_url, thumbnail_cloud_url,
         photo_taken_at, latitude, longitude, imported_from,
         raw_ocr_text, ocr_status, ocr_error, ocr_updated_at,
         created_at, updated_at, deleted_at, sync_status, retry_count
       )
       VALUES (?, ?, ?, '', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 0)`,
      cloud.id,
      cloud.user_id,
      cloud.exhibition_id,
      cloud.photo_url,
      cloud.thumbnail_url,
      cloud.photo_taken_at,
      cloud.latitude,
      cloud.longitude,
      cloud.imported_from,
      cloud.raw_ocr_text,
      cloud.ocr_status ?? 'idle',
      cloud.ocr_error,
      cloud.ocr_updated_at,
      cloud.created_at,
      cloud.updated_at,
    );
  }
}

export async function upsertArtifactPhotoLinkFromCloud(
  cloud: CloudArtifactPhotoLink,
): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string; sync_status: SyncStatus }>(
    'SELECT id, sync_status FROM artifact_photo_links WHERE id = ?',
    cloud.id,
  );
  if (existing) {
    if (existing.sync_status !== 'synced') return;
    await db.runAsync(
      `UPDATE artifact_photo_links SET
         user_id = ?, exhibition_id = ?, artifact_id = ?, photo_id = ?,
         role = ?, sort_order = ?, created_at = ?, updated_at = ?,
         deleted_at = NULL, sync_status = 'synced', retry_count = 0,
         last_error = NULL, last_attempt_at = NULL
       WHERE id = ?`,
      cloud.user_id,
      cloud.exhibition_id,
      cloud.artifact_id,
      cloud.photo_id,
      cloud.role,
      cloud.sort_order,
      cloud.created_at,
      cloud.updated_at,
      cloud.id,
    );
  } else {
    await db.runAsync(
      `INSERT INTO artifact_photo_links (
         id, user_id, exhibition_id, artifact_id, photo_id, role, sort_order,
         created_at, updated_at, deleted_at, sync_status, retry_count
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 0)`,
      cloud.id,
      cloud.user_id,
      cloud.exhibition_id,
      cloud.artifact_id,
      cloud.photo_id,
      cloud.role,
      cloud.sort_order,
      cloud.created_at,
      cloud.updated_at,
    );
  }
}

export async function markArtifactPhotoLocallyDeleted(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE artifact_photos
       SET deleted_at = ?, updated_at = ?,
           sync_status = 'synced', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    now,
    now,
    id,
  );
}

export async function markArtifactPhotoLinkLocallyDeleted(
  id: string,
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE artifact_photo_links
       SET deleted_at = ?, updated_at = ?,
           sync_status = 'synced', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    now,
    now,
    id,
  );
}

export async function resetArtifactPhotoSyncStateToRetry(
  id: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifact_photos
       SET sync_status = 'pending', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    id,
  );
}

export async function resetArtifactPhotoLinkSyncStateToRetry(
  id: string,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifact_photo_links
       SET sync_status = 'pending', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    id,
  );
}
