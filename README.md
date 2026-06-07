# english-bot

Telegram-бот для изучения английских слов по интервальному повторению (SRS).
Полное описание логики — в [design-doc.md](design-doc.md), отложенные решения —
в [known_issues.md](known_issues.md), дорожная карта — в [to-do.md](to-do.md).

> **Статус:** добавление слова (§4) и провайдеры (Yandex-словарь + LLM через
> Vercel AI SDK/Groq) реализованы и проверены вживую. Повторение / тест /
> настройки / планировщик — пока заглушки.

## Стек

- **TypeScript** (ESM), запуск через **tsx**
- **grammY** — Telegram Bot API (+ conversations, sessions)
- **Drizzle ORM** + **PostgreSQL** (`pg`)
- **node-cron** — планировщик ежедневного повторения
- Перевод — **Yandex Dictionary**; пример/фоллбэк — **LLM через Vercel AI SDK**
  (`ai` + `@ai-sdk/groq`, провайдер переключается через `LLM_PROVIDER`). Всё — за интерфейсами.

## Требования

- Node.js 22+ (разрабатывалось на 23)
- PostgreSQL 14+

## Запуск

```bash
cp .env.example .env   # заполнить токены, LLM_PROVIDER/GROQ_API_KEY, DATABASE_URL
npm install
npm run db:generate    # сгенерировать SQL-миграцию из схемы (если меняли схему)
npm run db:migrate     # применить к БД
npm run dev            # запуск с авто-перезагрузкой
```

## Скрипты

- `npm run dev` — запуск (tsx watch)
- `npm start` — запуск
- `npm run typecheck` — проверка типов (`tsc --noEmit`)
- `npm run lint` / `npm run format` — eslint / prettier
- `npm test` — юнит-тесты (node:test)
- `npm run db:generate` / `db:migrate` / `db:push` — drizzle-kit

## Структура

```
src/
  index.ts            точка входа (бот + планировщик)
  bot.ts              сборка бота, whitelist, session, conversations, команды меню
  config.ts           загрузка и валидация env (вкл. выбор LLM-провайдера)
  context.ts          типы контекста и сессии (FSM: idle/review/test)
  domain.ts           кросс-доменные типы (Lang, Direction)
  db/
    schema.ts         таблицы users / settings / words (мультитенантно)
    index.ts          клиент Drizzle
    users.ts          провижининг пользователя
    words.ts          вставка / поиск слов
  services/
    index.ts          фабрика провайдеров (DI-шов)
    dictionary/       интерфейс + Yandex (перевод)
    llm/              интерфейс + AI SDK (aisdk.ts) + выбор модели/провайдера (model.ts)
    scheduler.ts      ежедневное повторение — STUB
  features/
    add.ts            добавление слова (§4) — реализовано
    review.ts / test.ts / settings.ts — STUB-хендлеры
  lib/
    lang.ts           определение языка по алфавиту
    card.ts           сборка карточки слова
    html.ts           экранирование для Telegram HTML
    grading.ts        нормализация и сверка ответа
    srs.ts            лестница интервалов
    dates.ts          даты SRS в таймзоне пользователя
```

## Что дальше

Следующий шаг — флоу повторения (см. [to-do.md](to-do.md), Фаза 3). Провайдеры
подключаются через `createServices()` в `src/services/index.ts`.
