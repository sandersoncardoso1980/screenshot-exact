import type { Book, BookSample, Candle, MarketState, SecondBucket, Trade } from "./types";
import { median } from "./normalize";

export type Direction = "COMPRA" | "VENDA" | "NEUTRO";
export const WINDOWS = [10, 30, 60] as const;
const clamp = (value: number, low = -100, high = 100) => Math.max(low, Math.min(high, value));
export function winsorizedFlow(trades: Trade[]) {
  const cap = 5 * median(trades.map((t) => t.price * t.quantity));
  let buy = 0,
    sell = 0,
    buyCount = 0,
    sellCount = 0;
  for (const t of trades) {
    const value = Math.min(t.price * t.quantity, cap);
    if (t.side === "buy") {
      buy += value;
      buyCount++;
    } else {
      sell += value;
      sellCount++;
    }
  }
  const volume = buy + sell,
    count = buyCount + sellCount;
  return {
    buy,
    sell,
    delta: buy - sell,
    volume,
    count,
    deltaPct: volume ? ((buy - sell) / volume) * 100 : 0,
    countDelta: count ? ((buyCount - sellCount) / count) * 100 : 0,
  };
}
function bucketDelta(buckets: SecondBucket[]) {
  const values = buckets.flatMap((b) => [...b.buyValues, ...b.sellValues]),
    cap = median(values) * 5;
  if (!values.length) return buckets.reduce((sum, b) => sum + b.buy - b.sell, 0);
  return buckets.reduce(
    (sum, b) =>
      sum +
      b.buyValues.reduce((s, v) => s + Math.min(v, cap), 0) -
      b.sellValues.reduce((s, v) => s + Math.min(v, cap), 0),
    0,
  );
}
export function adaptiveDelta(m: MarketState, seconds: number, now: number) {
  const trades = m.trades.filter((t) => t.time > now - seconds * 1000 && t.time <= now);
  const robust = winsorizedFlow(trades);
  const end = Math.floor(now / 1000) - seconds;
  const history = m.buckets.filter((b) => b.time >= Math.floor(now / 1000) - 900 && b.time < end);
  const oldest = history[0]?.time;
  const baseline: number[] = [];
  if (oldest !== undefined && now / 1000 - oldest >= 180) {
    const groups = new Map<number, SecondBucket[]>();
    for (const b of history) {
      const key = Math.floor((end - 1 - b.time) / seconds);
      const group = groups.get(key) ?? [];
      group.push(b);
      groups.set(key, group);
    }
    for (const [key, group] of groups)
      if (end - (key + 1) * seconds >= oldest) baseline.push(bucketDelta(group));
  }
  const mean = baseline.length ? baseline.reduce((s, v) => s + v, 0) / baseline.length : 0;
  const variance =
    baseline.length > 1
      ? baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / (baseline.length - 1)
      : 0;
  const fallback = baseline.length < 2 || !(variance > 0);
  const z = fallback ? null : (robust.delta - mean) / Math.sqrt(variance);
  const notional = trades.reduce((s, t) => s + t.price * t.quantity, 0);
  // z-score measures unusual aggression; direction still follows the actual delta.
  const magnitude = z === null ? Math.abs(robust.deltaPct) : Math.min(100, (Math.abs(z) / 3) * 100);
  const directional = Math.sign(robust.delta) * magnitude;
  return {
    ...robust,
    notional,
    z,
    fallback,
    flowScore: directional * 0.8 + robust.countDelta * 0.2,
    strong: fallback ? Math.abs(robust.deltaPct) > 60 : Math.abs(z ?? 0) >= 2,
    active: fallback ? Math.abs(robust.deltaPct) > 20 : Math.abs(z ?? 0) >= 1,
  };
}
export function comparableBook(book: Book) {
  const bid = book.bids[0]?.[0],
    ask = book.asks[0]?.[0];
  if (bid === undefined || ask === undefined || bid <= 0 || ask < bid) return null;
  const mid = (bid + ask) / 2;
  const band = (width: number) => {
    const buy = book.bids
      .filter(([p]) => p >= mid * (1 - width) && p <= mid)
      .reduce((s, [p, q]) => s + p * q, 0);
    const sell = book.asks
      .filter(([p]) => p <= mid * (1 + width) && p >= mid)
      .reduce((s, [p, q]) => s + p * q, 0);
    return buy + sell ? ((buy - sell) / (buy + sell)) * 100 : 0;
  };
  return { mid, spread: ask - bid, near: band(0.001), wide: band(0.0025) };
}
export function persistentBook(samples: BookSample[], now: number) {
  const relevant = samples.filter((b) => b.time <= now && b.time >= now - 15000);
  const last = relevant.at(-1);
  if (!last || now - last.time > 1500) return { score: 0, change: 0, persistent: false };
  const sign = Math.sign((last.near + last.wide) / 2);
  let since = last.time;
  for (let i = relevant.length - 2; i >= 0; i--) {
    const b = relevant[i];
    if (!b || Math.sign((b.near + b.wide) / 2) !== sign || since - b.time > 1500) break;
    since = b.time;
  }
  const old = relevant.find((b) => b.time >= now - 10000);
  const change =
    old && old.time <= now - 9000 ? (last.near + last.wide - old.near - old.wide) / 2 : 0;
  const persistent = sign !== 0 && now - since >= 3000;
  return {
    score: persistent ? clamp((last.near + last.wide) / 2 + change * 0.25) : 0,
    change,
    persistent,
  };
}
export function priceResponse(
  m: MarketState,
  seconds: number,
  now: number,
  strong: boolean,
  delta: number,
) {
  const trades = m.trades.filter((t) => t.time > now - seconds * 1000 && t.time <= now);
  const first = trades[0],
    last = trades.at(-1);
  if (!first || !last) return { factor: 1, movement: 0, absorption: false, confirms: false };
  const movement = ((last.price - first.price) / first.price) * 100;
  const absorption =
    strong && (Math.abs(movement) < 0.01 || Math.sign(movement) !== Math.sign(delta));
  const confirms = Math.abs(movement) > 0.02 && Math.sign(movement) === Math.sign(delta);
  return { factor: absorption ? 0.55 : confirms ? 1.15 : 1, movement, absorption, confirms };
}
function average(candles: Candle[], period: number, exponential: boolean) {
  if (candles.length < period) return undefined;
  let result = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  if (!exponential) return candles.slice(-period).reduce((s, c) => s + c.close, 0) / period;
  for (const c of candles.slice(period)) result += ((c.close - result) * 2) / (period + 1);
  return result;
}
export function regime(candles: Candle[], direction: number) {
  const ema9 = average(candles, 9, true),
    ema20 = average(candles, 20, true),
    ema50 = average(candles, 50, true),
    sma200 = average(candles, 200, false),
    close = candles.at(-1)?.close;
  const atrs: number[] = [],
    ranges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i],
      prev = candles[i - 1];
    if (!c || !prev) continue;
    ranges.push(
      Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)),
    );
    if (ranges.length >= 14) atrs.push(ranges.slice(-14).reduce((s, v) => s + v, 0) / 14);
  }
  const atr = atrs.at(-1),
    previous = atrs.slice(-101, -1).sort((a, b) => a - b);
  const percentile20 = previous.length === 100 ? previous[19] : undefined;
  const lowVolatility = atr !== undefined && percentile20 !== undefined && atr <= percentile20;
  const trend =
    ema9 !== undefined &&
    ema20 !== undefined &&
    ema50 !== undefined &&
    sma200 !== undefined &&
    close !== undefined
      ? ema9 > ema20 && ema20 > ema50 && close > sma200
        ? 1
        : ema9 < ema20 && ema20 < ema50 && close < sma200
          ? -1
          : 0
      : 0;
  const counterTrend = trend !== 0 && direction !== 0 && direction !== trend;
  const aligned = trend !== 0 && direction === trend;
  return {
    trend,
    counterTrend,
    lowVolatility,
    atr,
    ema9,
    ema20,
    ema50,
    sma200,
    factor: (counterTrend ? 0.8 : aligned ? 1.1 : 1) * (lowVolatility ? 0.7 : 1),
  };
}
export function aggregateWindow(markets: MarketState[], seconds: number, now: number) {
  const eligible = markets
    .filter((m) => m.status === "live")
    .map((m) => ({ market: m, flow: adaptiveDelta(m, seconds, now) }))
    .filter((s) => s.flow.count >= 5 && s.flow.notional >= 20000);
  const total = eligible.reduce((s, m) => s + m.flow.notional, 0);
  let score = 0,
    response = 0,
    books = 0,
    absorption = false,
    confirms = false;
  for (const s of eligible) {
    const weight = s.flow.notional / total,
      book = persistentBook(s.market.bookHistory, now),
      price = priceResponse(s.market, seconds, now, s.flow.strong, s.flow.delta);
    score +=
      weight * (book.persistent ? s.flow.flowScore * 0.8 + book.score * 0.2 : s.flow.flowScore);
    response += weight * price.factor;
    if (book.persistent) books++;
    if (weight >= 0.1) {
      absorption ||= price.absorption;
      confirms ||= price.confirms;
    }
  }
  const sign = Math.sign(score),
    quorum = total
      ? eligible
          .filter((s) => Math.sign(s.flow.flowScore) === sign)
          .reduce((sum, s) => sum + s.flow.notional, 0) / total
      : 0;
  return {
    score,
    total,
    sources: eligible.length,
    response: total ? response : 1,
    quorum,
    absorption,
    confirms,
    books,
    fallback: eligible.some((s) => s.flow.fallback),
  };
}
export interface SignalCandidate {
  direction: Direction;
  confidence: number;
  score: number;
  sources: number;
  factors: string[];
  fallback: boolean;
  buy: number;
  sell: number;
  neutral: number;
}
export function evaluateSignal(
  markets: MarketState[],
  candles: Candle[],
  seconds: number,
  now: number,
): SignalCandidate {
  const current = aggregateWindow(markets, seconds, now),
    directional = Math.sign(current.score),
    r = regime(candles, directional);
  const windows = WINDOWS.map((s) => aggregateWindow(markets, s, now));
  const aligned = windows.filter(
    (w) => w.sources >= 2 && Math.sign(w.score) === directional && directional !== 0,
  ).length;
  const alignment = aligned >= 2 ? (aligned === 3 ? 10 : 5) : 0;
  const factors: string[] = [];
  if (current.sources < 2) factors.push("Quórum insuficiente");
  if (current.fallback) factors.push("Base em formação (<3 min ou variância insuficiente)");
  else if (current.sources) factors.push("Delta adaptativo");
  if (current.absorption) factors.push("Possível absorção");
  else if (current.confirms) factors.push("Preço confirma");
  if (current.books) factors.push("Livro persistente");
  if (r.counterTrend) factors.push("CONTRA TENDÊNCIA");
  else if (r.trend === directional && directional !== 0) factors.push("A favor da tendência");
  if (r.lowVolatility) factors.push("ATR baixo");
  if (aligned >= 2) factors.push(`${aligned}/3 janelas alinhadas`);
  if (current.sources === 2) factors.push("2 fontes · limite 70%");
  // Count-direction has 20% within the flow score; notional determines source weights.
  const confidence =
    current.sources >= 2
      ? clamp(
          (Math.abs(current.score) * current.quorum + alignment) * current.response * r.factor,
          0,
          current.sources === 2 ? 70 : 100,
        )
      : 0;
  const direction: Direction =
    current.sources >= 2 && directional !== 0 ? (directional > 0 ? "COMPRA" : "VENDA") : "NEUTRO";
  return {
    direction,
    confidence,
    score: current.score,
    sources: current.sources,
    factors,
    fallback: current.fallback,
    buy: current.sources >= 2 ? Math.max(0, current.score) : 0,
    sell: current.sources >= 2 ? Math.max(0, -current.score) : 0,
    neutral: current.sources >= 2 ? 100 - Math.abs(current.score) : 100,
  };
}
export interface SignalState {
  direction: Direction;
  confidence: number;
  pending: Direction;
  pendingSince: number;
  lastDirectional: Direction;
  lastSwitch: number;
}
export function emptySignal(): SignalState {
  return {
    direction: "NEUTRO",
    confidence: 0,
    pending: "NEUTRO",
    pendingSince: 0,
    lastDirectional: "NEUTRO",
    lastSwitch: 0,
  };
}
export function transitionSignal(
  previous: SignalState,
  candidate: SignalCandidate,
  now: number,
): SignalState {
  const state = { ...previous };
  if (candidate.sources < 2 || candidate.confidence < 15)
    return { ...state, direction: "NEUTRO", confidence: 0, pending: "NEUTRO", pendingSince: 0 };
  if (candidate.direction === state.direction)
    return { ...state, confidence: candidate.confidence, pending: "NEUTRO", pendingSince: 0 };
  if (candidate.direction === "NEUTRO" || candidate.confidence < 35)
    return {
      ...state,
      confidence:
        state.direction === "NEUTRO" ? 0 : Math.min(state.confidence, candidate.confidence),
      pending: "NEUTRO",
      pendingSince: 0,
    };
  const switching =
    state.lastDirectional !== "NEUTRO" && candidate.direction !== state.lastDirectional;
  if (switching && now - state.lastSwitch < 10000)
    return {
      ...state,
      confidence: Math.min(state.confidence, candidate.confidence),
      pending: "NEUTRO",
      pendingSince: 0,
    };
  if (state.pending !== candidate.direction)
    return { ...state, pending: candidate.direction, pendingSince: now };
  if (now - state.pendingSince < 3000) return state;
  return {
    direction: candidate.direction,
    confidence: candidate.confidence,
    pending: "NEUTRO",
    pendingSince: 0,
    lastDirectional: candidate.direction,
    lastSwitch: now,
  };
}
