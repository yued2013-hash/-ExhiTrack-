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
