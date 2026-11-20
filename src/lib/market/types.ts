export type Exchange = 'binance' | 'bybit' | 'okx';
export type Timeframe = '1' | '5';
export type Connection = 'connecting' | 'live' | 'stale' | 'offline';
export interface Trade { id: string; time: number; price: number; quantity: number; side: 'buy' | 'sell' }
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface Ticker { price?: number; change?: number; high?: number; low?: number; volume?: number }
export interface Book { bids: [number, number][]; asks: [number, number][] }
export interface MarketState { exchange: Exchange; status: Connection; lastMessage: number; ticker: Ticker; book: Book; trades: Trade[]; candles: Candle[]; historyError: string; error: string; started: number }
export interface MarketUpdate { trades?: Trade[]; candle?: Candle; history?: Candle[]; ticker?: Ticker; book?: Book; status?: Connection; lastMessage?: number; error?: string; historyError?: string }
export type UpdateHandler = (update: MarketUpdate) => void;
export const EXCHANGES: Exchange[] = ['binance', 'bybit', 'okx'];
export const NAMES: Record<Exchange, string> = { binance: 'BINANCE SPOT', bybit: 'BYBIT LINEAR', okx: 'OKX SPOT' };
export const ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
export function emptyMarket(exchange: Exchange, started = 0): MarketState { return { exchange, started, status: 'connecting', lastMessage: 0, ticker: {}, book: { bids: [], asks: [] }, trades: [], candles: [], error: '', historyError: '' }; }
