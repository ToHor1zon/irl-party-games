# 🏮 Китай-Квест

Веб-приложение для совместной поездки в Китай: ежедневные задания, очки и общий лидерборд. Заходишь с телефона, вводишь имя и PIN — и ты в игре.

## Игры

1. **Фото-миссия дня** — одно общее задание на всех, одна попытка загрузки, вечером голосование за лучшее фото (за себя нельзя, голос можно менять). Сдал фото: **+5**, каждый голос за твоё фото: **+7**.
2. **Тайное слово** — каждому своё нелепое слово на скрытой flip-карте. Скажи его 5 раз за день и не спались. Самоотчёт на честности: **+15**.
3. **Imposter Who?** — раз в день один игрок — импостер (нужно ≥3 игроков). Остальные видят «слово дня», импостер — только «ТЫ ИМПОСТЕР». Голосование весь день, итоги с «драмой» на следующее утро. Импостер выжил: **+30**, угадал импостера: **+10**. Импостер пойман при единоличном большинстве голосов.
4. **Цепочка чисел** — общий счётчик с 1: ищи число вокруг, фоткай первым. Число N: **+N** (максимум +30). Нашедший прошлое число пропускает ход.

Контент дня (миссия, слова, импостер) выбирается детерминированно из FNV-1a-хеша даты. Игровой день — по времени Китая (`TZ_OFFSET_HOURS=8`). Очки считаются на лету из исходных таблиц.

## Локальный запуск

```bash
# бэкенд (порт 3000)
cd server && npm install && npm run dev

# фронтенд (порт 5173, прокси /api и /uploads на :3000)
cd client && npm install && npm run dev
```

Продакшен-сборка без Docker:

```bash
cd client && npm install && npm run build
cd ../server && npm install && JWT_SECRET=секрет NODE_ENV=production npm start
# Express сам раздаёт client/dist на :3000
```

## Docker

```bash
cp .env.example .env        # и впиши настоящий JWT_SECRET
docker compose up -d --build
```

БД и фото живут в volume `quest-data` (`/app/data`).

## Деплой

### Railway

```bash
npm i -g @railway/cli
railway login
railway init                # создать проект
railway volume add --mount-path /app/data
railway variables --set "JWT_SECRET=$(openssl rand -hex 32)"
railway up                  # соберёт Dockerfile и задеплоит
railway domain              # выдать публичный URL
```

### Fly.io

```bash
brew install flyctl
fly auth login
fly launch --no-deploy      # определит Dockerfile; internal_port = 3000
fly volumes create quest_data --size 1
# в fly.toml добавь:
#   [mounts]
#     source = "quest_data"
#     destination = "/app/data"
fly secrets set JWT_SECRET=$(openssl rand -hex 32)
fly deploy
```

Важно: приложение хранит состояние в SQLite — запускать строго в **один инстанс** (Fly: `fly scale count 1`).

## API

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/auth/join` | `{name, pin}` — регистрация или вход |
| GET | `/api/day/today` | сводка дня (миссия, слово, роль, статусы, вчерашняя драма) |
| GET/POST | `/api/day/word` | тайное слово / самоотчёт `{status: done\|busted}` |
| POST | `/api/day/vote-photo` | голос за фото `{targetUserId}` |
| POST | `/api/day/vote-imposter` | голос за импостера `{targetUserId}` |
| POST | `/api/photos` | загрузка фото дня (multipart, поле `photo`) |
| GET | `/api/photos/today` | галерея дня с голосами |
| GET/POST | `/api/chain` | состояние цепочки / загрузка фото числа |
| GET | `/api/leaderboard` | лидерборд |
| GET | `/api/players` | список игроков |
| GET | `/api/me` | кто я |
| GET | `/api/health` | без авторизации |

Всё, кроме `join` и `health`, — под Bearer JWT.

## Переменные окружения

| Переменная | Обязательна | По умолчанию | Что делает |
|---|---|---|---|
| `JWT_SECRET` | да (в проде) | — | подпись токенов |
| `TZ_OFFSET_HOURS` | нет | `8` | смещение игрового дня |
| `PORT` | нет | `3000` | порт сервера |
| `DATA_DIR` | нет | `./data` | путь к БД и фото |

## Бэклог

Асинхронный коднеймс, бинго путешественника 3×3, «тайное поручение», цитата дня, «угадай цену», шпион-фотограф, аукцион шагов; WebSocket вместо поллинга, Web Push «тебя подозревают», админка для своих пулов заданий.
