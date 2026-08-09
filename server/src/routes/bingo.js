import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOADS_DIR } from '../db.js';
import { gameDate } from '../daily.js';
import { getConfig } from '../config.js';
import { BINGO_CELLS, generateCard, countLines, cardScore } from '../bingo.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Карточка дня: создаётся при первом запросе и больше не меняется.
function ensureCard(date, userId) {
  let row = db.prepare('SELECT * FROM bingo_cards WHERE date = ? AND user_id = ?').get(date, userId);
  if (!row) {
    const words = generateCard(date, userId, getConfig().bingo.words);
    db.prepare('INSERT OR IGNORE INTO bingo_cards (date, user_id, words, marks) VALUES (?, ?, ?, ?)')
      .run(date, userId, JSON.stringify(words), JSON.stringify(Array(BINGO_CELLS).fill(0)));
    row = db.prepare('SELECT * FROM bingo_cards WHERE date = ? AND user_id = ?').get(date, userId);
  }
  return row;
}

function setMark(date, userId, cell, value) {
  const row = db.prepare('SELECT marks FROM bingo_cards WHERE date = ? AND user_id = ?').get(date, userId);
  const marks = JSON.parse(row.marks);
  marks[cell] = value;
  db.prepare('UPDATE bingo_cards SET marks = ? WHERE date = ? AND user_id = ?')
    .run(JSON.stringify(marks), date, userId);
}

// Отметка и фото меняются только вместе, поэтому обе записи — в одной транзакции.
const closeCell = db.transaction((date, userId, cell, filename) => {
  db.prepare('INSERT INTO bingo_photos (date, user_id, cell_idx, filename) VALUES (?, ?, ?, ?)')
    .run(date, userId, cell, filename);
  setMark(date, userId, cell, 1);
});

const openCell = db.transaction((date, userId, cell) => {
  db.prepare('DELETE FROM bingo_photos WHERE date = ? AND user_id = ? AND cell_idx = ?')
    .run(date, userId, cell);
  setMark(date, userId, cell, 0);
});

function cardState(date, userId) {
  const cfg = getConfig().bingo;
  const row = ensureCard(date, userId);
  const words = JSON.parse(row.words);
  const marks = JSON.parse(row.marks);
  const shots = new Map(
    db.prepare('SELECT cell_idx, filename FROM bingo_photos WHERE date = ? AND user_id = ?')
      .all(date, userId)
      .map((p) => [p.cell_idx, p.filename]),
  );
  return {
    enabled: cfg.enabled,
    date,
    cellPoints: cfg.cellPoints,
    linePoints: cfg.linePoints,
    cardPoints: cfg.cardPoints,
    cells: words.map((word, i) => ({
      word,
      marked: Boolean(marks[i]),
      photoUrl: shots.has(i) ? `/uploads/${shots.get(i)}` : null,
    })),
    marked: marks.filter(Boolean).length,
    lines: countLines(marks),
    score: cardScore(marks, cfg),
  };
}

function parseCell(raw) {
  const cell = Number(raw);
  return Number.isInteger(cell) && cell >= 0 && cell < BINGO_CELLS ? cell : null;
}

router.get('/', (req, res) => {
  if (!getConfig().bingo.enabled) return res.json({ enabled: false });
  res.json(cardState(gameDate(), req.user.id));
});

// Закрыть клетку. Доказательство — только фото: без него отметки не бывает,
// поэтому отдельного «отметить без фото» здесь нет.
router.post('/cell', upload.single('photo'), async (req, res) => {
  if (!getConfig().bingo.enabled)
    return res.status(403).json({ error: 'Бинго выключено админом' });
  if (!req.file) return res.status(400).json({ error: 'Прикрепи фото-доказательство (поле photo)' });

  const cell = parseCell(req.body?.cell);
  if (cell === null)
    return res.status(400).json({ error: `cell должен быть от 0 до ${BINGO_CELLS - 1}` });

  const date = gameDate();
  const me = req.user.id;
  ensureCard(date, me);
  if (db.prepare('SELECT 1 FROM bingo_photos WHERE date = ? AND user_id = ? AND cell_idx = ?').get(date, me, cell))
    return res.status(409).json({ error: 'Клетка уже закрыта — сбрось отметку, чтобы переснять' });

  const filename = `bingo-${date}-c${cell}-u${me}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  try {
    await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(path.join(UPLOADS_DIR, filename));
  } catch {
    return res.status(400).json({ error: 'Это не похоже на фото' });
  }

  try {
    closeCell(date, me, cell, filename);
  } catch {
    fs.promises.unlink(path.join(UPLOADS_DIR, filename)).catch(() => {});
    return res.status(409).json({ error: 'Клетка уже закрыта — обнови страницу' });
  }
  res.json({ ok: true, ...cardState(date, me) });
});

// Сбросить клетку: снимаем отметку и удаляем фото — переснять можно заново.
router.delete('/cell/:idx', (req, res) => {
  if (!getConfig().bingo.enabled)
    return res.status(403).json({ error: 'Бинго выключено админом' });

  const cell = parseCell(req.params.idx);
  if (cell === null)
    return res.status(400).json({ error: `cell должен быть от 0 до ${BINGO_CELLS - 1}` });

  const date = gameDate();
  const me = req.user.id;
  ensureCard(date, me);
  const shot = db.prepare('SELECT filename FROM bingo_photos WHERE date = ? AND user_id = ? AND cell_idx = ?')
    .get(date, me, cell);
  if (!shot) return res.status(409).json({ error: 'Клетка и так открыта — обнови страницу' });

  openCell(date, me, cell);
  fs.promises.unlink(path.join(UPLOADS_DIR, shot.filename)).catch(() => {});
  res.json({ ok: true, ...cardState(date, me) });
});

export default router;
