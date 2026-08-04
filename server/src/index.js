import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UPLOADS_DIR } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';
import authRouter from './routes/auth.js';
import dayRouter from './routes/day.js';
import photosRouter from './routes/photos.js';
import chainRouter from './routes/chain.js';
import bingoRouter from './routes/bingo.js';
import huntRouter from './routes/hunt.js';
import phraseRouter from './routes/phrase.js';
import metaRouter from './routes/meta.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/api/auth', authRouter);

// Всё остальное API — только с Bearer JWT.
app.use('/api', requireAuth);
app.use('/api/admin', requireAdmin, adminRouter);
app.use('/api/day', dayRouter);
app.use('/api/photos', photosRouter);
app.use('/api/chain', chainRouter);
app.use('/api/bingo', bingoRouter);
app.use('/api/hunt', huntRouter);
app.use('/api/phrase', phraseRouter);
app.use('/api', metaRouter);

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d', immutable: true }));

// Продакшен: Express сам раздаёт собранный клиент (public/ или ../client/dist).
const clientDist = [path.join(__dirname, '../public'), path.join(__dirname, '../../client/dist')]
  .find((p) => fs.existsSync(path.join(p, 'index.html')));
if (clientDist) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Что-то пошло не так на сервере' });
});

app.listen(PORT, () => {
  console.log(`🏮 Китай-Квест запущен: http://localhost:${PORT}${clientDist ? '' : ' (клиент не собран — только API)'}`);
});
