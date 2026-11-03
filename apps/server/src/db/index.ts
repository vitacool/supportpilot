import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';
import { seedDatabase } from './seed.js';

let database: DatabaseSync | null = null;

export function initDb(): DatabaseSync {
  if (database) return database;
  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA_SQL);
  seedDatabase(db);
  database = db;
  return db;
}

export function getDb(): DatabaseSync {
  return database ?? initDb();
}

export function closeDb(): void {
  database?.close();
  database = null;
}
