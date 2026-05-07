import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { getDb } from './index';

export type SyncStatus = 'pending' | 'synced' | 'failed';

export type ImpressionRow = {
  id: string;
  user_id: string;
  exhibition_id: string;
  artifact_id: string | null;
  voice_local_path: string; // relative to FileSystem.documentDirectory
  voice_duration_ms: number;
  raw_text: string | null;
  polished_text: string | null;
  recorded_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  voice_cloud_url: string | null;
};

const VOICES_DIR = 'voices';

function localUri(relativePath: string): string {
  return `${FileSystem.documentDirectory}${relativePath}`;
}

export function getImpressionVoiceUri(impression: ImpressionRow): string | null {
  if (impression.voice_local_path) return localUri(impression.voice_local_path);
  return impression.voice_cloud_url;
}

async function ensureDir(relativePath: string): Promise<void> {
  const fullPath = localUri(relativePath);
  const info = await FileSystem.getInfoAsync(fullPath);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(fullPath, { intermediates: true });
  }
}

export async function listImpressionsForExhibition(
  exhibitionId: string,
): Promise<ImpressionRow[]> {
  const db = await getDb();
  return db.getAllAsync<ImpressionRow>(
    `SELECT * FROM impressions
     WHERE exhibition_id = ? AND deleted_at IS NULL
     ORDER BY recorded_at ASC`,
    exhibitionId,
  );
}

export type CreateImpressionInput = {
  user_id: string;
  exhibition_id: string;
  artifact_id: string | null;
  source_voice_uri: string;
  voice_duration_ms: number;
};

export async function createImpression(
  input: CreateImpressionInput,
): Promise<ImpressionRow> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();

  // Move audio file from recorder's tmp location into our managed directory.
  const voiceRel = `${VOICES_DIR}/${input.exhibition_id}/${id}.m4a`;
  const voiceFull = localUri(voiceRel);
  await ensureDir(`${VOICES_DIR}/${input.exhibition_id}`);
  await FileSystem.moveAsync({ from: input.source_voice_uri, to: voiceFull });

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO impressions
       (id, user_id, exhibition_id, artifact_id, voice_local_path,
        voice_duration_ms, recorded_at, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    id,
    input.user_id,
    input.exhibition_id,
    input.artifact_id,
    voiceRel,
    Math.max(0, Math.round(input.voice_duration_ms)),
    now,
    now,
    now,
  );
  const row = await db.getFirstAsync<ImpressionRow>(
    'SELECT * FROM impressions WHERE id = ?',
    id,
  );
  if (!row) throw new Error('感受记录创建后读取失败');
  return row;
}

export async function softDeleteImpression(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE impressions
       SET deleted_at = ?, updated_at = ?, sync_status = 'pending'
     WHERE id = ?`,
    now,
    now,
    id,
  );
}

// ---- sync helpers (batch 3.3) ----

export type ImpressionSyncCounts = {
  pending: number;
  failed: number;
};

export type ImpressionSyncProblem = {
  id: string;
  sync_status: SyncStatus;
  retry_count: number;
  last_error: string | null;
  created_at: string;
};

export async function listPendingImpressions(
  userId: string,
): Promise<ImpressionRow[]> {
  const db = await getDb();
  return db.getAllAsync<ImpressionRow>(
    `SELECT * FROM impressions
     WHERE user_id = ? AND sync_status IN ('pending', 'failed')
     ORDER BY created_at ASC`,
    userId,
  );
}

export async function listAllImpressionsForUser(
  userId: string,
): Promise<ImpressionRow[]> {
  const db = await getDb();
  return db.getAllAsync<ImpressionRow>(
    `SELECT * FROM impressions WHERE user_id = ?`,
    userId,
  );
}

export async function countPendingImpressions(
  userId: string,
): Promise<ImpressionSyncCounts> {
  const db = await getDb();
  const result = await db.getFirstAsync<ImpressionSyncCounts>(
    `SELECT
       SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM impressions WHERE user_id = ?`,
    userId,
  );
  return {
    pending: result?.pending ?? 0,
    failed: result?.failed ?? 0,
  };
}

export async function listImpressionSyncProblems(
  userId: string,
  limit = 3,
): Promise<ImpressionSyncProblem[]> {
  const db = await getDb();
  return db.getAllAsync<ImpressionSyncProblem>(
    `SELECT id, sync_status, retry_count, last_error, created_at
     FROM impressions
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

export async function setImpressionCloudUrl(
  id: string,
  voiceUrl: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE impressions SET voice_cloud_url = ? WHERE id = ?`,
    voiceUrl,
    id,
  );
}

export async function markImpressionSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE impressions
       SET sync_status = 'synced', last_error = NULL, last_attempt_at = ?
     WHERE id = ?`,
    new Date().toISOString(),
    id,
  );
}

export async function markImpressionSyncFailed(
  id: string,
  errorMessage: string,
  newRetryCount: number,
  status: 'pending' | 'failed',
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE impressions
       SET sync_status = ?, retry_count = ?, last_error = ?, last_attempt_at = ?
     WHERE id = ?`,
    status,
    newRetryCount,
    errorMessage,
    new Date().toISOString(),
    id,
  );
}

export async function resetFailedImpressionRetries(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE impressions
       SET sync_status = 'pending', retry_count = 0, last_error = NULL, last_attempt_at = NULL
     WHERE user_id = ? AND sync_status = 'failed'`,
    userId,
  );
}

export type CloudImpression = {
  id: string;
  user_id: string;
  exhibition_id: string;
  artifact_id: string | null;
  voice_url: string | null;
  voice_duration_ms: number;
  raw_text: string | null;
  polished_text: string | null;
  recorded_at: string;
  created_at: string;
  updated_at: string;
};

export async function upsertImpressionFromCloud(
  cloud: CloudImpression,
): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string; sync_status: string }>(
    'SELECT id, sync_status FROM impressions WHERE id = ?',
    cloud.id,
  );
  if (existing) {
    if (existing.sync_status !== 'synced') return;
    await db.runAsync(
      `UPDATE impressions SET
         user_id = ?, exhibition_id = ?, artifact_id = ?,
         voice_cloud_url = ?, voice_duration_ms = ?,
         raw_text = ?, polished_text = ?,
         recorded_at = ?, created_at = ?, updated_at = ?,
         deleted_at = NULL,
         sync_status = 'synced', retry_count = 0,
         last_error = NULL, last_attempt_at = NULL
       WHERE id = ?`,
      cloud.user_id,
      cloud.exhibition_id,
      cloud.artifact_id,
      cloud.voice_url,
      cloud.voice_duration_ms,
      cloud.raw_text,
      cloud.polished_text,
      cloud.recorded_at,
      cloud.created_at,
      cloud.updated_at,
      cloud.id,
    );
  } else {
    await db.runAsync(
      `INSERT INTO impressions
         (id, user_id, exhibition_id, artifact_id, voice_local_path,
          voice_cloud_url, voice_duration_ms,
          raw_text, polished_text, recorded_at,
          created_at, updated_at, deleted_at, sync_status, retry_count)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 0)`,
      cloud.id,
      cloud.user_id,
      cloud.exhibition_id,
      cloud.artifact_id,
      cloud.voice_url,
      cloud.voice_duration_ms,
      cloud.raw_text,
      cloud.polished_text,
      cloud.recorded_at,
      cloud.created_at,
      cloud.updated_at,
    );
  }
}

export async function markImpressionLocallyDeleted(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE impressions
       SET deleted_at = ?, updated_at = ?,
           sync_status = 'synced', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    now,
    now,
    id,
  );
}

export async function resetImpressionSyncStateToRetry(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE impressions
       SET sync_status = 'pending', retry_count = 0,
           last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    id,
  );
}
