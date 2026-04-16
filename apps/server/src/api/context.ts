import { createDb, type Database } from '../db/connection.js';
import { env } from '../env.js';

let _db: Database | null = null;

export function initDb(connectionString?: string) {
  _db = createDb(connectionString ?? env.DATABASE_URL);
  return _db;
}

export function getDb(): Database {
  if (!_db) {
    _db = createDb(env.DATABASE_URL);
  }
  return _db;
}

export function setDb(db: Database) {
  _db = db;
}
