# english-bot

Telegram-бот для изучения английских слов по интервальному повторению (SRS).
Полное описание логики — в [design-doc.md](design-doc.md), отложенные решения —
в [known_issues.md](known_issues.md).

> **Статус: скелет.** Структура, схема БД, конфиг и интерфейсы готовы; флоу
> (добавление / повторение / тест / настройки) — заглушки с TODO.

## Стек

- **TypeScript** (ESM), запуск через **tsx**
- **grammY** — Telegram Bot API (+ conversations, sessions)
- **Drizzle ORM** + **PostgreSQL** (`pg`)
- **node-cron** — планировщик ежедневного повторения
- Перевод — **Yandex Dictionary**; пример/фоллбэк — **LLM (Gemini)** (за интерфейсами)

## Требования

- Node.js 20+ (разрабатывалось на 23)
- PostgreSQL 14+

## Запуск

```bash
cp .env.example .env   # заполнить токены и DATABASE_URL
npm install
npm run db:generate    # сгенерировать SQL-миграцию из схемы
npm run db:migrate     # применить к БД
npm run dev            # запуск с авто-перезагрузкой
```

## Скрипты

- `npm run dev` — запуск (tsx watch)
- `npm start` — запуск
- `npm run typecheck` — проверка типов (`tsc --noEmit`)
- `npm run lint` / `npm run format` — eslint / prettier
- `npm run db:generate` / `db:migrate` / `db:push` — drizzle-kit

## Структура

```
src/
  index.ts            точка входа (бот + планировщик)
  bot.ts              сборка бота, whitelist, session, команды меню
  config.ts           загрузка и валидация env
  context.ts          типы контекста и сессии (FSM: idle/review/test)
  db/
    schema.ts         таблицы users / settings / words (мультитенантно)
    index.ts          клиент Drizzle
  services/
    index.ts          фабрика провайдеров (DI-шов)
    dictionary/       интерфейс + Yandex (перевод) — STUB
    llm/              интерфейс + Gemini (пример/фоллбэк) — STUB
    scheduler.ts      ежедневное повторение — STUB
  features/           add / review / test / settings — STUB-хендлеры
  lib/
    lang.ts           определение языка по алфавиту
    grading.ts        нормализация и сверка ответа
    srs.ts            лестница интервалов
```

## Что дальше

Реализовать флоу по одному (см. design-doc.md §4–§9), начиная с добавления слова.
Провайдеры подключаются через `createServices()` в `src/services/index.ts`.
