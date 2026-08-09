import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOADS_DIR } from '../db.js';
import { gameDate, ensureDay, poolItemsOf, PERSONAL_ITEM_IDX } from '../daily.js';
import { getConfig } from '../config.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const MAX_WORD_LEN = 30;
const cleanWord = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_WORD_LEN);

const isConfirmed = (date, userId) =>
  Boolean(db.prepare('SELECT 1 FROM hunt_submissions WHERE date = ? AND user_id = ?').get(date, userId));

// Игра начинается по кнопке. Ключ по дате означает, что в полночь запись
// перестаёт находиться и день сам собой начинается заново.
const isStarted = (date, userId) =>
  Boolean(db.prepare('SELECT 1 FROM hunt_starts WHERE date = ? AND user_id = ?').get(date, userId));

const pairOf = (date, userId) =>
  db.prepare('SELECT adjective, noun FROM hunt_pairs WHERE date = ? AND user_id = ?').get(date, userId) ?? null;

// Персональное задание собирается из чужих слов и фиксируется при первой выдаче.
// Ленивая выдача вместо раундов снимает проблему разного времени захода: игроку
// достаточно, чтобы свои слова сдал хоть кто-то ещё.
function ensurePair(date, userId) {
  const existing = pairOf(date, userId);
  if (existing) return existing;

  // Задание собирается из всего, что сдали другие: свои слова — вклад в общий
  // котёл, а не пропуск к заданию. Если сегодня ещё никто не сдал, берём из
  // ранее собранных, иначе первый зашедший навсегда застревал бы в ожидании.
  let others = db.prepare('SELECT adjective, noun FROM hunt_words WHERE date = ? AND user_id != ?')
    .all(date, userId);
  if (others.length === 0) {
    others = db.prepare(`
      SELECT adjective, noun FROM hunt_words WHERE user_id != ?
      ORDER BY date DESC LIMIT 50
    `).all(userId);
  }
  if (others.length === 0) return null;

  // Отсев по тексту, а не только по автору: одно и то же слово могли сдать
  // двое, и игроку не должно вернуться то, что он написал сам.
  const mine = db.prepare('SELECT adjective, noun FROM hunt_words WHERE user_id = ?').all(userId);
  const banned = new Set(mine.flatMap((w) => [w.adjective, w.noun]).map((s) => s.toLowerCase()));
  const free = (list) => list.filter((s) => !banned.has(s.toLowerCase()));

  const adjectives = free(others.map((w) => w.adjective));
  const nouns = free(others.map((w) => w.noun));
  if (adjectives.length === 0 || nouns.length === 0) return null;

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  db.prepare('INSERT OR IGNORE INTO hunt_pairs (date, user_id, adjective, noun) VALUES (?, ?, ?, ?)')
    .run(date, userId, pick(adjectives), pick(nouns));
  return pairOf(date, userId);
}

// Текст задания зависит от автора снимка: персональное у каждого своё.
function itemTextFor(date, authorId, idx, pool) {
  if (idx < pool.length) return pool[idx];
  if (idx !== PERSONAL_ITEM_IDX) return null;
  const pair = pairOf(date, authorId);
  return pair ? `${pair.adjective} ${pair.noun}` : null;
}

// Очередь голосования: чужие подтверждённые снимки, которые я ещё не оценил.
// Имя автора наружу не отдаётся — оценка должна достаться кадру, а не человеку.
function voteQueue(date, meId) {
  return db.prepare(`
    SELECT p.item_idx, p.user_id, p.filename FROM hunt_photos p
    JOIN hunt_submissions s ON s.date = p.date AND s.user_id = p.user_id
    WHERE p.date = ? AND p.user_id != ?
      AND NOT EXISTS (
        SELECT 1 FROM hunt_votes v
        WHERE v.date = p.date AND v.item_idx = p.item_idx
          AND v.voter_id = ? AND v.photo_user_id = p.user_id
      )
    ORDER BY p.created_at ASC
  `).all(date, meId, meId);
}

function huntState(date, meId) {
  const cfg = getConfig().hunt;
  const pool = poolItemsOf(ensureDay(date));
  const started = isStarted(date, meId);
  const confirmed = isConfirmed(date, meId);
  const pair = ensurePair(date, meId);
  const shots = new Map(
    db.prepare('SELECT item_idx, filename FROM hunt_photos WHERE date = ? AND user_id = ?')
      .all(date, meId)
      .map((r) => [r.item_idx, r.filename]),
  );
  const urlOf = (idx) => (shots.has(idx) ? `/uploads/${shots.get(idx)}` : null);

  const items = pool.map((text, idx) => ({ idx, text, personal: false, myUrl: urlOf(idx) }));
  items.push({
    idx: PERSONAL_ITEM_IDX,
    text: pair ? `${pair.adjective} ${pair.noun}` : null,
    personal: true,
    myUrl: urlOf(PERSONAL_ITEM_IDX),
  });

  return {
    enabled: cfg.enabled,
    date,
    funnyBonus: cfg.funnyBonus,
    started,
    confirmed,
    myWords: db.prepare('SELECT adjective, noun FROM hunt_words WHERE date = ? AND user_id = ?')
      .get(date, meId) ?? null,
    othersWithWords: db.prepare('SELECT COUNT(*) AS c FROM hunt_words WHERE date = ? AND user_id != ?')
      .get(date, meId).c,
    // До старта задания не показываются — иначе кнопка теряет смысл.
    items: started ? items : [],
    shotCount: shots.size,
    pendingVotes: voteQueue(date, meId).length,
  };
}

const enabled = (res) => {
  if (getConfig().hunt.enabled) return true;
  res.status(403).json({ error: 'Фотоохота выключена админом' });
  return false;
};

router.get('/', (req, res) => {
  if (!getConfig().hunt.enabled) return res.json({ enabled: false, items: [] });
  res.json(huntState(gameDate(), req.user.id));
});

// Старт дня по кнопке: до него заданий не видно. Назавтра ключ по дате
// перестанет совпадать, и день начнётся заново — отдельная чистка не нужна.
router.post('/start', (req, res) => {
  if (!enabled(res)) return;
  const date = gameDate();
  const me = req.user.id;
  if (isStarted(date, me)) return res.status(409).json({ error: 'Задания на сегодня уже получены' });
  db.prepare('INSERT OR IGNORE INTO hunt_starts (date, user_id) VALUES (?, ?)').run(date, me);
  res.json({ ok: true, ...huntState(date, me) });
});

// Личная галерея: свои снимки по всем дням с набранными оценками.
// Оценки считаются на лету, поэтому цифры всегда актуальные.
router.get('/gallery', (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`
    SELECT p.date, p.item_idx, p.filename,
           COALESCE(SUM(v.score), 0) AS score,
           COALESCE(SUM(v.funny), 0) AS funny,
           COUNT(v.voter_id) AS voters
    FROM hunt_photos p
    LEFT JOIN hunt_votes v
      ON v.date = p.date AND v.item_idx = p.item_idx AND v.photo_user_id = p.user_id
    WHERE p.user_id = ?
    GROUP BY p.date, p.item_idx, p.filename
    ORDER BY p.date DESC, p.item_idx ASC
  `).all(me);

  const pools = new Map();
  const poolFor = (date) => {
    if (!pools.has(date)) {
      const day = db.prepare('SELECT * FROM days WHERE date = ?').get(date);
      pools.set(date, day ? poolItemsOf(day) : []);
    }
    return pools.get(date);
  };

  const days = [];
  for (const r of rows) {
    let day = days.find((d) => d.date === r.date);
    if (!day) days.push((day = { date: r.date, total: 0, funny: 0, items: [] }));
    day.items.push({
      itemIdx: r.item_idx,
      text: itemTextFor(r.date, me, r.item_idx, poolFor(r.date)),
      url: `/uploads/${r.filename}`,
      score: r.score,
      funny: r.funny,
      voters: r.voters,
    });
    day.total += r.score;
    day.funny += r.funny;
  }

  res.json({ days });
});

// Слова для персонального задания: переписывать можно, пока день не подтверждён.
router.post('/words', (req, res) => {
  if (!enabled(res)) return;
  const date = gameDate();
  const me = req.user.id;
  if (isConfirmed(date, me))
    return res.status(409).json({ error: 'День уже подтверждён — слова не переписать' });

  const adjective = cleanWord(req.body?.adjective);
  const noun = cleanWord(req.body?.noun);
  if (!adjective || !noun)
    return res.status(400).json({ error: 'Нужны оба слова: прилагательное и существительное' });

  db.prepare(`
    INSERT INTO hunt_words (date, user_id, adjective, noun) VALUES (?, ?, ?, ?)
    ON CONFLICT (date, user_id) DO UPDATE SET adjective = excluded.adjective, noun = excluded.noun
  `).run(date, me, adjective, noun);

  res.json({ ok: true, ...huntState(date, me) });
});

// Снимок можно менять сколько угодно, пока день не подтверждён: старый файл
// удаляется, чтобы uploads не рос черновиками.
router.post('/', upload.single('photo'), async (req, res) => {
  if (!enabled(res)) return;
  if (!req.file) return res.status(400).json({ error: 'Прикрепи фото (поле photo)' });

  const date = gameDate();
  const me = req.user.id;
  if (!isStarted(date, me))
    return res.status(409).json({ error: 'Сначала получи задания на сегодня' });
  if (isConfirmed(date, me))
    return res.status(409).json({ error: 'День подтверждён — снимки уже ушли на голосование' });

  const pool = poolItemsOf(ensureDay(date));
  const idx = Number(req.body?.item);
  if (!Number.isInteger(idx) || idx < 0 || idx > PERSONAL_ITEM_IDX)
    return res.status(400).json({ error: `item должен быть от 0 до ${PERSONAL_ITEM_IDX}` });
  if (itemTextFor(date, me, idx, pool) === null)
    return res.status(409).json({ error: 'Это задание ещё не выдано — сдай слова и дождись чужих' });

  const filename = `hunt-${date}-i${idx}-u${me}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  try {
    await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(path.join(UPLOADS_DIR, filename));
  } catch {
    return res.status(400).json({ error: 'Это не похоже на фото' });
  }

  const previous = db.prepare('SELECT filename FROM hunt_photos WHERE date = ? AND user_id = ? AND item_idx = ?')
    .get(date, me, idx);
  db.prepare(`
    INSERT INTO hunt_photos (date, user_id, item_idx, filename) VALUES (?, ?, ?, ?)
    ON CONFLICT (date, user_id, item_idx) DO UPDATE SET filename = excluded.filename
  `).run(date, me, idx, filename);
  if (previous) fs.promises.unlink(path.join(UPLOADS_DIR, previous.filename)).catch(() => {});

  res.json({ ok: true, ...huntState(date, me) });
});

// Подтверждение дня: снимки замораживаются и становятся видны для голосования.
router.post('/confirm', (req, res) => {
  if (!enabled(res)) return;
  const date = gameDate();
  const me = req.user.id;
  if (isConfirmed(date, me)) return res.status(409).json({ error: 'День уже подтверждён' });
  const shots = db.prepare('SELECT COUNT(*) AS c FROM hunt_photos WHERE date = ? AND user_id = ?')
    .get(date, me).c;
  if (shots === 0) return res.status(409).json({ error: 'Нечего подтверждать — сначала сдай хотя бы один снимок' });

  db.prepare('INSERT OR IGNORE INTO hunt_submissions (date, user_id) VALUES (?, ?)').run(date, me);
  res.json({ ok: true, ...huntState(date, me) });
});

// Следующий снимок на оценку. Оценивать можно, не сдав своё: подтверждение
// автора сразу выкладывает его снимки всем остальным.
router.get('/vote', (req, res) => {
  if (!getConfig().hunt.enabled) return res.json({ enabled: false, photo: null, remaining: 0 });
  const date = gameDate();
  const me = req.user.id;

  const pool = poolItemsOf(ensureDay(date));
  const queue = voteQueue(date, me);
  const next = queue[0] ?? null;
  res.json({
    enabled: true,
    available: true,
    remaining: queue.length,
    photo: next
      ? {
        itemIdx: next.item_idx,
        itemText: itemTextFor(date, next.user_id, next.item_idx, pool),
        photoUserId: next.user_id,
        url: `/uploads/${next.filename}`,
      }
      : null,
  });
});

router.post('/vote', (req, res) => {
  if (!enabled(res)) return;
  const date = gameDate();
  const me = req.user.id;

  const itemIdx = Number(req.body?.itemIdx);
  const photoUserId = Number(req.body?.photoUserId);
  const score = Number(req.body?.score);
  const funny = Boolean(req.body?.funny);
  if (!Number.isInteger(itemIdx) || itemIdx < 0 || itemIdx > PERSONAL_ITEM_IDX)
    return res.status(400).json({ error: 'Кривой itemIdx' });
  if (!Number.isInteger(photoUserId) || photoUserId === me)
    return res.status(400).json({ error: 'За себя голосовать нельзя' });
  if (!Number.isInteger(score) || score < 0 || score > 3)
    return res.status(400).json({ error: 'Оценка — целое от 0 до 3' });

  const target = db.prepare(`
    SELECT 1 FROM hunt_photos p
    JOIN hunt_submissions s ON s.date = p.date AND s.user_id = p.user_id
    WHERE p.date = ? AND p.user_id = ? AND p.item_idx = ?
  `).get(date, photoUserId, itemIdx);
  if (!target) return res.status(404).json({ error: 'Такого снимка нет или он ещё не подтверждён' });

  try {
    db.prepare(`
      INSERT INTO hunt_votes (date, item_idx, voter_id, photo_user_id, score, funny)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(date, itemIdx, me, photoUserId, score, funny ? 1 : 0);
  } catch {
    return res.status(409).json({ error: 'Ты уже оценил этот снимок' });
  }

  res.json({ ok: true });
});

export default router;
