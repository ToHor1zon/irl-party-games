import { Router } from 'express';
import { db } from '../db.js';
import { gameDate, ensureDay, closePastDays, secretWordFor } from '../daily.js';
import { getConfig } from '../config.js';

const router = Router();

// Сводка дня: миссия, моё слово, роль импостера, статусы, драма вчерашнего раунда.
// Настройки и стоимость действий отдаются клиенту — интерфейс подстраивается под конфиг.
router.get('/today', (req, res) => {
  closePastDays();
  const cfg = getConfig();
  const date = gameDate();
  const day = ensureDay(date);
  const me = req.user.id;

  const playersCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const myPhoto = db.prepare('SELECT filename FROM photos WHERE date = ? AND user_id = ?').get(date, me);
  const photosCount = db.prepare('SELECT COUNT(*) AS c FROM photos WHERE date = ?').get(date).c;
  const myPhotoVote = db.prepare('SELECT photo_user_id FROM photo_votes WHERE date = ? AND voter_id = ?').get(date, me);
  const myWordStatus = db.prepare('SELECT status FROM word_statuses WHERE date = ? AND user_id = ?').get(date, me);
  const myImposterVote = db.prepare('SELECT target_user_id FROM imposter_votes WHERE date = ? AND voter_id = ?').get(date, me);
  const imposterVotesTotal = db.prepare('SELECT COUNT(*) AS c FROM imposter_votes WHERE date = ?').get(date).c;

  const imposterActive = cfg.imposter.enabled && day.imposter_user_id != null;
  const isImposter = imposterActive && day.imposter_user_id === me;

  // Итог последнего закрытого дня с импостером — «драма» на утро.
  const prev = db.prepare(`
    SELECT d.*, u.name AS imposter_name FROM days d
    LEFT JOIN users u ON u.id = d.imposter_user_id
    WHERE d.closed = 1 AND d.date < ? ORDER BY d.date DESC LIMIT 1
  `).get(date);

  res.json({
    date,
    mission: cfg.photo.missions[day.mission_idx % cfg.photo.missions.length],
    playersCount,
    photo: {
      enabled: cfg.photo.enabled,
      submitPoints: cfg.photo.submitPoints,
      votePoints: cfg.photo.votePoints,
      submitted: Boolean(myPhoto),
      url: myPhoto ? `/uploads/${myPhoto.filename}` : null,
      count: photosCount,
      myVoteUserId: myPhotoVote?.photo_user_id ?? null,
    },
    word: {
      enabled: cfg.word.enabled,
      timesToSay: cfg.word.timesToSay,
      points: cfg.word.points,
      word: secretWordFor(date, me),
      status: myWordStatus?.status ?? null,
    },
    imposter: {
      enabled: cfg.imposter.enabled,
      active: imposterActive,
      isImposter,
      word: imposterActive && !isImposter
        ? cfg.imposter.words[day.imposter_word_idx % cfg.imposter.words.length]
        : null,
      myVoteUserId: myImposterVote?.target_user_id ?? null,
      votesTotal: imposterVotesTotal,
      minPlayers: cfg.imposter.minPlayers,
      survivePoints: cfg.imposter.survivePoints,
      guessPoints: cfg.imposter.guessPoints,
    },
    yesterday: prev && prev.imposter_user_id != null ? {
      date: prev.date,
      imposterName: prev.imposter_name,
      caught: Boolean(prev.imposter_caught),
      word: cfg.imposter.words[prev.imposter_word_idx % cfg.imposter.words.length],
    } : null,
  });
});

// Скрытая карточка: моё тайное слово.
router.get('/word', (req, res) => {
  const date = gameDate();
  const status = db.prepare('SELECT status FROM word_statuses WHERE date = ? AND user_id = ?')
    .get(date, req.user.id);
  res.json({ word: secretWordFor(date, req.user.id), status: status?.status ?? null });
});

// Самоотчёт на честности: «Сказал N раз» / «Меня спалили». Один раз за день.
router.post('/word', (req, res) => {
  if (!getConfig().word.enabled)
    return res.status(403).json({ error: 'Тайное слово выключено админом' });
  const status = req.body?.status;
  if (status !== 'done' && status !== 'busted')
    return res.status(400).json({ error: 'status должен быть done или busted' });
  const date = gameDate();
  try {
    db.prepare('INSERT INTO word_statuses (date, user_id, status) VALUES (?, ?, ?)')
      .run(date, req.user.id, status);
  } catch {
    return res.status(409).json({ error: 'Уже отмечено — слово назад не забрать' });
  }
  res.json({ ok: true, status });
});

// Голос за лучшее фото: за себя нельзя, один голос, можно менять.
router.post('/vote-photo', (req, res) => {
  if (!getConfig().photo.enabled)
    return res.status(403).json({ error: 'Фото-миссия выключена админом' });
  const target = Number(req.body?.targetUserId);
  const date = gameDate();
  const me = req.user.id;
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Нужен targetUserId' });
  if (target === me) return res.status(400).json({ error: 'За себя нельзя, хитрец' });
  const photo = db.prepare('SELECT 1 FROM photos WHERE date = ? AND user_id = ?').get(date, target);
  if (!photo) return res.status(404).json({ error: 'У этого игрока сегодня нет фото' });
  db.prepare('INSERT OR REPLACE INTO photo_votes (date, voter_id, photo_user_id) VALUES (?, ?, ?)')
    .run(date, me, target);
  res.json({ ok: true });
});

// Голос «кто импостер»: весь день, можно менять, за себя нельзя.
router.post('/vote-imposter', (req, res) => {
  if (!getConfig().imposter.enabled)
    return res.status(403).json({ error: 'Imposter Who? выключен админом' });
  const target = Number(req.body?.targetUserId);
  const date = gameDate();
  const me = req.user.id;
  const day = ensureDay(date);
  if (day.imposter_user_id == null)
    return res.status(400).json({ error: `Импостера сегодня нет — нужно минимум ${getConfig().imposter.minPlayers} игрока` });
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Нужен targetUserId' });
  if (target === me) return res.status(400).json({ error: 'На себя показывать нельзя' });
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(target);
  if (!exists) return res.status(404).json({ error: 'Такого игрока нет' });
  db.prepare('INSERT OR REPLACE INTO imposter_votes (date, voter_id, target_user_id) VALUES (?, ?, ?)')
    .run(date, me, target);
  res.json({ ok: true });
});

export default router;
