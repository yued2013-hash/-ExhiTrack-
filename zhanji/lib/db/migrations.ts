import type { SQLiteDatabase } from 'expo-sqlite';

export const MIGRATIONS: Array<(db: SQLiteDatabase) => Promise<void>> = [
  // v0 → v1: exhibitions
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS exhibitions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        museum TEXT,
        visit_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_exhibitions_user_id ON exhibitions(user_id);
      CREATE INDEX IF NOT EXISTS idx_exhibitions_visit_date ON exhibitions(visit_date DESC);
      CREATE INDEX IF NOT EXISTS idx_exhibitions_sync_status ON exhibitions(sync_status);
      CREATE INDEX IF NOT EXISTS idx_exhibitions_deleted_at ON exhibitions(deleted_at);
    `);
  },

  // v1 → v2: outbound sync queue metadata
  async (db) => {
    await db.execAsync(`
      ALTER TABLE exhibitions ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE exhibitions ADD COLUMN last_error TEXT;
      ALTER TABLE exhibitions ADD COLUMN last_attempt_at TEXT;
    `);
  },

  // v2 → v3: artifacts table (one record per captured photo)
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        exhibition_id TEXT NOT NULL,
        photo_local_path TEXT NOT NULL,
        thumbnail_local_path TEXT,
        photo_taken_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_attempt_at TEXT,
        FOREIGN KEY (exhibition_id) REFERENCES exhibitions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_user_id ON artifacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_exhibition_id ON artifacts(exhibition_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_sync_status ON artifacts(sync_status);
      CREATE INDEX IF NOT EXISTS idx_artifacts_deleted_at ON artifacts(deleted_at);
    `);
  },

  // v3 → v4: artifacts.group_id for multi-shot grouping
  async (db) => {
    await db.execAsync(`
      ALTER TABLE artifacts ADD COLUMN group_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_artifacts_group_id ON artifacts(group_id);
    `);
  },

  // v4 → v5: impressions table (voice notes, optionally bound to an artifact)
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS impressions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        exhibition_id TEXT NOT NULL,
        artifact_id TEXT,
        voice_local_path TEXT NOT NULL,
        voice_duration_ms INTEGER NOT NULL DEFAULT 0,
        raw_text TEXT,
        polished_text TEXT,
        recorded_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_attempt_at TEXT,
        FOREIGN KEY (exhibition_id) REFERENCES exhibitions(id) ON DELETE CASCADE,
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_impressions_user_id ON impressions(user_id);
      CREATE INDEX IF NOT EXISTS idx_impressions_exhibition_id ON impressions(exhibition_id);
      CREATE INDEX IF NOT EXISTS idx_impressions_artifact_id ON impressions(artifact_id);
      CREATE INDEX IF NOT EXISTS idx_impressions_sync_status ON impressions(sync_status);
      CREATE INDEX IF NOT EXISTS idx_impressions_deleted_at ON impressions(deleted_at);
    `);
  },
];

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = result?.user_version ?? 0;
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    await MIGRATIONS[i](db);
    // PRAGMA cannot be parameterized; i is a controlled integer.
    await db.execAsync(`PRAGMA user_version = ${i + 1}`);
  }
}
