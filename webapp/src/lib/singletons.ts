import { createRequire } from 'node:module';

import { MerchantDb } from './db';
import { SearchIndex } from './search';

const require = createRequire(import.meta.url);
const SqliteDatabase = require('better-sqlite3') as typeof import('better-sqlite3');

const DB_PATH = process.env.MERCHANTS_DB ?? './data/merchants.db';

/** Manifest tables whose counts snapshot_meta must match (order matters for errors). */
const MANIFEST_COUNT_TABLES = [
  'merchants',
  'sources',
  'evidence',
  'claims',
  'claim_evidence',
  'merchant_analyses',
  'merchant_identifiers',
  'merchant_aliases',
  'merchant_links',
] as const;

export interface SnapshotInfo {
  generatedAt: string;
  sourceSchemaVersion: number;
  appSchemaVersion: number;
  counts: Record<string, number>;
}

/**
 * Validate the snapshot manifest (snapshot_meta) before the DB is used:
 * missing metadata, an app schema version other than 1, a source schema
 * version other than 3, or a count mismatch throws a clear startup error.
 * There is no legacy fallback — an incompatible snapshot must never load.
 */
export function validateSnapshotManifest(dbPath: string): SnapshotInfo {
  const db = new SqliteDatabase(dbPath, { readonly: true, fileMustExist: true });
  try {
    const hasTable =
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='snapshot_meta'").get() !== undefined;
    if (!hasTable) {
      throw new Error(
        `snapshot ${dbPath}: snapshot_meta table missing — rebuild it with 'pnpm snapshot' (no legacy fallback)`,
      );
    }
    const meta = db.prepare('SELECT * FROM snapshot_meta WHERE id = 1').get() as
      | Record<string, unknown>
      | undefined;
    if (!meta) {
      throw new Error(`snapshot ${dbPath}: snapshot_meta row missing (id=1) — rebuild with 'pnpm snapshot'`);
    }
    if (meta['app_schema_version'] !== 1) {
      throw new Error(
        `snapshot ${dbPath}: app_schema_version ${String(meta['app_schema_version'])}, expected 1 — rebuild with 'pnpm snapshot'`,
      );
    }
    if (meta['source_schema_version'] !== 4) {
      throw new Error(
        `snapshot ${dbPath}: source_schema_version ${String(meta['source_schema_version'])}, expected 4 — rebuild with 'pnpm snapshot'`,
      );
    }
    const counts: Record<string, number> = {};
    for (const table of MANIFEST_COUNT_TABLES) {
      const actual = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      const column = `${table}_count`;
      const expected = meta[column];
      if (expected !== actual.n) {
        throw new Error(
          `snapshot ${dbPath}: ${column} ${String(expected)} does not match table count ${actual.n} — rebuild with 'pnpm snapshot'`,
        );
      }
      counts[table] = actual.n;
    }
    return {
      generatedAt: String(meta['generated_at']),
      sourceSchemaVersion: Number(meta['source_schema_version']),
      appSchemaVersion: Number(meta['app_schema_version']),
      counts,
    };
  } finally {
    db.close();
  }
}

let dbInstance: MerchantDb | null = null;
let indexInstance: SearchIndex | null = null;
let snapshotInfo: SnapshotInfo | null = null;

export function getDb(): MerchantDb {
  if (dbInstance === null) {
    // Validates snapshot_meta (versions 1/3, count equality) before the DB is
    // used; throws a clear startup error on an incompatible snapshot.
    snapshotInfo = validateSnapshotManifest(DB_PATH);
    dbInstance = new MerchantDb(DB_PATH);
  }
  return dbInstance;
}

export function getSnapshotInfo(): SnapshotInfo {
  if (snapshotInfo === null) {
    // Prefer the db.ts accessor once the Detail slice adds it; until then the
    // manifest is read directly by the validator (same source of truth).
    const db = dbInstance as unknown as { getSnapshotInfo?: () => SnapshotInfo } | null;
    if (db !== null && typeof db.getSnapshotInfo === 'function') {
      snapshotInfo = db.getSnapshotInfo();
    } else {
      snapshotInfo = validateSnapshotManifest(DB_PATH);
    }
  }
  return snapshotInfo;
}

export function getIndex(): SearchIndex {
  if (indexInstance === null) {
    indexInstance = SearchIndex.fromDb(getDb());
  }
  return indexInstance;
}
