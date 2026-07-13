import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOADS_DIR } from '../db.js';
import { gameDate, ensureDay } from '../daily.js';
import { getConfig } from '../config.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function huntState(date, meId) {
  const cfg = getConfig().hunt;
  const day = ensureDay(date);
  const items = JSON.parse(day.hunt_items ?? '[]');
  const finds = db.prepare(`
    SELECT h.item_idx, h.user_id, u.name, h.filename FROM hunt_photos h
    JOIN users u ON u.id = h.user_id
    WHERE h.date = ? ORDER BY h.created_at ASC
  `).all(date);
  return {
    enabled: cfg.enabled,
    itemPoints: cfg.itemPoints,
    date,
    items: items.map((text, idx) => {
      const itemFinds = finds.filter((f) => f.item_idx === idx);
      const mine = itemFinds.find((f) => f.user_id === meId);
      return {
        idx,
        text,
        myUrl: mine ? `/uploads/${mine.filename}` : null,
        finds: itemFinds.map((f) => ({ userId: f.user_id, name: f.name, url: `/uploads/${f.filename}` })),
      };
    }),
  };
}

router.get('/', (req, res) => {
  if (!getConfig().hunt.enabled) return res.json({ enabled: false, items: [] });
  res.json(huntState(gameDate(), req.user.id));
});

// Фото-доказательство: это поиск, а не конкурс — одна находка на цель с игрока.
router.post('/', upload.single('photo'), async (req, res) => {
  if (!getConfig().hunt.enabled)
    return res.status(403).json({ error: 'Фотоохота выключена админом' });
  if (!req.file) return res.status(400).json({ error: 'Прикрепи фото-доказательство (поле photo)' });

  const date = gameDate();
  const me = req.user.id;
  const day = ensureDay(date);
  const items = JSON.parse(day.hunt_items ?? '[]');
  const idx = Number(req.body?.item);
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length)
    return res.status(400).json({ error: `item должен быть от 0 до ${items.length - 1}` });
  if (db.prepare('SELECT 1 FROM hunt_photos WHERE date = ? AND user_id = ? AND item_idx = ?').get(date, me, idx))
    return res.status(409).json({ error: 'Эту цель ты уже добыл!' });

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

  try {
    db.prepare('INSERT INTO hunt_photos (date, user_id, item_idx, filename) VALUES (?, ?, ?, ?)')
      .run(date, me, idx, filename);
  } catch {
    return res.status(409).json({ error: 'Эту цель ты уже добыл!' });
  }
  res.json({ ok: true, ...huntState(date, me) });
});

export default router;
