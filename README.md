# kotobaza — Bybit Analyzer Dashboard

Крутой dashboard-анализатор для Bybit с безопасным хранением API ключей на сервере.

## Что умеет

- Показ общего equity и wallet balance.
- Отображение открытых позиций и суммарного unrealised PnL.
- Таблица балансов по монетам.
- Быстрый мониторинг тикеров (BTC/ETH/SOL/XRP).
- Ключи **не передаются в браузер**, подпись Bybit генерируется только на backend.

## Быстрый старт

```bash
cp .env.example .env
# вставь свои BYBIT_API_KEY и BYBIT_API_SECRET
npm start
```

Открой: `http://localhost:3000`

## Переменные окружения

- `BYBIT_API_KEY`
- `BYBIT_API_SECRET`
- `BYBIT_BASE_URL` (опционально, по умолчанию `https://api.bybit.com`)
- `BYBIT_RECV_WINDOW` (опционально, по умолчанию `5000`)
- `HOST`, `PORT`

## Проверка

```bash
npm run check
```
