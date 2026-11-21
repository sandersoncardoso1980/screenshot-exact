import { PublicSocket } from "./socket";
import { arrayCandle, bybitTrade, list, n, record, updateBook } from "./normalize";
import type { Book } from "./types";
export class BybitLinearAdapter extends PublicSocket {
  private book: Book = { bids: [], asks: [] };
  start() {
    this.connect(
      "wss://stream.bybit.com/v5/public/linear",
      (ws) => {
        this.book = { bids: [], asks: [] };
        ws.send(
          JSON.stringify({
            op: "subscribe",
            args: [
              `publicTrade.${this.symbol}`,
              `orderbook.50.${this.symbol}`,
              `tickers.${this.symbol}`,
              `kline.${this.timeframe}.${this.symbol}`,
            ],
          }),
        );
      },
      (raw) => {
        const d = record(JSON.parse(raw)),
          topic = String(d["topic"] ?? "");
        if (d["success"] === false) {
          this.emit({ error: String(d["ret_msg"] ?? "Assinatura recusada") });
          return false;
        }
        if (topic.startsWith("publicTrade")) {
          const trades = list(d["data"]).map(bybitTrade);
          this.emit({ trades });
          const last = trades.at(-1);
          if (last) this.emit({ ticker: { price: last.price } });
        } else if (topic.startsWith("orderbook")) {
          const data = record(d["data"]);
          this.book = updateBook(this.book, data, d["type"] === "snapshot" || data["u"] === 1);
          this.emit({ book: this.book });
        } else if (topic.startsWith("tickers")) {
          const t = record(d["data"]),
            ticker: Record<string, number> = {};
          for (const [field, key] of [
            ["price", "lastPrice"],
            ["high", "highPrice24h"],
            ["low", "lowPrice24h"],
            ["volume", "turnover24h"],
            ["openInterest", "openInterest"],
            ["fundingRate", "fundingRate"],
          ]) {
            if (field && key && t[key] !== undefined) ticker[field] = n(t[key]);
          }
          if (t["price24hPcnt"] !== undefined) ticker["change"] = n(t["price24hPcnt"]) * 100;
          this.emit({ ticker });
        } else if (topic.startsWith("kline")) {
          for (const item of list(d["data"])) {
            const k = record(item);
            this.emit({
              candle: {
                time: Math.floor(n(k["start"]) / 1000),
                open: n(k["open"]),
                high: n(k["high"]),
                low: n(k["low"]),
                close: n(k["close"]),
                volume: n(k["volume"]),
              },
            });
          }
        } else return false;
        return true;
      },
      (ws) => ws.send(JSON.stringify({ op: "ping" })),
    );
    void this.get(
      `https://api.bybit.com/v5/market/kline?category=linear&symbol=${this.symbol}&interval=${this.timeframe}&limit=400`,
    )
      .then((d) => {
        const root = record(d);
        if (n(root["retCode"]) !== 0) throw new Error("Exchange recusou o histórico");
        this.emit({
          history: list(record(root["result"])["list"]).map(arrayCandle),
          historyError: "",
        });
      })
      .catch(() => this.historyFailed());
  }
}
