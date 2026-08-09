import { Router } from 'express';
import { db } from '../db.js';
import { poolItemsOf, PERSONAL_ITEM_IDX } from '../daily.js';
import { getConfig } from '../config.js';
import { TIERS, dareId } from './dares.js';

// Лента поездки: снимки группируются по теме, а не по дню. Одна и та же тема
// выпадает в разные дни и разным людям — в альбоме они должны лежать рядом,
// иначе после поездки листать бессмысленно.

const router = Router();

// Тема одна на группу, но источники разные — храним ключом пару, чтобы
// случайное совпадение текстов бинго и охоты не склеило две разные темы.
const keyOf = (source, theme) => `${source} ${theme}`;

function addPhoto(groups, source, theme, photo) {
  const key = keyOf(source, theme);
  let group = groups.get(key);
  if (!group) {
    group = { source, theme, photos: [] };
    groups.set(key, group);
  }
  group.photos.push(photo);
}

// Фотоохота: только подтверждённые снимки. Неподтверждённые — черновики,
// их автор ещё может переснять, и в альбоме им не место.
function collectHunt(groups, names) {
  const pools = new Map(
    db.prepare('SELECT date, hunt_items FROM days').all()
      .map((d) => [d.date, poolItemsOf(d)]),
  );
  const pairs = new Map(
    db.prepare('SELECT date, user_id, adjective, noun FROM hunt_pairs').all()
      .map((p) => [`${p.date}:${p.user_id}`, `${p.adjective} ${p.noun}`]),
  );
  const votes = new Map(
    db.prepare(`
      SELECT date, item_idx, photo_user_id, SUM(score) AS score, SUM(funny) AS funny
      FROM hunt_votes GROUP BY date, item_idx, photo_user_id
    `).all().map((v) => [`${v.date}:${v.item_idx}:${v.photo_user_id}`, v]),
  );

  const rows = db.prepare(`
    SELECT p.date, p.user_id, p.item_idx, p.filename FROM hunt_photos p
    JOIN hunt_submissions s ON s.date = p.date AND s.user_id = p.user_id
    ORDER BY p.date ASC, p.created_at ASC
  `).all();

  for (const r of rows) {
    const theme = r.item_idx === PERSONAL_ITEM_IDX
      ? pairs.get(`${r.date}:${r.user_id}`)
      : (pools.get(r.date) ?? [])[r.item_idx];
    if (!theme) continue; // тему потеряли — в альбом без подписи не кладём

    const v = votes.get(`${r.date}:${r.item_idx}:${r.user_id}`);
    addPhoto(groups, 'hunt', theme, {
      url: `/uploads/${r.filename}`,
      name: names.get(r.user_id) ?? '—',
      date: r.date,
      score: v?.score ?? 0,
      funny: v?.funny ?? 0,
    });
  }
}

// Бинго: тема — слово клетки из карточки того дня, а не из текущего пула,
// иначе правки пула в админке переподпишут старые снимки.
function collectBingo(groups, names) {
  const cards = new Map();
  for (const c of db.prepare('SELECT date, user_id, words FROM bingo_cards').all()) {
    try { cards.set(`${c.date}:${c.user_id}`, JSON.parse(c.words)); } catch { /* битая карточка */ }
  }

  const rows = db.prepare(
    'SELECT date, user_id, cell_idx, filename FROM bingo_photos ORDER BY date ASC, created_at ASC',
  ).all();
  for (const r of rows) {
    const theme = cards.get(`${r.date}:${r.user_id}`)?.[r.cell_idx];
    if (!theme) continue;
    addPhoto(groups, 'bingo', theme, {
      url: `/uploads/${r.filename}`,
      name: names.get(r.user_id) ?? '—',
      date: r.date,
      score: 0,
      funny: 0,
    });
  }
}

// «Слабо»: dare_id завязан на текст, поэтому тема восстанавливается из конфига.
function collectDares(groups, names) {
  const cfg = getConfig().dares;
  const texts = new Map();
  for (const t of TIERS) {
    for (const text of cfg[t.key]) texts.set(dareId(t.key, text), text);
  }

  const rows = db.prepare(
    'SELECT user_id, dare_id, filename, created_at FROM dare_photos ORDER BY created_at ASC',
  ).all();
  for (const r of rows) {
    const theme = texts.get(r.dare_id);
    if (!theme) continue; // челлендж выкинули из пула — тему не восстановить
    addPhoto(groups, 'dares', theme, {
      url: `/uploads/${r.filename}`,
      name: names.get(r.user_id) ?? '—',
      date: r.created_at.slice(0, 10),
      score: 0,
      funny: 0,
    });
  }
}

router.get('/', (req, res) => {
  const names = new Map(db.prepare('SELECT id, name FROM users').all().map((u) => [u.id, u.name]));
  const groups = new Map();

  collectHunt(groups, names);
  collectBingo(groups, names);
  collectDares(groups, names);

  // Сначала самые «населённые» темы: именно там и получается сравнение кадров,
  // ради которого лента и затевалась.
  const list = [...groups.values()]
    .map((g) => ({ ...g, count: g.photos.length }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme, 'ru'));

  res.json({
    groups: list,
    totals: {
      photos: list.reduce((sum, g) => sum + g.count, 0),
      themes: list.length,
      days: new Set(list.flatMap((g) => g.photos.map((p) => p.date))).size,
    },
  });
});

export default router;
