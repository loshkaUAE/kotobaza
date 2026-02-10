const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
const RECV_WINDOW = process.env.BYBIT_RECV_WINDOW || '5000';

const API_KEY = process.env.BYBIT_API_KEY || '';
const API_SECRET = process.env.BYBIT_API_SECRET || '';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function signBybitRequest(timestamp, queryString = '') {
  const payload = `${timestamp}${API_KEY}${RECV_WINDOW}${queryString}`;
  return crypto.createHmac('sha256', API_SECRET).update(payload).digest('hex');
}

async function bybitGet(endpoint, query = {}) {
  const queryString = new URLSearchParams(query).toString();
  const timestamp = Date.now().toString();

  if (!API_KEY || !API_SECRET) {
    throw new Error('Bybit API keys are not configured. Set BYBIT_API_KEY and BYBIT_API_SECRET.');
  }

  const signature = signBybitRequest(timestamp, queryString);
  const url = `${BYBIT_BASE_URL}${endpoint}${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': API_KEY,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN': signature,
    },
  });

  const data = await response.json();

  if (!response.ok || data.retCode !== 0) {
    const reason = data.retMsg || response.statusText || 'Unknown error';
    throw new Error(`Bybit API error: ${reason}`);
  }

  return data.result;
}

function summarizeWallet(walletResult) {
  const list = walletResult?.list || [];
  const first = list[0] || {};
  const coins = first.coin || [];
  const importantCoins = ['USDT', 'BTC', 'ETH', 'USDC'];

  const balances = coins
    .filter((coin) => importantCoins.includes(coin.coin) || Number(coin.walletBalance) > 0)
    .slice(0, 10)
    .map((coin) => ({
      coin: coin.coin,
      walletBalance: Number(coin.walletBalance || 0),
      usdValue: Number(coin.usdValue || 0),
      availableToWithdraw: Number(coin.availableToWithdraw || 0),
    }))
    .sort((a, b) => b.usdValue - a.usdValue);

  return {
    totalEquity: Number(first.totalEquity || 0),
    totalWalletBalance: Number(first.totalWalletBalance || 0),
    totalMarginBalance: Number(first.totalMarginBalance || 0),
    balances,
  };
}

function summarizePositions(positionResult) {
  const list = positionResult?.list || [];

  const openPositions = list
    .filter((item) => Number(item.size) > 0)
    .map((item) => ({
      symbol: item.symbol,
      side: item.side,
      size: Number(item.size),
      avgPrice: Number(item.avgPrice || 0),
      markPrice: Number(item.markPrice || 0),
      unrealisedPnl: Number(item.unrealisedPnl || 0),
      leverage: item.leverage,
    }));

  const totalUnrealisedPnl = openPositions.reduce((acc, pos) => acc + pos.unrealisedPnl, 0);

  return {
    openCount: openPositions.length,
    totalUnrealisedPnl,
    openPositions,
  };
}

function summarizeTickers(tickerResult) {
  const list = tickerResult?.list || [];
  const tracked = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];

  return list
    .filter((row) => tracked.includes(row.symbol))
    .map((row) => ({
      symbol: row.symbol,
      lastPrice: Number(row.lastPrice || 0),
      price24hPcnt: Number(row.price24hPcnt || 0),
      turnover24h: Number(row.turnover24h || 0),
    }));
}

async function handleOverview(res) {
  try {
    const [wallet, positions, tickers] = await Promise.all([
      bybitGet('/v5/account/wallet-balance', { accountType: 'UNIFIED' }),
      bybitGet('/v5/position/list', { category: 'linear', settleCoin: 'USDT' }),
      bybitGet('/v5/market/tickers', { category: 'linear' }),
    ]);

    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      wallet: summarizeWallet(wallet),
      positions: summarizePositions(positions),
      market: summarizeTickers(tickers),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message,
      hint: 'Проверьте правильность BYBIT_API_KEY/BYBIT_API_SECRET и разрешения API ключа (Read-Only достаточно).',
    });
  }
}

async function handleSignCheck(req, res) {
  try {
    const bodyRaw = await readBody(req);
    const body = bodyRaw ? JSON.parse(bodyRaw) : {};
    const timestamp = Date.now().toString();
    const sampleQuery = new URLSearchParams(body.query || {}).toString();

    const signature = API_KEY && API_SECRET ? signBybitRequest(timestamp, sampleQuery) : null;

    sendJson(res, 200, {
      hasApiKey: Boolean(API_KEY),
      hasApiSecret: Boolean(API_SECRET),
      recvWindow: RECV_WINDOW,
      sampleSignature: signature,
      note: signature
        ? 'Подпись генерируется на сервере (ключи не уходят в браузер).'
        : 'Ключи не найдены в окружении сервера.',
    });
  } catch (error) {
    sendJson(res, 400, { error: 'Bad JSON body' });
  }
}

function serveStatic(reqPath, res) {
  const safePath = path.normalize(reqPath).replace(/^\.+/, '');
  const filePath = path.join(__dirname, 'public', safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/overview') {
    await handleOverview(res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/sign-check') {
    await handleSignCheck(req, res);
    return;
  }

  if (req.method === 'GET') {
    serveStatic(url.pathname, res);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Bybit dashboard is running on http://${HOST}:${PORT}`);
});
