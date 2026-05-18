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

  // v5 → v6: cloud URLs cached locally so push doesn't re-upload files.
  async (db) => {
    await db.execAsync(`
      ALTER TABLE artifacts ADD COLUMN photo_cloud_url TEXT;
      ALTER TABLE artifacts ADD COLUMN thumbnail_cloud_url TEXT;
      ALTER TABLE impressions ADD COLUMN voice_cloud_url TEXT;
    `);
  },

  // v6 → v7: EXIF metadata for imported photos.
  async (db) => {
    await db.execAsync(`
      ALTER TABLE artifacts ADD COLUMN latitude REAL;
      ALTER TABLE artifacts ADD COLUMN longitude REAL;
      ALTER TABLE artifacts ADD COLUMN imported_from TEXT;
      CREATE INDEX IF NOT EXISTS idx_artifacts_photo_taken_at ON artifacts(photo_taken_at);
    `);
  },

  // v7 → v8: structured artifact information extracted from exhibit labels.
  async (db) => {
    await db.execAsync(`
      ALTER TABLE artifacts ADD COLUMN name TEXT;
      ALTER TABLE artifacts ADD COLUMN dynasty TEXT;
      ALTER TABLE artifacts ADD COLUMN category TEXT;
      ALTER TABLE artifacts ADD COLUMN origin TEXT;
      ALTER TABLE artifacts ADD COLUMN era TEXT;
      ALTER TABLE artifacts ADD COLUMN label_description TEXT;
      ALTER TABLE artifacts ADD COLUMN raw_ocr_text TEXT;
      ALTER TABLE artifacts ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'idle';
      ALTER TABLE artifacts ADD COLUMN extraction_error TEXT;
      ALTER TABLE artifacts ADD COLUMN extraction_updated_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_artifacts_extraction_status ON artifacts(extraction_status);
    `);
  },

  // v8 -> v9: formal photo/material model for many-to-many artifact photos.
  async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS artifact_photos (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        exhibition_id TEXT NOT NULL,
        photo_local_path TEXT NOT NULL,
        thumbnail_local_path TEXT,
        photo_cloud_url TEXT,
        thumbnail_cloud_url TEXT,
        photo_taken_at TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        imported_from TEXT,
        raw_ocr_text TEXT,
        ocr_status TEXT NOT NULL DEFAULT 'idle',
        ocr_error TEXT,
        ocr_updated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_attempt_at TEXT,
        FOREIGN KEY (exhibition_id) REFERENCES exhibitions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_artifact_photos_user_id ON artifact_photos(user_id);
      CREATE INDEX IF NOT EXISTS idx_artifact_photos_exhibition_id ON artifact_photos(exhibition_id);
      CREATE INDEX IF NOT EXISTS idx_artifact_photos_sync_status ON artifact_photos(sync_status);
      CREATE INDEX IF NOT EXISTS idx_artifact_photos_deleted_at ON artifact_photos(deleted_at);

      CREATE TABLE IF NOT EXISTS artifact_photo_links (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        exhibition_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        photo_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'primary',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        last_attempt_at TEXT,
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
        FOREIGN KEY (photo_id) REFERENCES artifact_photos(id) ON DELETE CASCADE,
        FOREIGN KEY (exhibition_id) REFERENCES exhibitions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_artifact_photo_links_user_id ON artifact_photo_links(user_id);
      CREATE INDEX IF NOT EXISTS idx_artifact_photo_links_artifact_id ON artifact_photo_links(artifact_id);
      CREATE INDEX IF NOT EXISTS idx_artifact_photo_links_photo_id ON artifact_photo_links(photo_id);
      CREATE INDEX IF NOT EXISTS idx_artifact_photo_links_exhibition_id ON artifact_photo_links(exhibition_id);
      CREATE INDEX IF NOT EXISTS idx_artifact_photo_links_sync_status ON artifact_photo_links(sync_status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_photo_links_unique_active
        ON artifact_photo_links(artifact_id, photo_id, role)
        WHERE deleted_at IS NULL;

      INSERT OR IGNORE INTO artifact_photos (
        id, user_id, exhibition_id, photo_local_path, thumbnail_local_path,
        photo_cloud_url, thumbnail_cloud_url,
        photo_taken_at, latitude, longitude, imported_from,
        raw_ocr_text, ocr_status, ocr_error, ocr_updated_at,
        created_at, updated_at, deleted_at, sync_status, retry_count,
        last_error, last_attempt_at
      )
      SELECT
        id, user_id, exhibition_id, photo_local_path, thumbnail_local_path,
        photo_cloud_url, thumbnail_cloud_url,
        photo_taken_at, latitude, longitude, imported_from,
        raw_ocr_text, extraction_status, extraction_error, extraction_updated_at,
        created_at, updated_at, deleted_at, sync_status, retry_count,
        last_error, last_attempt_at
      FROM artifacts;

      INSERT OR IGNORE INTO artifact_photo_links (
        id, user_id, exhibition_id, artifact_id, photo_id, role, sort_order,
        created_at, updated_at, deleted_at, sync_status, retry_count,
        last_error, last_attempt_at
      )
      SELECT
        id || ':primary', user_id, exhibition_id, id, id, 'primary', 0,
        created_at, updated_at, deleted_at, sync_status, retry_count,
        last_error, last_attempt_at
      FROM artifacts;
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
