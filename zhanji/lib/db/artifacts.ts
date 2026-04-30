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
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  group_id: string | null;
};

const PHOTOS_DIR = 'photos';
const THUMBS_DIR = 'thumbnails';
const THUMB_WIDTH = 480;

function localUri(relativePath: string): string {
  return `${FileSystem.documentDirectory}${relativePath}`;
}

export function getArtifactPhotoUri(artifact: ArtifactRow): string {
  return localUri(artifact.photo_local_path);
}

export function getArtifactThumbnailUri(artifact: ArtifactRow): string | null {
  if (!artifact.thumbnail_local_path) return null;
  return localUri(artifact.thumbnail_local_path);
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
     ORDER BY photo_taken_at ASC`,
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

export async function captureArtifact(
  input: CaptureArtifactInput,
): Promise<ArtifactRow> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();

  // Move photo from camera tmp into our managed directory.
  const photoRel = `${PHOTOS_DIR}/${input.exhibition_id}/${id}.jpg`;
  const photoFull = localUri(photoRel);
  await ensureDir(`${PHOTOS_DIR}/${input.exhibition_id}`);
  await FileSystem.moveAsync({ from: input.source_photo_uri, to: photoFull });

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
        photo_taken_at, created_at, updated_at, sync_status, group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    id,
    input.user_id,
    input.exhibition_id,
    photoRel,
    thumbRel,
    now,
    now,
    now,
    input.group_id,
  );
  const row = await db.getFirstAsync<ArtifactRow>(
    'SELECT * FROM artifacts WHERE id = ?',
    id,
  );
  if (!row) throw new Error('文物记录创建后读取失败');
  return row;
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
