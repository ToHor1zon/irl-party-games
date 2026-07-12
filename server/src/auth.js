import jwt from 'jsonwebtoken';
import { db } from './db.js';

const isProd = process.env.NODE_ENV === 'production';
export const JWT_SECRET = process.env.JWT_SECRET || (() => {
  if (isProd) {
    console.error('FATAL: переменная окружения JWT_SECRET обязательна в продакшене');
    process.exit(1);
  }
  console.warn('⚠ JWT_SECRET не задан — используется dev-секрет. Не для продакшена!');
  return 'china-quest-dev-secret';
})();

export function signToken(user) {
  return jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '90d' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нужна авторизация' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Токен протух, зайди заново' });
  }
}

// Права смотрим в БД, а не в токене: назначение админа действует без перевыпуска JWT.
export function requireAdmin(req, res, next) {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!row?.is_admin) return res.status(403).json({ error: 'Только для админа' });
  next();
}
