import { Router } from 'express';
import { db } from '../db.js';
import { leaderboard } from '../scoring.js';

const router = Router();

router.get('/leaderboard', (req, res) => {
  res.json({ leaderboard: leaderboard() });
});

router.get('/players', (req, res) => {
  res.json({
    players: db.prepare('SELECT id, name FROM users ORDER BY name COLLATE NOCASE').all(),
  });
});

router.get('/me', (req, res) => {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: { id: req.user.id, name: req.user.name, isAdmin: Boolean(row?.is_admin) } });
});

export default router;
