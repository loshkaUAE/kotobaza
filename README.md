# kotobaza — Bybit Analyzer Dashboard (Python)

Крутой dashboard-анализатор для Bybit, полностью на Python (stdlib backend, без Node.js).

## Что умеет

- Показ общего equity и wallet balance.
- Отображение открытых позиций и суммарного unrealised PnL.
- Таблица балансов по монетам.
- Быстрый мониторинг тикеров (BTC/ETH/SOL/XRP).
- Ключи **не передаются в браузер**, подпись Bybit генерируется только на backend.

## Быстрый старт

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# вставь свои BYBIT_API_KEY и BYBIT_API_SECRET
python app.py
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
python -m py_compile app.py
```
