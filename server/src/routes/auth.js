import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { signToken } from '../auth.js';

const router = Router();

// Первый зарегистрированный игрок — админ; дополнительно можно назначить
// админов по именам через env ADMIN_NAMES="Имя1,Имя2".
const ADMIN_NAMES = (process.env.ADMIN_NAMES || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Служебный PIN: кто заходит с ним — админ, независимо от имени и очереди
// регистрации. Удобно раздавать права в поездке, но админом станет любой, кто
// его знает, — если игра выйдет за пределы своих, переопредели через ADMIN_PIN.
const ADMIN_PIN = process.env.ADMIN_PIN || '0001';

// Единая точка входа: новое имя — регистрация, существующее — логин по PIN.
router.post('/join', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const pin = String(req.body?.pin ?? '').trim();

  if (name.length < 2 || name.length > 20)
    return res.status(400).json({ error: 'Имя — от 2 до 20 символов' });
  if (!/^\d{4,8}$/.test(pin))
    return res.status(400).json({ error: 'PIN — от 4 до 8 цифр' });

  // COLLATE NOCASE в SQLite не покрывает кириллицу — сравниваем в JS.
  const existing = db.prepare('SELECT * FROM users').all()
    .find((u) => u.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    if (!bcrypt.compareSync(pin, existing.pin_hash))
      return res.status(401).json({ error: 'Имя занято, а PIN не подходит. Ты точно это ты?' });
    let isAdmin = Boolean(existing.is_admin);
    if (!isAdmin && (pin === ADMIN_PIN || ADMIN_NAMES.includes(existing.name.toLowerCase()))) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing.id);
      isAdmin = true;
    }
    return res.json({
      token: signToken(existing),
      user: { id: existing.id, name: existing.name, isAdmin },
      isNew: false,
    });
  }

  const isFirst = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
  const isAdmin = isFirst || pin === ADMIN_PIN || ADMIN_NAMES.includes(name.toLowerCase());
  const info = db.prepare('INSERT INTO users (name, pin_hash, is_admin) VALUES (?, ?, ?)')
    .run(name, bcrypt.hashSync(pin, 10), isAdmin ? 1 : 0);
  const user = { id: info.lastInsertRowid, name, isAdmin };
  return res.json({ token: signToken(user), user, isNew: true });
});

export default router;
