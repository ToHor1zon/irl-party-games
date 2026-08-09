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

-- День фиксирует цели охоты из пула (JSON), чтобы правки пула не меняли задания на лету.
CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,
  hunt_items TEXT
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

-- Бинго: фото-доказательство на клетку. Отметка в bingo_cards.marks ставится
-- только вместе с записью сюда — клетка без фото не закрывается.
CREATE TABLE IF NOT EXISTS bingo_photos (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  cell_idx INTEGER NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, user_id, cell_idx)
);

-- Фотоохота: один снимок на задание с игрока. До подтверждения его можно
-- переснять (UPDATE), после — снимок заморожен и уходит на голосование.
CREATE TABLE IF NOT EXISTS hunt_photos (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_idx INTEGER NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, user_id, item_idx)
);

-- Слова игрока на день — сырьё для персональных третьих заданий.
CREATE TABLE IF NOT EXISTS hunt_words (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  adjective TEXT NOT NULL,
  noun TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, user_id)
);

-- Выданная игроку пара из чужих слов: фиксируется при первой выдаче.
CREATE TABLE IF NOT EXISTS hunt_pairs (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  adjective TEXT NOT NULL,
  noun TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, user_id)
);

-- Старт дня: задания выдаются только после явного нажатия, а ключ по дате
-- сам обнуляет игру в полночь — назавтра нужен новый старт.
CREATE TABLE IF NOT EXISTS hunt_starts (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, user_id)
);

-- Подтверждение дня: до него снимки правятся, после — видны для голосования.
CREATE TABLE IF NOT EXISTS hunt_submissions (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, user_id)
);

-- Оценка снимка: score 0..3 по соответствию заданию, funny — «угар».
CREATE TABLE IF NOT EXISTS hunt_votes (
  date TEXT NOT NULL,
  item_idx INTEGER NOT NULL,
  voter_id INTEGER NOT NULL REFERENCES users(id),
  photo_user_id INTEGER NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 3),
  funny INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, item_idx, voter_id, photo_user_id)
);

-- «Слабо»: выполненный челлендж с фото-доказательством. dare_id завязан на
-- текст задания, а не на позицию в пуле, поэтому правки пула не переносят
-- выполненное на соседние строки.
CREATE TABLE IF NOT EXISTS dare_photos (
  user_id INTEGER NOT NULL REFERENCES users(id),
  dare_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, dare_id)
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

// Миграция после удаления игр «Тайное слово» и «Imposter Who?».
db.exec('DROP TABLE IF EXISTS word_statuses');
db.exec('DROP TABLE IF EXISTS imposter_votes');

// Фотомиссия дня и «Фотофраза» поглощены фотоохотой: миссия дублировала охоту,
// а фразы стали её третьим заданием. Снимки этих игр больше ничем не читаются,
// поэтому удаляем и строки, и файлы — иначе uploads растёт мусором навсегда.
const tableExists = (name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

if (tableExists('photos') || tableExists('phrase_assignments')) {
  const orphans = [
    ...(tableExists('photos')
      ? db.prepare('SELECT filename FROM photos').all().map((r) => r.filename)
      : []),
    ...(tableExists('phrase_assignments')
      ? db.prepare('SELECT filename FROM phrase_assignments WHERE filename IS NOT NULL').all().map((r) => r.filename)
      : []),
  ];
  for (const filename of orphans) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, filename)); } catch { /* уже нет — не беда */ }
  }
  db.exec(`
    DROP TABLE IF EXISTS photo_votes;
    DROP TABLE IF EXISTS photos;
    DROP TABLE IF EXISTS phrase_assignments;
    DROP TABLE IF EXISTS phrase_words;
    DROP TABLE IF EXISTS phrase_rounds;
  `);
}

// Игра «Цепочка чисел» удалена: снимки чисел больше ничем не читаются,
// поэтому сносим и строки, и файлы — иначе uploads растёт мусором навсегда.
if (tableExists('chain_entries')) {
  for (const { filename } of db.prepare('SELECT filename FROM chain_entries').all()) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, filename)); } catch { /* уже нет — не беда */ }
  }
  db.exec('DROP TABLE chain_entries');
}

// days сужается до (date, hunt_items): миссия дня больше не разыгрывается.
const dayCols = db.prepare('PRAGMA table_info(days)').all();
if (dayCols.some((c) => c.name === 'mission_idx' || c.name === 'imposter_user_id')) {
  db.exec(`
    CREATE TABLE days_new (date TEXT PRIMARY KEY, hunt_items TEXT);
    INSERT INTO days_new (date, hunt_items) SELECT date, hunt_items FROM days;
    DROP TABLE days;
    ALTER TABLE days_new RENAME TO days;
  `);
}
