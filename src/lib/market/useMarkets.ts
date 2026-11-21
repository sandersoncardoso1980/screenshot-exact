import { useEffect, useRef, useState } from "react";
import { BinanceSpotAdapter } from "./BinanceSpotAdapter";
import { BybitLinearAdapter } from "./BybitLinearAdapter";
import { OKXSpotAdapter } from "./OKXSpotAdapter";
import {
  addToBucket,
  correctedTrade,
  estimateClockOffset,
  mergeCandles,
  validTrade,
} from "./normalize";
import { comparableBook } from "./signal";
import {
  EXCHANGES,
  emptyMarket,
  type Exchange,
  type MarketState,
  type MarketUpdate,
  type SecondBucket,
  type Timeframe,
} from "./types";
export function useMarkets(symbol: string, timeframe: Timeframe, paused: boolean) {
  const [markets, setMarkets] = useState<MarketState[]>(() => EXCHANGES.map((e) => emptyMarket(e)));
  const [now, setNow] = useState(0);
  const store = useRef<MarketState[]>([]),
    pause = useRef(paused),
    asset = useRef("");
  pause.current = paused;
  const seen = useRef(new Map<Exchange, Map<string, number>>());
  useEffect(() => {
    let active = true;
    if (asset.current !== symbol) {
      store.current = EXCHANGES.map((e) => emptyMarket(e, Date.now()));
      seen.current = new Map(EXCHANGES.map((e) => [e, new Map()]));
      asset.current = symbol;
    } else
      store.current = store.current.map((m) => ({
        ...m,
        candles: [],
        book: { bids: [], asks: [] },
        bookHistory: [],
        status: "connecting",
        error: "",
        historyError: "",
      }));
    const indexes = new Map<Exchange, Map<number, SecondBucket>>(
      store.current.map((m) => [m.exchange, new Map(m.buckets.map((b) => [b.time, b]))]),
    );
    setMarkets(store.current.map((m) => ({ ...m })));
    setNow(Date.now());
    const emit = (exchange: Exchange) => (u: MarketUpdate) => {
      if (!active) return;
      const m = store.current.find((m) => m.exchange === exchange);
      if (!m) return;
      const time = Date.now();
      if (u.status) {
        if (u.status === "offline" || u.status === "connecting") m.bookHistory = [];
        m.status = u.status;
      }
      if (u.lastMessage) m.lastMessage = u.lastMessage;
      if (u.error !== undefined) m.error = u.error;
      if (u.historyError !== undefined) m.historyError = u.historyError;
      if (u.ticker) {
        for (const [key, value] of Object.entries(u.ticker))
          if (typeof value === "number" && Number.isFinite(value))
            m.ticker = { ...m.ticker, [key]: value };
        const oi = m.ticker.openInterest,
          price = m.ticker.price;
        if (
          u.ticker.openInterest !== undefined &&
          oi !== undefined &&
          price !== undefined &&
          price > 0
        )
          m.oiHistory.push({ time, openInterest: oi, price });
      }
      if (u.book) {
        m.book = u.book;
        const sample = comparableBook(u.book),
          last = m.bookHistory.at(-1);
        if (sample && (!last || time - last.time >= 400))
          m.bookHistory.push({ time, near: sample.near, wide: sample.wide });
      }
      const ids = seen.current.get(exchange),
        index = indexes.get(exchange);
      if (u.trades && ids && index) {
        const raw = u.trades.filter((t) => validTrade(t) && !ids.has(t.id));
        for (const t of raw)
          if (Math.abs(time - t.time) < 60000) m.clockOffsets.push(time - t.time);
        m.clockOffsets = m.clockOffsets.slice(-50);
        m.clockOffset = estimateClockOffset(m.clockOffsets);
        for (const original of raw) {
          if (ids.has(original.id)) continue;
          const trade = correctedTrade(original, m.clockOffset);
          if (trade.time <= time - 60000 || trade.time > time + 2000) continue;
          ids.set(trade.id, time);
          m.trades.push(trade);
          const second = Math.floor(trade.time / 1000);
          let bucket = index.get(second);
          if (!bucket) {
            bucket = {
              time: second,
              buy: 0,
              sell: 0,
              buyCount: 0,
              sellCount: 0,
              lastPrice: trade.price,
              buyValues: [],
              sellValues: [],
            };
            index.set(second, bucket);
          }
          addToBucket(bucket, trade);
        }
      }
      if (u.history) m.candles = mergeCandles(u.history, m.candles);
      if (u.candle) m.candles = mergeCandles(m.candles, [u.candle]);
    };
    const adapters = [
      new BinanceSpotAdapter(symbol, timeframe, emit("binance")),
      new BybitLinearAdapter(symbol, timeframe, emit("bybit")),
      new OKXSpotAdapter(symbol, timeframe, emit("okx")),
    ];
    adapters.forEach((a) => a.start());
    const interval = setInterval(() => {
      const time = Date.now();
      for (const m of store.current) {
        m.trades = m.trades.filter((t) => t.time > time - 60000).sort((a, b) => a.time - b.time);
        const ids = seen.current.get(m.exchange),
          index = indexes.get(m.exchange);
        if (ids) for (const [id, t] of ids) if (t <= time - 900000) ids.delete(id);
        if (index) {
          for (const second of index.keys())
            if (second < Math.floor(time / 1000) - 899) index.delete(second);
          m.buckets = [...index.values()].sort((a, b) => a.time - b.time);
        }
        m.bookHistory = m.bookHistory.filter((b) => b.time > time - 15000);
        m.oiHistory = m.oiHistory.filter((o) => o.time > time - 900000);
        if ((m.status === "live" || m.status === "stale") && m.lastMessage)
          m.status = time - m.lastMessage > 15000 ? "stale" : "live";
      }
      if (!pause.current) {
        setMarkets(
          store.current.map((m) => ({
            ...m,
            trades: [...m.trades],
            candles: [...m.candles],
            ticker: { ...m.ticker },
            buckets: [...m.buckets],
            bookHistory: [...m.bookHistory],
            oiHistory: [...m.oiHistory],
          })),
        );
        setNow(time);
      }
    }, 500);
    return () => {
      active = false;
      clearInterval(interval);
      adapters.forEach((a) => a.stop());
    };
  }, [symbol, timeframe]);
  return { markets, now };
}
