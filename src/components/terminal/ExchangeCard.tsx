import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { flow, bookMetrics } from '@/lib/market/flow';
import { NAMES, type MarketState } from '@/lib/market/types';
import { MarketChart } from './MarketChart';
export function number(value: number|undefined, digits=2) { return value === undefined || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value); }
export function compact(value: number|undefined) { return value===undefined || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(value); }
export function clock(time:number) { return time ? new Date(time).toLocaleTimeString('pt-BR',{hour12:false}) : '—'; }
export function Metric({label,value,tone=''}:{label:string;value:string;tone?:string}) { return <div className="min-w-0"><div className="metric-label">{label}</div><div className={`metric-value ${tone}`}>{value}</div></div>; }
export function ExchangeCard({market,now}:{market:MarketState;now:number}) {
  const f=flow(market.trades,10,now), book=bookMetrics(market), t=market.ticker;
  const live=market.status==='live', available=live && f.count>0;
  return <article className="exchange-card">
    <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2.5"><span className={`exchange-logo exchange-${market.exchange}`}>{market.exchange==='binance'?'◈':market.exchange==='bybit'?'B':'▦'}</span><h3 className="text-xs font-semibold">{NAMES[market.exchange]}</h3></div><span className={`flex items-center gap-1.5 font-mono text-[9px] ${live?'text-buy':market.status==='stale'?'text-neutral':'text-muted-foreground'}`} title={market.error || 'Última mensagem recebida da exchange'}><i className="status-dot" />{live?'LIVE':market.status==='connecting'?'CONECTANDO':market.status==='stale'?'ATRASADO':'OFFLINE'}</span></div>
    <div className="mt-3 flex items-end justify-between"><div className="font-mono text-2xl font-medium">{number(t.price,t.price && t.price<10?4:2)}<span className="ml-2 text-[9px] text-muted-foreground">USDT</span></div><div className={`flex items-center gap-1 font-mono text-xs ${(t.change??0)>=0?'text-buy':'text-sell'}`}>{t.change!==undefined && (t.change>=0?<ArrowUpRight size={13}/>:<ArrowDownRight size={13}/>)}{t.change===undefined?'—':`${t.change>=0?'+':''}${number(t.change)}%`}</div></div>
    <div className="metric-row mt-3"><Metric label="MÁXIMA 24H" value={number(t.high)}/><Metric label="MÍNIMA 24H" value={number(t.low)}/><Metric label="VOLUME 24H · USDT" value={compact(t.volume)}/></div>
    {market.exchange==='bybit' && <div className="mt-3 flex flex-wrap gap-5"><Metric label="INTERESSE ABERTO · QTD" value={compact(t.openInterest)}/><Metric label="FUNDING" value={t.fundingRate===undefined?'—':`${number(t.fundingRate*100,4)}%`}/></div>}
    <MarketChart candles={market.candles} mini/>
    <div className="metric-row border-t border-border pt-3"><Metric label="VOLUME 10s · USDT" value={available?compact(f.volume):'—'}/><Metric label="DELTA 10s · USDT" value={available?`${f.delta>=0?'+':''}${compact(f.delta)}`:'—'} tone={available?(f.delta>=0?'text-buy':'text-sell'):''}/><Metric label="NEGÓCIOS 10s" value={live?number(f.count,0):'—'}/></div>
    <div className="mt-3 flex justify-between font-mono text-[9px] text-muted-foreground"><span>SPREAD <span className="text-foreground">{number(book.spread,4)}</span></span><span>{clock(market.lastMessage)}</span></div>
    {market.error && !live && <div className="mt-2 text-[10px] text-neutral">{market.error}</div>}
  </article>;
}
