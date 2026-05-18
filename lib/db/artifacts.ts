import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

import { getDb } from './index';

export type SyncStatus = 'pending' | 'synced' | 'failed';

export type ArtifactRow = {
  id: string;
  user_id: string;
  exhibition_id: string;
  photo_local_path: string; // relative to FileSystem.documentDirectory
  thumbnail_local_path: string | null; // relative to FileSystem.documentDirectory
  photo_taken_at: string;
  latitude: number | null;
  longitude: number | null;
  imported_from: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  group_id: string | null;
  photo_cloud_url: string | null;
  thumbnail_cloud_url: string | null;
  name: string | null;
  dynasty: string | null;
  category: string | null;
  origin: string | null;
  era: string | null;
  label_description: string | null;
  raw_ocr_text: string | null;
  extraction_status: ExtractionStatus;
  extraction_error: string | null;
  extraction_updated_at: string | null;
};

export type ExtractionStatus = 'idle' | 'queued' | 'processing' | 'done' | 'failed' | 'manual';

export type ArtifactInfoPatch = {
  name?: string | null;
  dynasty?: string | null;
  category?: string | null;
  origin?: string | null;
  era?: string | null;
  label_description?: string | null;
  raw_ocr_text?: string | null;
  extraction_status?: ExtractionStatus;
  extraction_error?: string | null;
  extraction_updated_at?: string | null;
};

const PHOTOS_DIR = 'photos';
const THUMBS_DIR = 'thumbnails';
const THUMB_WIDTH = 480;

function localUri(relativePath: string): string {
  return `${FileSystem.documentDirectory}${relativePath}`;
}

export function getArtifactPhotoUri(artifact: ArtifactRow): string | null {
  // Prefer local file (free, fast, works offline). Fall back to cloud URL
  // for rows pulled from another device that haven't been downloaded yet.
  if (artifact.photo_local_path) return localUri(artifact.photo_local_path);
  return artifact.photo_cloud_url;
}

export function getArtifactThumbnailUri(artifact: ArtifactRow): string | null {
  if (artifact.thumbnail_local_path) return localUri(artifact.thumbnail_local_path);
  return artifact.thumbnail_cloud_url;
}

async function ensureDir(relativePath: string): Promise<void> {
  const fullPath = localUri(relativePath);
  const info = await FileSystem.getInfoAsync(fullPath);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(fullPath, { intermediates: true });
  }
}

export async function listArtifactsForExhibition(
  exhibitionId: string,
): Promise<ArtifactRow[]> {
  const db = await getDb();
  return db.getAllAsync<ArtifactRow>(
    `SELECT * FROM artifacts
     WHERE exhibition_id = ? AND deleted_at IS NULL
     ORDER BY photo_taken_at ASC, created_at ASC, id ASC`,
    exhibitionId,
  );
}

export async function getArtifact(id: string): Promise<ArtifactRow | null> {
  const db = await getDb();
  return db.getFirstAsync<ArtifactRow>(
    `SELECT * FROM artifacts WHERE id = ? AND deleted_at IS NULL`,
    id,
  );
}

export type CaptureArtifactInput = {
  user_id: string;
  exhibition_id: string;
  source_photo_uri: string;
  group_id: string;
};

type SaveArtifactInput = CaptureArtifactInput & {
  photo_taken_at?: string;
  latitude?: number | null;
  longitude?: number | null;
  imported_from?: string | null;
  file_operation?: 'move' | 'copy';
};

async function saveArtifactFromUri(
  input: SaveArtifactInput,
): Promise<ArtifactRow> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const takenAt = input.photo_taken_at ?? now;

  // Move/copy source image into our managed directory.
  const photoRel = `${PHOTOS_DIR}/${input.exhibition_id}/${id}.jpg`;
  const photoFull = localUri(photoRel);
  await ensureDir(`${PHOTOS_DIR}/${input.exhibition_id}`);
  if (input.file_operation === 'copy') {
    await FileSystem.copyAsync({ from: input.source_photo_uri, to: photoFull });
  } else {
    await FileSystem.moveAsync({ from: input.source_photo_uri, to: photoFull });
  }

  // Generate thumbnail (best-effort; failure shouldn't block capture).
  let thumbRel: string | null = null;
  try {
    const thumb = await ImageManipulator.manipulateAsync(
      photoFull,
      [{ resize: { width: THUMB_WIDTH } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
    );
    await ensureDir(THUMBS_DIR);
    const thumbTarget = localUri(`${THUMBS_DIR}/${id}.jpg`);
    await FileSystem.moveAsync({ from: thumb.uri, to: thumbTarget });
    thumbRel = `${THUMBS_DIR}/${id}.jpg`;
  } catch (e) {
    console.warn('[artifacts] thumbnail generation failed', e);
  }

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO artifacts
       (id, user_id, exhibition_id, photo_local_path, thumbnail_local_path,
        photo_taken_at, latitude, longitude, imported_from,
        created_at, updated_at, sync_status, group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    id,
    input.user_id,
    input.exhibition_id,
    photoRel,
    thumbRel,
    takenAt,
    input.latitude ?? null,
    input.longitude ?? null,
    input.imported_from ?? null,
    now,
    now,
    input.group_id,
  );
  await createPrimaryPhotoRowsForArtifact({
    id,
    user_id: input.user_id,
    exhibition_id: input.exhibition_id,
    photo_local_path: photoRel,
    thumbnail_local_path: thumbRel,
    photo_cloud_url: null,
    thumbnail_cloud_url: null,
    photo_taken_at: takenAt,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    imported_from: input.imported_from ?? null,
    raw_ocr_text: null,
    ocr_status: 'idle',
    ocr_error: null,
    ocr_updated_at: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    sync_status: 'pending',
  });
  const row = await db.getFirstAsync<ArtifactRow>(
    'SELECT * FROM artifacts WHERE id = ?',
    id,
  );
  if (!row) throw new Error('文物记录创建后读取失败');
  return row;
}

export async function captureArtifact(
  input: CaptureArtifactInput,
): Promise<ArtifactRow> {
  return saveArtifactFromUri({ ...input, file_operation: 'move' });
}

export type ImportArtifactInput = {
  user_id: string;
  exhibition_id: string;
  source_photo_uri: string;
  photo_taken_at?: string;
  latitude?: number | null;
  longitude?: number | null;
};

export async function importArtifact(
  input: ImportArtifactInput,
): Promise<ArtifactRow> {
  return saveArtifactFromUri({
    ...input,
    group_id: Crypto.randomUUID(),
    imported_from: 'image_library',
    file_operation: 'copy',
  });
}

export async function importArtifacts(
  inputs: ImportArtifactInput[],
): Promise<ArtifactRow[]> {
  return mapWithConcurrency(sortImportInputs(inputs), 4, importArtifact);
}

export async function createArtifactEntryFromSource(
  sourceId: string,
  patch: ArtifactInfoPatch = {},
): Promise<ArtifactRow> {
  const db = await getDb();
  const source = await getArtifact(sourceId);
  if (!source) throw new Error('Source artifact not found.');

  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO artifacts
       (id, user_id, exhibition_id, photo_local_path, thumbnail_local_path,
        photo_cloud_url, thumbnail_cloud_url,
        photo_taken_at, latitude, longitude, imported_from, group_id,
        name, dynasty, category, origin, era,
        label_description, raw_ocr_text,
        extraction_status, extraction_error, extraction_updated_at,
        created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    id,
    source.user_id,
    source.exhibition_id,
    source.photo_local_path,
    source.thumbnail_local_path,
    source.photo_cloud_url,
    source.thumbnail_cloud_url,
    source.photo_taken_at,
    source.latitude,
    source.longitude,
    'derived_entry',
    source.group_id ?? source.id,
    patch.name ?? null,
    patch.dynasty ?? null,
    patch.category ?? null,
    patch.origin ?? null,
    patch.era ?? null,
    patch.label_description ?? null,
    patch.raw_ocr_text ?? source.raw_ocr_text ?? null,
    patch.extraction_status ?? 'manual',
    patch.extraction_error ?? null,
    patch.extraction_updated_at ?? now,
    now,
    now,
  );

  await createPhotoRowsFromSourceForDerivedEntry({
    source,
    artifactId: id,
    now,
  });

  const row = await getArtifact(id);
  if (!row) throw new Error('Artifact entry was not created.');
  return row;
}

type PrimaryPhotoInput = {
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
};

async function createPrimaryPhotoRowsForArtifact(
  input: PrimaryPhotoInput,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO artifact_photos (
       id, user_id, exhibition_id, photo_local_path, thumbnail_local_path,
       photo_cloud_url, thumbnail_cloud_url,
       photo_taken_at, latitude, longitude, imported_from,
       raw_ocr_text, ocr_status, ocr_error, ocr_updated_at,
       created_at, updated_at, deleted_at, sync_status, retry_count,
       last_error, last_attempt_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`,
    input.id,
    input.user_id,
    input.exhibition_id,
    input.photo_local_path,
    input.thumbnail_local_path,
    input.photo_cloud_url,
    input.thumbnail_cloud_url,
    input.photo_taken_at,
    input.latitude,
    input.longitude,
    input.imported_from,
    input.raw_ocr_text,
    input.ocr_status,
    input.ocr_error,
    input.ocr_updated_at,
    input.created_at,
    input.updated_at,
    input.deleted_at,
    input.sync_status,
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO artifact_photo_links (
       id, user_id, exhibition_id, artifact_id, photo_id, role, sort_order,
       created_at, updated_at, deleted_at, sync_status, retry_count,
       last_error, last_attempt_at
     )
     VALUES (?, ?, ?, ?, ?, 'primary', 0, ?, ?, ?, ?, 0, NULL, NULL)`,
    `${input.id}:primary`,
    input.user_id,
    input.exhibition_id,
    input.id,
    input.id,
    input.created_at,
    input.updated_at,
    input.deleted_at,
    input.sync_status,
  );
}

async function createPhotoRowsFromSourceForDerivedEntry(input: {
  source: ArtifactRow;
  artifactId: string;
  now: string;
}): Promise<void> {
  const { source, artifactId, now } = input;
  await createPrimaryPhotoRowsForArtifact({
    id: source.id,
    user_id: source.user_id,
    exhibition_id: source.exhibition_id,
    photo_local_path: source.photo_local_path,
    thumbnail_local_path: source.thumbnail_local_path,
    photo_cloud_url: source.photo_cloud_url,
    thumbnail_cloud_url: source.thumbnail_cloud_url,
    photo_taken_at: source.photo_taken_at,
    latitude: source.latitude,
    longitude: source.longitude,
    imported_from: source.imported_from,
    raw_ocr_text: source.raw_ocr_text,
    ocr_status: source.extraction_status ?? 'idle',
    ocr_error: source.extraction_error,
    ocr_updated_at: source.extraction_updated_at,
    created_at: source.created_at,
    updated_at: source.updated_at,
    deleted_at: source.deleted_at,
    sync_status: source.sync_status,
  });

  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO artifact_photo_links (
       id, user_id, exhibition_id, artifact_id, photo_id, role, sort_order,
       created_at, updated_at, deleted_at, sync_status, retry_count,
       last_error, last_attempt_at
     )
     VALUES (?, ?, ?, ?, ?, 'primary', 0, ?, ?, NULL, 'pending', 0, NULL, NULL)`,
    `${artifactId}:${source.id}:primary`,
    source.user_id,
    source.exhibition_id,
    artifactId,
    source.id,
    now,
    now,
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function sortImportInputs(inputs: ImportArtifactInput[]): ImportArtifactInput[] {
  return [...inputs].sort((a, b) => {
    const aTime = parseImportTime(a.photo_taken_at);
    const bTime = parseImportTime(b.photo_taken_at);
    if (aTime !== bTime) return aTime - bTime;
    return a.source_photo_uri.localeCompare(b.source_photo_uri);
  });
}

function parseImportTime(value: string | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

export async function softDeleteArtifact(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE artifacts
       SET deleted_at = ?, updated_at = ?, sync_status = 'pending'
     WHERE id = ?`,
    now,
    now,
    id,
  );
}

export async function updateArtifactInfo(
  id: string,
  patch: ArtifactInfoPatch,
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<ArtifactRow>(
    'SELECT * FROM artifacts WHERE id = ?',
    id,
  );
  await db.runAsync(
    `UPDATE artifacts
       SET name = ?,
           dynasty = ?,
           category = ?,
           origin = ?,
           era = ?,
           label_description = ?,
           raw_ocr_text = ?,
           extraction_status = ?,
           extraction_error = ?,
           extraction_updated_at = ?,
           updated_at = ?,
           sync_status = 'pending'
     WHERE id = ?`,
    patch.name !== undefined ? patch.name : existing?.name ?? null,
    patch.dynasty !== undefined ? patch.dynasty : existing?.dynasty ?? null,
    patch.category !== undefined ? patch.category : existing?.category ?? null,
    patch.origin !== undefined ? patch.origin : existing?.origin ?? null,
    patch.era !== undefined ? patch.era : existing?.era ?? null,
    patch.label_description !== undefined
      ? patch.label_description
      : existing?.label_description ?? null,
    patch.raw_ocr_text !== undefined
      ? patch.raw_ocr_text
      : existing?.raw_ocr_text ?? null,
    patch.extraction_status !== undefined
      ? patch.extraction_status
      : existing?.extraction_status ?? 'manual',
    patch.extraction_error !== undefined
      ? patch.extraction_error
      : existing?.extraction_error ?? null,
    patch.extraction_updated_at !== undefined
      ? patch.extraction_updated_at
      : existing?.extraction_updated_at ?? now,
    now,
    id,
  );
}

// ---- sync helpers (batch 3.3) ----

export type ArtifactSyncCounts = {
  pending: number;
  failed: number;
};

export type ArtifactSyncProblem = {
  id: string;
  sync_status: SyncStatus;
  retry_count: number;
  last_error: string | null;
  created_at: string;
};

export async function listPendingArtifacts(
  userId: string,
): Promise<ArtifactRow[]> {
  const db = await getDb();
  return db.getAllAsync<ArtifactRow>(
    `SELECT * FROM artifacts
     WHERE user_id = ? AND sync_status IN ('pending', 'failed')
     ORDER BY created_at ASC`,
    userId,
  );
}

export async function listAllArtifactsForUser(
  userId: string,
): Promise<ArtifactRow[]> {
  const db = await getDb();
  return db.getAllAsync<ArtifactRow>(
    `SELECT * FROM artifacts WHERE user_id = ?`,
    userId,
  );
}

export async function countPendingArtifacts(
  userId: string,
): Promise<ArtifactSyncCounts> {
  const db = await getDb();
  const result = await db.getFirstAsync<ArtifactSyncCounts>(
    `SELECT
       SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM artifacts WHERE user_id = ?`,
    userId,
  );
  return {
    pending: result?.pending ?? 0,
    failed: result?.failed ?? 0,
  };
}

export async function listArtifactSyncProblems(
  userId: string,
  limit = 3,
): Promise<ArtifactSyncProblem[]> {
  const db = await getDb();
  return db.getAllAsync<ArtifactSyncProblem>(
    `SELECT id, sync_status, retry_count, last_error, created_at
     FROM artifacts
     WHERE user_id = ?
       AND deleted_at IS NULL
       AND sync_status IN ('pending', 'failed')
       AND last_error IS NOT NULL
     ORDER BY
       CASE sync_status WHEN 'failed' THEN 0 ELSE 1 END,
       last_attempt_at DESC,
       created_at DESC
     LIMIT ?`,
    userId,
    limit,
  );
}

export async function setArtifactCloudUrls(
  id: string,
  photoUrl: string | null,
  thumbnailUrl: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifacts
       SET photo_cloud_url = ?, thumbnail_cloud_url = ?
     WHERE id = ?`,
    photoUrl,
    thumbnailUrl,
    id,
  );
}

export async function markArtifactSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifacts
       SET sync_status = 'synced', last_error = NULL, last_attempt_at = ?
     WHERE id = ?`,
    new Date().toISOString(),
    id,
  );
}

export async function markArtifactSyncFailed(
  id: string,
  errorMessage: string,
  newRetryCount: number,
  status: 'pending' | 'failed',
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifacts
       SET sync_status = ?, retry_count = ?, last_error = ?, last_attempt_at = ?
     WHERE id = ?`,
    status,
    newRetryCount,
    errorMessage,
    new Date().toISOString(),
    id,
  );
}

export async function resetFailedArtifactRetries(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifacts
       SET sync_status = 'pending', retry_count = 0, last_error = NULL, last_attempt_at = NULL
     WHERE user_id = ? AND sync_status = 'failed'`,
    userId,
  );
}

export type CloudArtifact = {
  id: string;
  user_id: string;
  exhibition_id: string;
  photo_url: string | null;
  thumbnail_url: string | null;
  photo_taken_at: string;
  latitude: number | null;
  longitude: number | null;
  imported_from: string | null;
  group_id: string | null;
  name: string | null;
  dynasty: string | null;
  category: string | null;
  origin: string | null;
  era: string | null;
  label_description: string | null;
  raw_ocr_text: string | null;
  extraction_status: ExtractionStatus;
  extraction_error: string | null;
  extraction_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function upsertArtifactFromCloud(
  cloud: CloudArtifact,
): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string; sync_status: string }>(
    'SELECT id, sync_status FROM artifacts WHERE id = ?',
    cloud.id,
  );
  if (existing) {
    // Don't clobber pending local changes during pull.
    if (existing.sync_status !== 'synced') return;
    await db.runAsync(
      `UPDATE artifacts SET
       user_id = ?, exhibition_id = ?,
       photo_cloud_url = ?, thumbnail_cloud_url = ?,
         photo_taken_at = ?, latitude = ?, longitude = ?, imported_from = ?,
         group_id = ?,
         name = ?, dynasty = ?, category = ?, origin = ?, era = ?,
         label_description = ?, raw_ocr_text = ?,
         extraction_status = ?, extraction_error = ?, extraction_updated_at = ?,
         created_at = ?, updated_at = ?,
         deleted_at = NULL,
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
      cloud.group_id,
      cloud.name,
      cloud.dynasty,
      cloud.category,
      cloud.origin,
      cloud.era,
      cloud.label_description,
      cloud.raw_ocr_text,
      cloud.extraction_status ?? 'idle',
      cloud.extraction_error,
      cloud.extraction_updated_at,
      cloud.created_at,
      cloud.updated_at,
      cloud.id,
    );
  } else {
    // No local copy. Insert with empty local paths — UI uses cloud URL fallback.
    await db.runAsync(
      `INSERT INTO artifacts
         (id, user_id, exhibition_id, photo_local_path, thumbnail_local_path,
          photo_cloud_url, thumbnail_cloud_url,
          photo_taken_at, latitude, longitude, imported_from, group_id,
          name, dynasty, category, origin, era,
          label_description, raw_ocr_text,
          extraction_status, extraction_error, extraction_updated_at,
          created_at, updated_at, deleted_at, sync_status, retry_count)
       VALUES (?, ?, ?, '', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 0)`,
      cloud.id,
      cloud.user_id,
      cloud.exhibition_id,
      cloud.photo_url,
      cloud.thumbnail_url,
      cloud.photo_taken_at,
      cloud.latitude,
      cloud.longitude,
      cloud.imported_from,
      cloud.group_id,
      cloud.name,
      cloud.dynasty,
      cloud.category,
      cloud.origin,
      cloud.era,
      cloud.label_description,
      cloud.raw_ocr_text,
      cloud.extraction_status ?? 'idle',
      cloud.extraction_error,
      cloud.extraction_updated_at,
      cloud.created_at,
      cloud.updated_at,
    );
  }
}

export async function markArtifactLocallyDeleted(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE artifacts
       SET deleted_at = ?, updated_at = ?,
           sync_status = 'synced', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    now,
    now,
    id,
  );
}

export async function resetArtifactSyncStateToRetry(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE artifacts
       SET sync_status = 'pending', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    id,
  );
}
