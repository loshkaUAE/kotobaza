const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refreshBtn');

const totalEquityEl = document.getElementById('totalEquity');
const totalWalletBalanceEl = document.getElementById('totalWalletBalance');
const openPositionsEl = document.getElementById('openPositions');
const totalPnlEl = document.getElementById('totalPnl');

const balancesBody = document.getElementById('balancesBody');
const positionsBody = document.getElementById('positionsBody');
const marketBody = document.getElementById('marketBody');

const money = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

function pnlClass(value) {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return '';
}

async function loadDashboard() {
  statusEl.textContent = 'Обновляю данные...';

  try {
    const res = await fetch('/api/overview');
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Ошибка запроса');
    }

    totalEquityEl.textContent = `$${money(data.wallet.totalEquity)}`;
    totalWalletBalanceEl.textContent = `$${money(data.wallet.totalWalletBalance)}`;
    openPositionsEl.textContent = String(data.positions.openCount);
    totalPnlEl.textContent = `$${money(data.positions.totalUnrealisedPnl)}`;
    totalPnlEl.className = pnlClass(data.positions.totalUnrealisedPnl);

    balancesBody.innerHTML = data.wallet.balances.length
      ? data.wallet.balances
          .map((item) => `<tr><td>${item.coin}</td><td>${money(item.walletBalance)}</td><td>$${money(item.usdValue)}</td></tr>`)
          .join('')
      : '<tr><td colspan="3">Нет данных</td></tr>';

    positionsBody.innerHTML = data.positions.openPositions.length
      ? data.positions.openPositions
          .map(
            (item) =>
              `<tr><td>${item.symbol}</td><td>${item.side}</td><td>${money(item.size)}</td><td class="${pnlClass(item.unrealisedPnl)}">$${money(item.unrealisedPnl)}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="4">Нет открытых позиций</td></tr>';

    marketBody.innerHTML = data.market.length
      ? data.market
          .map(
            (item) =>
              `<tr><td>${item.symbol}</td><td>${money(item.lastPrice)}</td><td class="${pnlClass(item.price24hPcnt)}">${(item.price24hPcnt * 100).toFixed(2)}%</td><td>${money(item.turnover24h)}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="4">Нет рыночных данных</td></tr>';

    statusEl.textContent = `Последнее обновление: ${new Date(data.generatedAt).toLocaleString()}`;
  } catch (error) {
    statusEl.textContent = `Ошибка: ${error.message}`;
  }
}

refreshBtn.addEventListener('click', loadDashboard);
loadDashboard();
