import type { Book, Candle, SecondBucket, Trade } from "./types";
export function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length
    ? sorted.length % 2
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : 0;
}
export function estimateClockOffset(samples: number[]): number {
  return Math.max(-5000, Math.min(5000, median(samples.slice(-50))));
}
export function correctedTrade(trade: Trade, offset: number): Trade {
  return { ...trade, time: trade.time + Math.max(-5000, Math.min(5000, offset)) };
}
export function addToBucket(bucket: SecondBucket, trade: Trade): void {
  const value = trade.price * trade.quantity;
  if (trade.side === "buy") {
    bucket.buy += value;
    bucket.buyCount++;
    bucket.buyValues.push(value);
  } else {
    bucket.sell += value;
    bucket.sellCount++;
    bucket.sellValues.push(value);
  }
  bucket.lastPrice = trade.price;
}
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function n(value: unknown): number {
  return Number(value);
}
export function validTrade(t: Trade): boolean {
  return (
    Number.isFinite(t.price) &&
    t.price > 0 &&
    Number.isFinite(t.quantity) &&
    t.quantity > 0 &&
    Number.isFinite(t.time)
  );
}
export function binanceTrade(value: unknown): Trade {
  const d = record(value);
  return {
    id: String(d["t"]),
    time: n(d["T"]),
    price: n(d["p"]),
    quantity: n(d["q"]),
    side: d["m"] === true ? "sell" : "buy",
  };
}
export function bybitTrade(value: unknown): Trade {
  const d = record(value);
  return {
    id: String(d["i"]),
    time: n(d["T"]),
    price: n(d["p"]),
    quantity: n(d["v"]),
    side: d["S"] === "Buy" ? "buy" : "sell",
  };
}
export function okxTrade(value: unknown): Trade {
  const d = record(value);
  return {
    id: String(d["tradeId"]),
    time: n(d["ts"]),
    price: n(d["px"]),
    quantity: n(d["sz"]),
    side: d["side"] === "buy" ? "buy" : "sell",
  };
}
export function levels(value: unknown): [number, number][] {
  return list(value)
    .map((row) => {
      const a = list(row);
      return [n(a[0]), n(a[1])] as [number, number];
    })
    .filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q));
}
export function arrayCandle(value: unknown): Candle {
  const a = list(value);
  return {
    time: Math.floor(n(a[0]) / 1000),
    open: n(a[1]),
    high: n(a[2]),
    low: n(a[3]),
    close: n(a[4]),
    volume: n(a[5]),
  };
}
export function validCandle(c: Candle): boolean {
  return [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) && c.close > 0;
}
export function mergeCandles(a: Candle[], b: Candle[]): Candle[] {
  const map = new Map(a.map((c) => [c.time, c]));
  for (const c of b) if (validCandle(c)) map.set(c.time, c);
  return [...map.values()].sort((x, y) => x.time - y.time).slice(-500);
}
export function updateBook(previous: Book, value: unknown, snapshot: boolean): Book {
  const d = record(value);
  function merge(old: [number, number][], delta: unknown, descending: boolean): [number, number][] {
    const map = new Map(snapshot ? [] : old);
    for (const [p, q] of levels(delta)) {
      if (q === 0) map.delete(p);
      else map.set(p, q);
    }
    return [...map.entries()].sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0])).slice(0, 50);
  }
  return { bids: merge(previous.bids, d["b"], true), asks: merge(previous.asks, d["a"], false) };
}
