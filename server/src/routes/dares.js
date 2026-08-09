import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOADS_DIR } from '../db.js';
import { getConfig } from '../config.js';
import { fnv1a } from '../content.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

export const TIERS = [
  { key: 'food', label: 'Еда', points: 'foodPoints', hint: 'Съел — сфоткал тарелку и себя. Обещать не считается.' },
  { key: 'courage', label: 'Кураж', points: 'couragePoints', hint: 'Тут нужен характер, а не желудок.' },
  { key: 'extreme', label: 'Экстрим', points: 'extremePoints', hint: 'Дорого, страшно и незабываемо.' },
];

// id завязан на текст задания: правки пула в админке не переносят выполненное
// на соседние строки, а тир читается из префикса — по нему же считаются очки.
export const dareId = (tier, text) => `${tier}:${fnv1a(text).toString(16)}`;

function daresState(meId) {
  const cfg = getConfig().dares;
  const mine = new Map(
    db.prepare('SELECT dare_id, filename FROM dare_photos WHERE user_id = ?').all(meId)
      .map((r) => [r.dare_id, r.filename]),
  );
  const taken = new Map(
    db.prepare('SELECT dare_id, COUNT(*) AS c FROM dare_photos GROUP BY dare_id').all()
      .map((r) => [r.dare_id, r.c]),
  );

  const tiers = TIERS.map((t) => ({
    tier: t.key,
    label: t.label,
    hint: t.hint,
    points: cfg[t.points],
    items: cfg[t.key].map((text) => {
      const id = dareId(t.key, text);
      return {
        id,
        text,
        myUrl: mine.has(id) ? `/uploads/${mine.get(id)}` : null,
        doneBy: taken.get(id) ?? 0,
      };
    }),
  }));

  return {
    enabled: cfg.enabled,
    tiers,
    myDone: mine.size,
    myPoints: tiers.reduce(
      (sum, t) => sum + t.items.filter((i) => i.myUrl).length * t.points,
      0,
    ),
  };
}

// Разрешённые id собираются из текущего конфига — прислать произвольный нельзя.
function findDare(id) {
  const cfg = getConfig().dares;
  for (const t of TIERS) {
    const text = cfg[t.key].find((x) => dareId(t.key, x) === id);
    if (text) return { tier: t.key, text };
  }
  return null;
}

router.get('/', (req, res) => {
  if (!getConfig().dares.enabled) return res.json({ enabled: false, tiers: [] });
  res.json(daresState(req.user.id));
});

// Фото-доказательство. Пересдать можно: очки от этого не меняются, а кадр
// бывает смазанным — незачем запирать игрока с браком.
router.post('/', upload.single('photo'), async (req, res) => {
  if (!getConfig().dares.enabled)
    return res.status(403).json({ error: 'Игра «Слабо» выключена админом' });
  if (!req.file) return res.status(400).json({ error: 'Прикрепи фото-доказательство (поле photo)' });

  const id = String(req.body?.dareId ?? '');
  if (!findDare(id)) return res.status(404).json({ error: 'Такого челленджа нет в списке' });

  const me = req.user.id;
  const filename = `dare-u${me}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  try {
    await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(path.join(UPLOADS_DIR, filename));
  } catch {
    return res.status(400).json({ error: 'Это не похоже на фото' });
  }

  const previous = db.prepare('SELECT filename FROM dare_photos WHERE user_id = ? AND dare_id = ?')
    .get(me, id);
  db.prepare(`
    INSERT INTO dare_photos (user_id, dare_id, filename) VALUES (?, ?, ?)
    ON CONFLICT (user_id, dare_id) DO UPDATE SET filename = excluded.filename
  `).run(me, id, filename);
  if (previous) fs.promises.unlink(path.join(UPLOADS_DIR, previous.filename)).catch(() => {});

  res.json({ ok: true, ...daresState(me) });
});

export default router;
