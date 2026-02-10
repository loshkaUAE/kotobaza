import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
ENV_PATH = BASE_DIR / ".env"


def load_dotenv_if_present() -> None:
    if not ENV_PATH.exists():
        return

    for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv_if_present()

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "3000"))
BYBIT_BASE_URL = os.getenv("BYBIT_BASE_URL", "https://api.bybit.com")
BYBIT_RECV_WINDOW = os.getenv("BYBIT_RECV_WINDOW", "5000")

API_KEY = os.getenv("BYBIT_API_KEY", "")
API_SECRET = os.getenv("BYBIT_API_SECRET", "")

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
}


def now_ms() -> str:
    return str(int(datetime.now(tz=timezone.utc).timestamp() * 1000))


def bybit_signature(timestamp: str, query_string: str = "") -> str:
    payload = f"{timestamp}{API_KEY}{BYBIT_RECV_WINDOW}{query_string}"
    return hmac.new(API_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def bybit_get(endpoint: str, query: dict | None = None) -> dict:
    if not API_KEY or not API_SECRET:
        raise RuntimeError("Bybit API keys are not configured. Set BYBIT_API_KEY and BYBIT_API_SECRET.")

    query = query or {}
    query_string = urlencode(query)
    timestamp = now_ms()

    url = f"{BYBIT_BASE_URL}{endpoint}"
    if query_string:
        url = f"{url}?{query_string}"

    headers = {
        "X-BAPI-API-KEY": API_KEY,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": BYBIT_RECV_WINDOW,
        "X-BAPI-SIGN": bybit_signature(timestamp, query_string),
    }

    req = Request(url, headers=headers, method="GET")
    with urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    if data.get("retCode") != 0:
        raise RuntimeError(f"Bybit API error: {data.get('retMsg') or 'Unknown error'}")

    return data.get("result", {})


def summarize_wallet(wallet_result: dict) -> dict:
    first = (wallet_result.get("list") or [{}])[0]
    coins = first.get("coin") or []
    important = {"USDT", "BTC", "ETH", "USDC"}

    balances = [
        {
            "coin": coin.get("coin"),
            "walletBalance": float(coin.get("walletBalance") or 0),
            "usdValue": float(coin.get("usdValue") or 0),
            "availableToWithdraw": float(coin.get("availableToWithdraw") or 0),
        }
        for coin in coins
        if coin.get("coin") in important or float(coin.get("walletBalance") or 0) > 0
    ]

    balances.sort(key=lambda item: item["usdValue"], reverse=True)

    return {
        "totalEquity": float(first.get("totalEquity") or 0),
        "totalWalletBalance": float(first.get("totalWalletBalance") or 0),
        "totalMarginBalance": float(first.get("totalMarginBalance") or 0),
        "balances": balances[:10],
    }


def summarize_positions(position_result: dict) -> dict:
    rows = position_result.get("list") or []
    open_positions = [
        {
            "symbol": row.get("symbol"),
            "side": row.get("side"),
            "size": float(row.get("size") or 0),
            "avgPrice": float(row.get("avgPrice") or 0),
            "markPrice": float(row.get("markPrice") or 0),
            "unrealisedPnl": float(row.get("unrealisedPnl") or 0),
            "leverage": row.get("leverage"),
        }
        for row in rows
        if float(row.get("size") or 0) > 0
    ]

    return {
        "openCount": len(open_positions),
        "totalUnrealisedPnl": sum(item["unrealisedPnl"] for item in open_positions),
        "openPositions": open_positions,
    }


def summarize_tickers(ticker_result: dict) -> list[dict]:
    tracked = {"BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"}
    rows = ticker_result.get("list") or []

    return [
        {
            "symbol": row.get("symbol"),
            "lastPrice": float(row.get("lastPrice") or 0),
            "price24hPcnt": float(row.get("price24hPcnt") or 0),
            "turnover24h": float(row.get("turnover24h") or 0),
        }
        for row in rows
        if row.get("symbol") in tracked
    ]


class AppHandler(BaseHTTPRequestHandler):
    def send_json(self, payload: dict, status: int = 200) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def serve_static(self, req_path: str) -> None:
        raw_path = "/index.html" if req_path == "/" else req_path
        relative = raw_path.lstrip("/")
        file_path = (PUBLIC_DIR / relative).resolve()

        if not str(file_path).startswith(str(PUBLIC_DIR.resolve())):
            self.send_json({"error": "Forbidden"}, 403)
            return

        if not file_path.exists() or not file_path.is_file():
            self.send_json({"error": "Not found"}, 404)
            return

        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME_TYPES.get(file_path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)

        if parsed.path == "/api/overview":
            try:
                wallet = bybit_get("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
                positions = bybit_get("/v5/position/list", {"category": "linear", "settleCoin": "USDT"})
                tickers = bybit_get("/v5/market/tickers", {"category": "linear"})
                self.send_json(
                    {
                        "generatedAt": datetime.now(tz=timezone.utc).isoformat(),
                        "wallet": summarize_wallet(wallet),
                        "positions": summarize_positions(positions),
                        "market": summarize_tickers(tickers),
                    }
                )
            except Exception as exc:  # noqa: BLE001
                self.send_json(
                    {
                        "error": str(exc),
                        "hint": "Проверьте BYBIT_API_KEY/BYBIT_API_SECRET и Read-Only права ключа.",
                    },
                    500,
                )
            return

        self.serve_static(parsed.path)

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/sign-check":
            self.send_json({"error": "Method not allowed"}, 405)
            return

        try:
            content_len = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_len) if content_len > 0 else b"{}"
            body = json.loads(raw.decode("utf-8")) if raw else {}
            query = body.get("query") or {}
            qs = urlencode(query, doseq=True)
            ts = now_ms()
            signature = bybit_signature(ts, qs) if API_KEY and API_SECRET else None

            self.send_json(
                {
                    "hasApiKey": bool(API_KEY),
                    "hasApiSecret": bool(API_SECRET),
                    "recvWindow": BYBIT_RECV_WINDOW,
                    "sampleSignature": signature,
                    "note": "Подпись генерируется на сервере." if signature else "Ключи не найдены в окружении сервера.",
                }
            )
        except Exception:  # noqa: BLE001
            self.send_json({"error": "Bad JSON body"}, 400)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Bybit dashboard is running on http://{HOST}:{PORT}")
    server.serve_forever()
