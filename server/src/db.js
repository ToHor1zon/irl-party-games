import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'quest.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  mission_idx INTEGER NOT NULL,
  imposter_user_id INTEGER REFERENCES users(id),
  imposter_word_idx INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  imposter_caught INTEGER
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS photo_votes (
  date TEXT NOT NULL,
  voter_id INTEGER NOT NULL REFERENCES users(id),
  photo_user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (date, voter_id)
);

CREATE TABLE IF NOT EXISTS word_statuses (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('done', 'busted')),
  PRIMARY KEY (date, user_id)
);

CREATE TABLE IF NOT EXISTS imposter_votes (
  date TEXT NOT NULL,
  voter_id INTEGER NOT NULL REFERENCES users(id),
  target_user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (date, voter_id)
);

-- n — PRIMARY KEY: гонку «кто первый нашёл число» решает сама база.
CREATE TABLE IF NOT EXISTS chain_entries (
  n INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Конфиг игр из админки: одна строка JSON поверх дефолтов из content.js.
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);
`);

// Миграция для баз, созданных до появления админки.
const userCols = db.prepare('PRAGMA table_info(users)').all();
if (!userCols.some((c) => c.name === 'is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}
// Если админа ещё нет — им становится первый зарегистрированный игрок.
db.exec(`
  UPDATE users SET is_admin = 1
  WHERE id = (SELECT MIN(id) FROM users)
    AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)
`);
