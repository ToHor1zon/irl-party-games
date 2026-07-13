import { Router } from 'express';
import { db } from '../db.js';
import { gameDate, ensureDay } from '../daily.js';
import { getConfig } from '../config.js';

const router = Router();

// Сводка дня: миссия и мои статусы по фото.
// Настройки и стоимость действий отдаются клиенту — интерфейс подстраивается под конфиг.
router.get('/today', (req, res) => {
  const cfg = getConfig();
  const date = gameDate();
  const day = ensureDay(date);
  const me = req.user.id;

  const playersCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const myPhoto = db.prepare('SELECT filename FROM photos WHERE date = ? AND user_id = ?').get(date, me);
  const photosCount = db.prepare('SELECT COUNT(*) AS c FROM photos WHERE date = ?').get(date).c;
  const myPhotoVote = db.prepare('SELECT photo_user_id FROM photo_votes WHERE date = ? AND voter_id = ?').get(date, me);

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
  });
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

export default router;
