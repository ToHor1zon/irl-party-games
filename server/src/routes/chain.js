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

function chainState(meId) {
  const cfg = getConfig();
  const last = db.prepare(`
    SELECT c.n, c.user_id, u.name FROM chain_entries c
    JOIN users u ON u.id = c.user_id ORDER BY c.n DESC LIMIT 1
  `).get();
  const next = (last?.n ?? 0) + 1;
  return {
    enabled: cfg.chain.enabled,
    maxPoints: cfg.chain.maxPoints,
    next,
    points: Math.min(next, cfg.chain.maxPoints),
    lastFinder: last ? { userId: last.user_id, name: last.name } : null,
    mustSkip: last ? last.user_id === meId : false, // нашедший прошлое число пропускает ход
  };
}

router.get('/', (req, res) => {
  const state = chainState(req.user.id);
  const entries = db.prepare(`
    SELECT c.n, c.user_id, u.name, c.filename, c.date FROM chain_entries c
    JOIN users u ON u.id = c.user_id ORDER BY c.n DESC LIMIT 30
  `).all();
  res.json({
    ...state,
    entries: entries.map((e) => ({
      n: e.n,
      userId: e.user_id,
      name: e.name,
      url: `/uploads/${e.filename}`,
      date: e.date,
      points: Math.min(e.n, state.maxPoints),
    })),
  });
});

router.post('/', upload.single('photo'), async (req, res) => {
  if (!getConfig().chain.enabled)
    return res.status(403).json({ error: 'Цепочка чисел выключена админом' });
  if (!req.file) return res.status(400).json({ error: 'Прикрепи фото числа (поле photo)' });
  const me = req.user.id;
  const state = chainState(me);
  if (state.mustSkip)
    return res.status(403).json({ error: 'Ты нашёл прошлое число — пропускаешь ход. Дай другим шанс!' });

  const filename = `chain-${state.next}-u${me}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  try {
    await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 700, height: 700, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(path.join(UPLOADS_DIR, filename));
  } catch {
    return res.status(400).json({ error: 'Это не похоже на фото' });
  }

  // Гонку «кто первый» решает PRIMARY KEY(n): проигравший получает 409.
  try {
    db.prepare('INSERT INTO chain_entries (n, user_id, date, filename) VALUES (?, ?, ?, ?)')
      .run(state.next, me, gameDate(), filename);
  } catch {
    return res.status(409).json({ error: `Опоздал! Число ${state.next} уже забрали` });
  }
  res.json({ ok: true, n: state.next, points: state.points });
});

export default router;
