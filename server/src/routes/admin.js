import { Router } from 'express';
import { getConfig, saveConfig, DEFAULT_CONFIG } from '../config.js';

const router = Router();

// Текущий конфиг + дефолты (для кнопки «вернуть стандартные»).
router.get('/config', (req, res) => {
  res.json({ config: getConfig(), defaults: DEFAULT_CONFIG });
});

// Полное обновление конфига; вход нормализуется, мусор заменяется дефолтами.
router.put('/config', (req, res) => {
  if (!req.body?.config || typeof req.body.config !== 'object')
    return res.status(400).json({ error: 'Нужен объект config' });
  res.json({ ok: true, config: saveConfig(req.body.config) });
});

export default router;
