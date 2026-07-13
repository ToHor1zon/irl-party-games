import { Router } from 'express';
import { db } from '../db.js';
import { gameDate } from '../daily.js';
import { getConfig } from '../config.js';
import { BINGO_CELLS, generateCard, countLines, cardScore } from '../bingo.js';

const router = Router();

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

function cardState(date, userId) {
  const cfg = getConfig().bingo;
  const row = ensureCard(date, userId);
  const words = JSON.parse(row.words);
  const marks = JSON.parse(row.marks);
  return {
    enabled: cfg.enabled,
    date,
    cellPoints: cfg.cellPoints,
    linePoints: cfg.linePoints,
    cardPoints: cfg.cardPoints,
    cells: words.map((word, i) => ({ word, marked: Boolean(marks[i]) })),
    marked: marks.filter(Boolean).length,
    lines: countLines(marks),
    score: cardScore(marks, cfg),
  };
}

router.get('/', (req, res) => {
  if (!getConfig().bingo.enabled) return res.json({ enabled: false });
  res.json(cardState(gameDate(), req.user.id));
});

// Отметить или сбросить клетку. Подтверждение — на клиенте, здесь только
// явное целевое состояние, чтобы двойной тап не отменил сам себя.
router.post('/mark', (req, res) => {
  if (!getConfig().bingo.enabled)
    return res.status(403).json({ error: 'Бинго выключено админом' });
  const cell = Number(req.body?.cell);
  const marked = req.body?.marked;
  if (!Number.isInteger(cell) || cell < 0 || cell >= BINGO_CELLS)
    return res.status(400).json({ error: `cell должен быть от 0 до ${BINGO_CELLS - 1}` });
  if (typeof marked !== 'boolean')
    return res.status(400).json({ error: 'marked должен быть true или false' });

  const date = gameDate();
  const row = ensureCard(date, req.user.id);
  const marks = JSON.parse(row.marks);
  if (Boolean(marks[cell]) === marked)
    return res.status(409).json({ error: 'Клетка уже в этом состоянии — обнови страницу' });
  marks[cell] = marked ? 1 : 0;
  db.prepare('UPDATE bingo_cards SET marks = ? WHERE date = ? AND user_id = ?')
    .run(JSON.stringify(marks), date, req.user.id);
  res.json({ ok: true, ...cardState(date, req.user.id) });
});

export default router;
