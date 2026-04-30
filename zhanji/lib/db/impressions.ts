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
};

const VOICES_DIR = 'voices';

function localUri(relativePath: string): string {
  return `${FileSystem.documentDirectory}${relativePath}`;
}

export function getImpressionVoiceUri(impression: ImpressionRow): string {
  return localUri(impression.voice_local_path);
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
