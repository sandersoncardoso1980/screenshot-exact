import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptySignal,
  evaluateSignal,
  transitionSignal,
  type Direction,
  type SignalState,
} from "./signal";
import type { Candle, Exchange, MarketState } from "./types";

export const HORIZONS = [30, 60, 300] as const;
export type Horizon = (typeof HORIZONS)[number];
export interface SignalEntry {
  time: number;
  symbol: string;
  exchange: Exchange;
  direction: Direction;
  confidence: number;
  price: number;
  spread: number;
  returns: Partial<Record<Horizon, number>>;
}
export interface LogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = "crypto-flow-signal-log-v1";
export function netReturn(
  entry: Pick<SignalEntry, "price" | "spread" | "direction">,
  exitPrice: number,
): number {
  if (entry.price <= 0 || exitPrice <= 0 || entry.direction === "NEUTRO") return 0;
  return (
    ((exitPrice - entry.price) / entry.price) * 100 * (entry.direction === "COMPRA" ? 1 : -1) -
    (Math.max(0, entry.spread) / entry.price) * 100 -
    0.05
  );
}
export function readSignalLog(storage?: LogStorage): SignalEntry[] {
  try {
    const value: unknown = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const entries: SignalEntry[] = [];
    for (const item of value.slice(-500)) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      if (
        !["COMPRA", "VENDA", "NEUTRO"].includes(String(r["direction"])) ||
        !["binance", "bybit", "okx"].includes(String(r["exchange"])) ||
        typeof r["symbol"] !== "string"
      )
        continue;
      if (
        ![r["time"], r["confidence"], r["price"], r["spread"]].every(
          (v) => typeof v === "number" && Number.isFinite(v),
        )
      )
        continue;
      if (
        Number(r["price"]) <= 0 ||
        Number(r["spread"]) < 0 ||
        Number(r["confidence"]) < 0 ||
        Number(r["confidence"]) > 100
      )
        continue;
      const returns: Partial<Record<Horizon, number>> = {},
        raw = r["returns"];
      if (raw && typeof raw === "object")
        for (const h of HORIZONS) {
          const result = (raw as Record<string, unknown>)[String(h)];
          if (typeof result === "number" && Number.isFinite(result)) returns[h] = result;
        }
      entries.push({
        time: Number(r["time"]),
        symbol: r["symbol"],
        exchange: r["exchange"] as Exchange,
        direction: r["direction"] as Direction,
        confidence: Number(r["confidence"]),
        price: Number(r["price"]),
        spread: Number(r["spread"]),
        returns,
      });
    }
    return entries;
  } catch {
    return [];
  }
}
export function writeSignalLog(entries: SignalEntry[], storage?: LogStorage): boolean {
  try {
    (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify(entries.slice(-500)));
    return true;
  } catch {
    return false;
  }
}
export function appendSignal(entries: SignalEntry[], entry: SignalEntry): SignalEntry[] {
  return [...entries, entry].slice(-500);
}
export function settleLog(
  entries: SignalEntry[],
  markets: MarketState[],
  symbol: string,
  now: number,
): SignalEntry[] {
  let changed = false;
  const result = entries.map((entry) => {
    if (entry.symbol !== symbol || entry.direction === "NEUTRO") return entry;
    const market = markets.find((m) => m.exchange === entry.exchange);
    if (!market) return entry;
    const returns = { ...entry.returns };
    let updated = false;
    for (const horizon of HORIZONS) {
      if (returns[horizon] !== undefined || now < entry.time + horizon * 1000) continue;
      const target = entry.time + horizon * 1000;
      // Never use a late current price as if it were the price at an earlier horizon.
      const bucket = market.buckets.find(
        (b) => b.time * 1000 >= target && b.time * 1000 <= target + 5000 && b.time * 1000 <= now,
      );
      if (bucket && bucket.lastPrice > 0) {
        returns[horizon] = netReturn(entry, bucket.lastPrice);
        changed = true;
        updated = true;
      }
    }
    return updated ? { ...entry, returns } : entry;
  });
  return changed ? result : entries;
}
export function logStatistics(entries: SignalEntry[], symbol: string, horizon: Horizon) {
  return [
    { label: "<50", accept: (n: number) => n < 50 },
    { label: "50–75", accept: (n: number) => n >= 50 && n <= 75 },
    { label: ">75", accept: (n: number) => n > 75 },
  ].map((band) => {
    const returns = entries
      .filter((e) => e.symbol === symbol && e.direction !== "NEUTRO" && band.accept(e.confidence))
      .flatMap((e) => (e.returns[horizon] === undefined ? [] : [e.returns[horizon]]));
    return {
      label: band.label,
      count: returns.length,
      sufficient: returns.length >= 20,
      winRate: returns.length ? (returns.filter((v) => v > 0).length / returns.length) * 100 : 0,
      mean: returns.length ? returns.reduce((s, v) => s + v, 0) / returns.length : 0,
    };
  });
}
export function useSignalEngine(
  markets: MarketState[],
  candles: Candle[],
  seconds: number,
  now: number,
  symbol: string,
  selected: MarketState | undefined,
  timeframe: string,
) {
  const candidate = useMemo(
    () => evaluateSignal(markets, candles, seconds, now),
    [markets, candles, seconds, now],
  );
  const [state, setState] = useState<SignalState>(emptySignal);
  const [entries, setEntries] = useState<SignalEntry[]>([]);
  const machine = useRef(emptySignal()),
    key = useRef(""),
    log = useRef<SignalEntry[]>([]),
    storageReady = useRef(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    log.current = readSignalLog();
    setEntries(log.current);
    storageReady.current = true;
  }, []);
  useEffect(() => {
    if (!now || !storageReady.current) return;
    const contextKey = `${symbol}:${seconds}:${timeframe}:${selected?.exchange ?? ""}`;
    const changedContext = contextKey !== key.current;
    if (changedContext) {
      machine.current = emptySignal();
      key.current = contextKey;
    }
    const previous = machine.current,
      next = transitionSignal(previous, candidate, now);
    machine.current = next;
    setState(next);
    let updated = settleLog(log.current, markets, symbol, now);
    if (
      !changedContext &&
      next.direction !== previous.direction &&
      selected?.ticker.price &&
      Number.isFinite(selected.ticker.price)
    ) {
      const bid = selected.book.bids[0]?.[0],
        ask = selected.book.asks[0]?.[0];
      // A directional sample without a real spread cannot support a net-return measurement.
      if (bid !== undefined && ask !== undefined && ask >= bid)
        updated = appendSignal(updated, {
          time: now,
          symbol,
          exchange: selected.exchange,
          direction: next.direction,
          confidence: next.confidence,
          price: selected.ticker.price,
          spread: ask - bid,
          returns: {},
        });
    }
    if (updated !== log.current) {
      log.current = updated;
      setEntries(updated);
      setStorageAvailable(writeSignalLog(updated));
    }
  }, [candidate, markets, now, seconds, selected, symbol, timeframe]);
  return { candidate, state, entries, storageAvailable };
}
