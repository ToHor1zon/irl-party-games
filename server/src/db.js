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
  hunt_items TEXT
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

-- n — PRIMARY KEY: гонку «кто первый нашёл число» решает сама база.
CREATE TABLE IF NOT EXISTS chain_entries (
  n INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Бинго: карточка дня фиксируется при первом запросе (words — JSON из 25 слов),
-- отметки — JSON из 25 нулей/единиц. Правки пула не меняют выданные карточки.
CREATE TABLE IF NOT EXISTS bingo_cards (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  words TEXT NOT NULL,
  marks TEXT NOT NULL,
  PRIMARY KEY (date, user_id)
);

-- Фотоохота: одно фото-доказательство на цель дня с игрока.
CREATE TABLE IF NOT EXISTS hunt_photos (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_idx INTEGER NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, user_id, item_idx)
);

-- Фотофраза: раунд живёт по своему циклу, а не по игровому дню.
-- collecting → playing → finished; текущий раунд — всегда с максимальным id.
CREATE TABLE IF NOT EXISTS phrase_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'collecting',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

-- Пара слов от игрока: пока раунд собирается, чужие слова никому не видны.
CREATE TABLE IF NOT EXISTS phrase_words (
  round_id INTEGER NOT NULL REFERENCES phrase_rounds(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  adjective TEXT NOT NULL,
  noun TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (round_id, user_id)
);

-- Выданное словосочетание и фото-ответ на него.
CREATE TABLE IF NOT EXISTS phrase_assignments (
  round_id INTEGER NOT NULL REFERENCES phrase_rounds(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  adjective TEXT NOT NULL,
  noun TEXT NOT NULL,
  filename TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (round_id, user_id)
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

// Миграция после удаления игр «Тайное слово» и «Imposter Who?»:
// их таблицы сносятся, days сужается до (date, mission_idx).
db.exec('DROP TABLE IF EXISTS word_statuses');
db.exec('DROP TABLE IF EXISTS imposter_votes');
const dayCols = db.prepare('PRAGMA table_info(days)').all();
if (dayCols.some((c) => c.name === 'imposter_user_id')) {
  db.exec(`
    CREATE TABLE days_new (date TEXT PRIMARY KEY, mission_idx INTEGER NOT NULL);
    INSERT INTO days_new SELECT date, mission_idx FROM days;
    DROP TABLE days;
    ALTER TABLE days_new RENAME TO days;
  `);
}

// Фотоохота: цели дня фиксируются в days.hunt_items (JSON из 3 строк).
const dayColsAfter = db.prepare('PRAGMA table_info(days)').all();
if (!dayColsAfter.some((c) => c.name === 'hunt_items')) {
  db.exec('ALTER TABLE days ADD COLUMN hunt_items TEXT');
}
