import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOADS_DIR } from '../db.js';
import { gameDate } from '../daily.js';
import { getConfig } from '../config.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Одно фото за день: UNIQUE(user_id, date) в базе — вторая попытка не пройдёт.
router.post('/', upload.single('photo'), async (req, res) => {
  if (!getConfig().photo.enabled)
    return res.status(403).json({ error: 'Фото-миссия выключена админом' });
  if (!req.file) return res.status(400).json({ error: 'Прикрепи фото (поле photo)' });
  const date = gameDate();
  const me = req.user.id;

  if (db.prepare('SELECT 1 FROM photos WHERE date = ? AND user_id = ?').get(date, me))
    return res.status(409).json({ error: 'Фото уже сдано — одна попытка в день!' });

  const filename = `photo-${date}-u${me}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  try {
    await sharp(req.file.buffer)
      .rotate() // поворот по EXIF
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(path.join(UPLOADS_DIR, filename));
  } catch {
    return res.status(400).json({ error: 'Это не похоже на фото' });
  }

  try {
    db.prepare('INSERT INTO photos (user_id, date, filename) VALUES (?, ?, ?)').run(me, date, filename);
  } catch {
    return res.status(409).json({ error: 'Фото уже сдано — одна попытка в день!' });
  }
  res.json({ ok: true, url: `/uploads/${filename}` });
});

// Галерея дня с голосами.
router.get('/today', (req, res) => {
  const date = gameDate();
  const rows = db.prepare(`
    SELECT p.user_id, u.name, p.filename, p.created_at,
      (SELECT COUNT(*) FROM photo_votes v WHERE v.date = p.date AND v.photo_user_id = p.user_id) AS votes
    FROM photos p JOIN users u ON u.id = p.user_id
    WHERE p.date = ? ORDER BY votes DESC, p.created_at ASC
  `).all(date);
  const myVote = db.prepare('SELECT photo_user_id FROM photo_votes WHERE date = ? AND voter_id = ?')
    .get(date, req.user.id);
  res.json({
    date,
    myVoteUserId: myVote?.photo_user_id ?? null,
    photos: rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      url: `/uploads/${r.filename}`,
      votes: r.votes,
      mine: r.user_id === req.user.id,
    })),
  });
});

export default router;
