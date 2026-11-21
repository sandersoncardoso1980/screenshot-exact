import type { Candle, MarketState, Trade } from "./types";
import { adaptiveDelta, comparableBook, persistentBook, priceResponse } from "./signal";
export function flow(trades: Trade[], seconds: number, now: number) {
  const window = trades.filter((t) => t.time > now - seconds * 1000 && t.time <= now);
  let buy = 0,
    sell = 0,
    largest = 0;
  for (const t of window) {
    const value = t.price * t.quantity;
    if (t.side === "buy") buy += value;
    else sell += value;
    largest = Math.max(largest, value);
  }
  const volume = buy + sell;
  return {
    buy,
    sell,
    volume,
    delta: buy - sell,
    deltaPct: volume ? ((buy - sell) / volume) * 100 : 0,
    count: window.length,
    average: window.length ? volume / window.length : 0,
    largest,
    buyPct: volume ? (buy / volume) * 100 : 0,
    sellPct: volume ? (sell / volume) * 100 : 0,
  };
}
export function bookMetrics(m: MarketState) {
  const bid = m.book.bids[0]?.[0],
    ask = m.book.asks[0]?.[0];
  const comparable = comparableBook(m.book);
  return {
    spread: bid !== undefined && ask !== undefined ? ask - bid : undefined,
    imbalance: comparable ? (comparable.near + comparable.wide) / 2 : undefined,
    near: comparable?.near,
    wide: comparable?.wide,
  };
}
export function pressure(markets: MarketState[], seconds: number, now: number) {
  const live = markets.filter((m) => m.status === "live");
  const available = live.filter((m) => flow(m.trades, seconds, now).count > 0);
  if (!available.length) return null;
  const score =
    available.reduce((sum, m) => {
      const f = flow(m.trades, seconds, now);
      const book = bookMetrics(m).imbalance;
      return sum + (book === undefined ? f.deltaPct : f.deltaPct * 0.8 + book * 0.2);
    }, 0) / available.length;
  const strength = Math.abs(score),
    neutral = Math.max(0, 100 - strength);
  return {
    buy: Math.max(0, score),
    sell: Math.max(0, -score),
    neutral,
    strength,
    score,
    reading: score > 15 ? "COMPRA" : score < -15 ? "VENDA" : "NEUTRO",
    sources: available.length,
  };
}
export function movingAverage(candles: Candle[], period: number, exponential: boolean) {
  const result: { time: number; value: number }[] = [];
  let ema = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c || i < period - 1) continue;
    if (i === period - 1 || !exponential)
      ema = candles.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0) / period;
    else ema = c.close * (2 / (period + 1)) + ema * (1 - 2 / (period + 1));
    result.push({ time: c.time, value: ema });
  }
  return result;
}
export function hasConsensus(markets: MarketState[], seconds: number, now: number): boolean {
  const live = markets.filter((m) => m.status === "live"),
    score = pressure(markets, seconds, now);
  return (
    live.length === 3 &&
    score !== null &&
    score.strength >= 35 &&
    live.every(
      (m) =>
        now - m.started >= seconds * 1000 &&
        (score.score > 0
          ? flow(m.trades, seconds, now).deltaPct > 15
          : flow(m.trades, seconds, now).deltaPct < -15),
    )
  );
}
export function observations(markets: MarketState[], now: number): string[] {
  const result: string[] = [];
  const live = markets.filter((m) => m.status === "live");
  if (live.length !== 3)
    result.push(
      `${live.length}/3 fontes atualizadas. Confluência ${live.length < 2 ? "indisponível" : "parcial"}.`,
    );
  const signs: number[] = [];
  for (const m of live) {
    const f = flow(m.trades, 10, now),
      adaptive = adaptiveDelta(m, 10, now),
      prior = flow(
        m.trades.filter((t) => t.time <= now - 10000),
        30,
        now - 10000,
      );
    if (m.exchange === "bybit") {
      const previous = m.oiHistory.find((o) => o.time >= now - 60000),
        last = m.oiHistory.at(-1);
      if (
        previous &&
        last &&
        last.time - previous.time >= 10000 &&
        last.openInterest > previous.openInterest &&
        last.price !== previous.price
      )
        result.unshift(
          `BYBIT: OI sobe com preço ${last.price > previous.price ? "subindo" : "caindo"} na janela observada.`,
        );
    }
    if (!f.count) continue;
    signs.push(Math.sign(f.deltaPct));
    const response = priceResponse(m, 10, now, adaptive.strong, adaptive.delta),
      movement = response.movement;
    const name = m.exchange.toUpperCase();
    if (adaptive.active && adaptive.delta < 0 && movement > 0.02)
      result.push(`${name}: delta negativo com preço subindo; possível absorção de venda.`);
    if (adaptive.active && adaptive.delta > 0 && movement < -0.02)
      result.push(`${name}: delta positivo com preço caindo; possível absorção de compra.`);
    if (response.absorption && Math.abs(movement) < 0.01)
      result.push(`${name}: forte agressão sem deslocamento; possível absorção.`);
    if (now - m.started >= 40000 && prior.volume > 0 && f.volume > (prior.volume / 3) * 2.5)
      result.push(`${name}: volume 10s acima de 2,5× a média dos 30s anteriores.`);
    const persistent = persistentBook(m.bookHistory, now),
      imbalance = bookMetrics(m).imbalance;
    if (imbalance !== undefined && persistent.persistent && adaptive.strong)
      result.push(
        `${name}: livro persistente para ${imbalance > 0 ? "compra" : "venda"} (${Math.abs(imbalance).toFixed(0)}%; Δ10s ${persistent.change.toFixed(0)}pp).`,
      );
    const recent = m.candles.slice(-21, -1),
      candle = m.candles.at(-1);
    if (recent.length >= 20 && candle) {
      if (candle.close > Math.max(...recent.map((c) => c.high)))
        result.push(`${name}: preço rompe a máxima dos últimos 20 candles.`);
      if (candle.close < Math.min(...recent.map((c) => c.low)))
        result.push(`${name}: preço rompe a mínima dos últimos 20 candles.`);
    }
    const old = adaptiveDelta(m, 10, now - 10000);
    if (old.count && old.strong && !adaptive.active)
      result.push(`${name}: perda de força da agressão direcional.`);
  }
  if (signs.includes(1) && signs.includes(-1))
    result.unshift("Divergência de agressão entre exchanges na janela de 10s.");
  if (
    live.length >= 2 &&
    Math.max(...live.map((m) => m.lastMessage)) - Math.min(...live.map((m) => m.lastMessage)) > 5000
  )
    result.unshift("Fontes dessincronizadas: diferença de atualização superior a 5s.");
  if (!result.length)
    result.push(
      live.some((m) => m.trades.length)
        ? "Nenhuma divergência relevante detectada no fluxo atual."
        : "Aguardando negócios reais para leitura do fluxo.",
    );
  return result.slice(0, 5);
}
