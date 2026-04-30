import * as Crypto from 'expo-crypto';

import { getDb } from './index';

export type SyncStatus = 'pending' | 'synced' | 'failed';

export type ExhibitionRow = {
  id: string;
  user_id: string;
  name: string;
  museum: string | null;
  visit_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: SyncStatus;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
};

export type ExhibitionInsert = {
  user_id: string;
  name: string;
  museum: string | null;
  visit_date: string | null;
};

export type SyncCounts = {
  pending: number;
  failed: number;
};

export async function listExhibitions(userId: string): Promise<ExhibitionRow[]> {
  const db = await getDb();
  return db.getAllAsync<ExhibitionRow>(
    `SELECT * FROM exhibitions
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY visit_date DESC, created_at DESC`,
    userId,
  );
}

export async function getExhibition(id: string): Promise<ExhibitionRow | null> {
  const db = await getDb();
  return db.getFirstAsync<ExhibitionRow>(
    `SELECT * FROM exhibitions WHERE id = ? AND deleted_at IS NULL`,
    id,
  );
}

export async function createExhibition(input: ExhibitionInsert): Promise<ExhibitionRow> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO exhibitions
       (id, user_id, name, museum, visit_date, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    id,
    input.user_id,
    input.name,
    input.museum,
    input.visit_date,
    now,
    now,
  );
  const row = await db.getFirstAsync<ExhibitionRow>(
    'SELECT * FROM exhibitions WHERE id = ?',
    id,
  );
  if (!row) throw new Error('展览创建后读取失败');
  return row;
}

export async function softDeleteExhibition(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE exhibitions
       SET deleted_at = ?, updated_at = ?, sync_status = 'pending'
     WHERE id = ?`,
    now,
    now,
    id,
  );
}

export async function countPendingSync(userId: string): Promise<SyncCounts> {
  const db = await getDb();
  const result = await db.getFirstAsync<SyncCounts>(
    `SELECT
       SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM exhibitions WHERE user_id = ?`,
    userId,
  );
  return {
    pending: result?.pending ?? 0,
    failed: result?.failed ?? 0,
  };
}

export async function listPendingExhibitions(userId: string): Promise<ExhibitionRow[]> {
  const db = await getDb();
  return db.getAllAsync<ExhibitionRow>(
    `SELECT * FROM exhibitions
     WHERE user_id = ? AND sync_status IN ('pending', 'failed')
     ORDER BY created_at ASC`,
    userId,
  );
}

export async function markSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE exhibitions
       SET sync_status = 'synced', last_error = NULL, last_attempt_at = ?
     WHERE id = ?`,
    new Date().toISOString(),
    id,
  );
}

export async function markSyncFailed(
  id: string,
  errorMessage: string,
  newRetryCount: number,
  status: 'pending' | 'failed',
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE exhibitions
       SET sync_status = ?, retry_count = ?, last_error = ?, last_attempt_at = ?
     WHERE id = ?`,
    status,
    newRetryCount,
    errorMessage,
    new Date().toISOString(),
    id,
  );
}

export async function resetFailedRetries(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE exhibitions
       SET sync_status = 'pending', retry_count = 0, last_error = NULL, last_attempt_at = NULL
     WHERE user_id = ? AND sync_status = 'failed'`,
    userId,
  );
}

// ---- pull-sync helpers (batch 2.3) ----

/** Includes soft-deleted rows. Used for pull-sync diffing. */
export async function listAllExhibitions(userId: string): Promise<ExhibitionRow[]> {
  const db = await getDb();
  return db.getAllAsync<ExhibitionRow>(
    `SELECT * FROM exhibitions WHERE user_id = ?`,
    userId,
  );
}

export type CloudExhibition = {
  id: string;
  user_id: string;
  name: string;
  museum: string | null;
  visit_date: string | null;
  created_at: string;
  updated_at: string;
};

/** Insert or overwrite a local row with cloud state, marking it synced. */
export async function upsertExhibitionFromCloud(cloud: CloudExhibition): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM exhibitions WHERE id = ?',
    cloud.id,
  );
  if (existing) {
    await db.runAsync(
      `UPDATE exhibitions SET
         user_id = ?, name = ?, museum = ?, visit_date = ?,
         created_at = ?, updated_at = ?, deleted_at = NULL,
         sync_status = 'synced', retry_count = 0, last_error = NULL, last_attempt_at = NULL
       WHERE id = ?`,
      cloud.user_id,
      cloud.name,
      cloud.museum,
      cloud.visit_date,
      cloud.created_at,
      cloud.updated_at,
      cloud.id,
    );
  } else {
    await db.runAsync(
      `INSERT INTO exhibitions
         (id, user_id, name, museum, visit_date, created_at, updated_at,
          deleted_at, sync_status, retry_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'synced', 0)`,
      cloud.id,
      cloud.user_id,
      cloud.name,
      cloud.museum,
      cloud.visit_date,
      cloud.created_at,
      cloud.updated_at,
    );
  }
}

/** Mark a local row as deleted because the cloud no longer has it. No push needed. */
export async function markLocallyDeleted(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE exhibitions
       SET deleted_at = ?, updated_at = ?, sync_status = 'synced',
           retry_count = 0, last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    now,
    now,
    id,
  );
}

/** Reset a row's sync state so push will re-attempt (used for orphan recovery). */
export async function resetSyncStateToRetry(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE exhibitions
       SET sync_status = 'pending', retry_count = 0, last_error = NULL, last_attempt_at = NULL
     WHERE id = ?`,
    id,
  );
}
