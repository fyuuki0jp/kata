import { resolve } from 'node:path';
import Database from 'better-sqlite3';

export function createDatabase(path?: string): Database.Database {
  const dbPath = path ?? resolve(process.cwd(), 'data.db');
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (from_id) REFERENCES accounts(id),
      FOREIGN KEY (to_id) REFERENCES accounts(id)
    );
  `);

  return db;
}
