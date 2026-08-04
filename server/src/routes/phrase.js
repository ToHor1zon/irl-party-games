import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOADS_DIR } from '../db.js';
import { getConfig } from '../config.js';
import { gameDate } from '../daily.js';
import { assignPairs } from '../phrase.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const MIN_PLAYERS = 2;
const MAX_WORD_LEN = 30;

const currentRound = () => db.prepare('SELECT * FROM phrase_rounds ORDER BY id DESC LIMIT 1').get() ?? null;

const wordsOf = (roundId) => db.prepare(`
  SELECT w.user_id, u.name, w.adjective, w.noun FROM phrase_words w
  JOIN users u ON u.id = w.user_id
  WHERE w.round_id = ? ORDER BY w.created_at ASC
`).all(roundId);

// Пока раунд собирается, чужие слова скрыты — видно только, кто уже готов.
// После старта показываем всем всё: чужие абсурдные фразы — половина веселья.
function phraseState(round, meId) {
  const cfg = getConfig().phrase;
  const base = {
    enabled: cfg.enabled,
    wordPoints: cfg.wordPoints,
    photoPoints: cfg.photoPoints,
    minPlayers: MIN_PLAYERS,
  };
  if (!round) return { ...base, round: null, players: [], myWords: null, myAssignment: null, assignments: [] };

  const words = wordsOf(round.id);
  const mine = words.find((w) => w.user_id === meId) ?? null;
  const assignments = round.status === 'collecting' ? [] : db.prepare(`
    SELECT a.user_id, u.name, a.adjective, a.noun, a.filename FROM phrase_assignments a
    JOIN users u ON u.id = a.user_id
    WHERE a.round_id = ? ORDER BY a.created_at ASC
  `).all(round.id);
  const myAssignment = assignments.find((a) => a.user_id === meId) ?? null;

  return {
    ...base,
    round: { id: round.id, status: round.status },
    players: words.map((w) => ({ userId: w.user_id, name: w.name, mine: w.user_id === meId })),
    myWords: mine ? { adjective: mine.adjective, noun: mine.noun } : null,
    myAssignment: myAssignment
      ? {
        adjective: myAssignment.adjective,
        noun: myAssignment.noun,
        url: myAssignment.filename ? `/uploads/${myAssignment.filename}` : null,
      }
      : null,
    assignments: assignments.map((a) => ({
      userId: a.user_id,
      name: a.name,
      adjective: a.adjective,
      noun: a.noun,
      url: a.filename ? `/uploads/${a.filename}` : null,
      mine: a.user_id === meId,
    })),
  };
}

const enabled = (res) => {
  if (getConfig().phrase.enabled) return true;
  res.status(403).json({ error: 'Фотофраза выключена админом' });
  return false;
};

const cleanWord = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_WORD_LEN);

const isAdmin = (userId) =>
  Boolean(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId)?.is_admin);

// SQLite отдаёт datetime('now') как 'YYYY-MM-DD HH:MM:SS' в UTC —
// приводим к игровой дате тем же способом, что и остальные игры.
const roundDate = (createdAt) => gameDate(Date.parse(`${createdAt.replace(' ', 'T')}Z`));

router.get('/', (req, res) => {
  res.json(phraseState(currentRound(), req.user.id));
});

// Архив: прошлые игры со своими словами и фотками. Ничего не удаляется —
// новая игра просто перестаёт быть текущей и уезжает сюда.
router.get('/history', (req, res) => {
  const me = req.user.id;
  const current = currentRound();
  const rounds = db.prepare(`
    SELECT id, created_at FROM phrase_rounds
    WHERE id != ? AND EXISTS (SELECT 1 FROM phrase_assignments WHERE round_id = phrase_rounds.id)
    ORDER BY id DESC LIMIT 20
  `).all(current?.id ?? 0);

  const ids = rounds.map((r) => r.id);
  const items = ids.length === 0 ? [] : db.prepare(`
    SELECT a.round_id, a.user_id, u.name, a.adjective, a.noun, a.filename FROM phrase_assignments a
    JOIN users u ON u.id = a.user_id
    WHERE a.round_id IN (${ids.map(() => '?').join(',')})
    ORDER BY a.created_at ASC
  `).all(...ids);

  res.json({
    rounds: rounds.map((r) => {
      const mine = items.filter((i) => i.round_id === r.id);
      return {
        id: r.id,
        date: roundDate(r.created_at),
        photos: mine.filter((i) => i.filename).length,
        items: mine.map((i) => ({
          userId: i.user_id,
          name: i.name,
          adjective: i.adjective,
          noun: i.noun,
          url: i.filename ? `/uploads/${i.filename}` : null,
          mine: i.user_id === me,
        })),
      };
    }),
  });
});

// Новый раунд заводит любой игрок — но только когда прошлый доигран.
router.post('/round', (req, res) => {
  if (!enabled(res)) return;
  const round = currentRound();
  if (round && round.status !== 'finished')
    return res.status(409).json({ error: 'Раунд уже идёт' });
  db.prepare("INSERT INTO phrase_rounds (status) VALUES ('collecting')").run();
  res.json({ ok: true, ...phraseState(currentRound(), req.user.id) });
});

// Слова можно переписать сколько угодно раз, пока раунд не стартовал.
router.post('/words', (req, res) => {
  if (!enabled(res)) return;
  const round = currentRound();
  if (!round) return res.status(409).json({ error: 'Раунда ещё нет — заведи новый' });
  if (round.status !== 'collecting')
    return res.status(409).json({ error: 'Слова уже разданы — жди следующий раунд' });

  const adjective = cleanWord(req.body?.adjective);
  const noun = cleanWord(req.body?.noun);
  if (!adjective || !noun)
    return res.status(400).json({ error: 'Нужны оба слова: прилагательное и существительное' });

  db.prepare(`
    INSERT INTO phrase_words (round_id, user_id, adjective, noun) VALUES (?, ?, ?, ?)
    ON CONFLICT (round_id, user_id) DO UPDATE SET adjective = excluded.adjective, noun = excluded.noun
  `).run(round.id, req.user.id, adjective, noun);

  res.json({ ok: true, ...phraseState(currentRound(), req.user.id) });
});

// Старт: пары фиксируются одной транзакцией вместе со сменой статуса,
// поэтому параллельный запрос не раздаст слова второй раз.
router.post('/start', (req, res) => {
  if (!enabled(res)) return;
  const round = currentRound();
  if (!round) return res.status(409).json({ error: 'Раунда ещё нет — заведи новый' });
  if (round.status !== 'collecting') return res.status(409).json({ error: 'Раунд уже начался' });

  const words = wordsOf(round.id);
  if (words.length < MIN_PLAYERS)
    return res.status(409).json({ error: `Нужно минимум ${MIN_PLAYERS} игрока со словами` });

  const pairs = assignPairs(words.map((w) => ({ userId: w.user_id, adjective: w.adjective, noun: w.noun })));
  const insert = db.prepare('INSERT INTO phrase_assignments (round_id, user_id, adjective, noun) VALUES (?, ?, ?, ?)');
  const start = db.transaction(() => {
    const upd = db.prepare(`
      UPDATE phrase_rounds SET status = 'playing', started_at = datetime('now')
      WHERE id = ? AND status = 'collecting'
    `).run(round.id);
    if (upd.changes === 0) throw new Error('round already started');
    for (const p of pairs) insert.run(round.id, p.userId, p.adjective, p.noun);
  });
  try {
    start();
  } catch {
    return res.status(409).json({ error: 'Раунд уже начался' });
  }
  res.json({ ok: true, ...phraseState(currentRound(), req.user.id) });
});

// Одно фото на словосочетание: переснять нельзя, как и в остальных играх.
router.post('/photo', upload.single('photo'), async (req, res) => {
  if (!enabled(res)) return;
  const round = currentRound();
  if (!round || round.status !== 'playing')
    return res.status(409).json({ error: 'Раунд сейчас не идёт' });
  if (!req.file) return res.status(400).json({ error: 'Прикрепи фото (поле photo)' });

  const me = req.user.id;
  const mine = db.prepare('SELECT filename FROM phrase_assignments WHERE round_id = ? AND user_id = ?')
    .get(round.id, me);
  if (!mine) return res.status(403).json({ error: 'В этом раунде у тебя нет фразы — заходи в следующий' });
  if (mine.filename) return res.status(409).json({ error: 'Фото уже сдано — одна попытка!' });

  const filename = `phrase-${round.id}-u${me}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  try {
    await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(path.join(UPLOADS_DIR, filename));
  } catch {
    return res.status(400).json({ error: 'Это не похоже на фото' });
  }

  const saved = db.prepare(`
    UPDATE phrase_assignments SET filename = ?
    WHERE round_id = ? AND user_id = ? AND filename IS NULL
  `).run(filename, round.id, me);
  if (saved.changes === 0) return res.status(409).json({ error: 'Фото уже сдано — одна попытка!' });

  // Все сдали — раунд закрывается сам, ждать ведущего не нужно.
  db.prepare(`
    UPDATE phrase_rounds SET status = 'finished', finished_at = datetime('now')
    WHERE id = ? AND status = 'playing'
      AND NOT EXISTS (SELECT 1 FROM phrase_assignments WHERE round_id = ? AND filename IS NULL)
  `).run(round.id, round.id);

  res.json({ ok: true, ...phraseState(currentRound(), me) });
});

// Досрочный финиш: кто-то сдался или ушёл — остальные не ждут вечно.
// Незапущенную игру (этап сбора слов) закрывает только админ — чтобы можно
// было начать заново завтра, не доигрывая брошенный раунд.
router.post('/finish', (req, res) => {
  if (!enabled(res)) return;
  const round = currentRound();
  if (!round || round.status === 'finished')
    return res.status(409).json({ error: 'Раунд сейчас не идёт' });
  if (round.status === 'collecting' && !isAdmin(req.user.id))
    return res.status(403).json({ error: 'Игру на этапе сбора слов закрывает только админ' });
  db.prepare("UPDATE phrase_rounds SET status = 'finished', finished_at = datetime('now') WHERE id = ?")
    .run(round.id);
  res.json({ ok: true, ...phraseState(currentRound(), req.user.id) });
});

export default router;
