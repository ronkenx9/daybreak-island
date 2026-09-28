// Persistent store (built-in SQLite, no dependency). Holds what must survive
// a restart: which wallets won which real-stock prizes, and an append-only
// ledger of everything prize-related for auditing.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path = process.env.DB_PATH || 'data/island.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS prizes (
      id TEXT PRIMARY KEY,            -- voucher id (random 128-bit, decimal)
      day INTEGER NOT NULL,           -- UTC day it was won
      wallet TEXT NOT NULL,           -- lowercase address
      player TEXT NOT NULL,
      ticker TEXT NOT NULL,
      token TEXT NOT NULL,
      amount TEXT NOT NULL,           -- wei, decimal string
      expiry INTEGER NOT NULL,        -- unix seconds
      signature TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'issued', -- issued | claimed | expired
      created_at INTEGER NOT NULL,
      UNIQUE (day, wallet)            -- one prize per wallet per day
    );
    CREATE INDEX IF NOT EXISTS prizes_day ON prizes (day);
    CREATE TABLE IF NOT EXISTS ledger (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      t INTEGER NOT NULL,
      kind TEXT NOT NULL,
      who TEXT,
      wallet TEXT,
      data TEXT
    );
    CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  `);
  const log = db.prepare('INSERT INTO ledger (t, kind, who, wallet, data) VALUES (?, ?, ?, ?, ?)');
  return {
    db,
    log: (kind, { who = null, wallet = null, t = Date.now(), ...data } = {}) => log.run(t, kind, who, wallet, JSON.stringify(data)),
    close: () => db.close(),
  };
}
