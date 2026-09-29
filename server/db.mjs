// Persistent store (built-in SQLite, no dependency). Holds what must survive
// a restart: which wallets won which real-stock prizes, an append-only
// ledger of everything prize-related for auditing, and small JSON documents
// (the island council, its buildings and treasury, saved bags).
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
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, t INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  `);
  const log = db.prepare('INSERT INTO ledger (t, kind, who, wallet, data) VALUES (?, ?, ?, ?, ?)');
  const kvGet = db.prepare('SELECT v FROM kv WHERE k = ?'), kvSet = db.prepare('INSERT INTO kv (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t');
  return {
    db,
    log: (kind, { who = null, wallet = null, t = Date.now(), ...data } = {}) => log.run(t, kind, who, wallet, JSON.stringify(data)),
    /** small JSON documents that must survive restarts (council, world, saved bags) */
    get: (k) => { const r = kvGet.get(k); return r ? JSON.parse(r.v) : null; },
    put: (k, v) => kvSet.run(k, JSON.stringify(v), Date.now()),
    close: () => db.close(),
  };
}
