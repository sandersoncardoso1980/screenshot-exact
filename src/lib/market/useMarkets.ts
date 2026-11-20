import { useEffect, useRef, useState } from 'react';
import { BinanceSpotAdapter } from './BinanceSpotAdapter';
import { BybitLinearAdapter } from './BybitLinearAdapter';
import { OKXSpotAdapter } from './OKXSpotAdapter';
import { mergeCandles, validTrade } from './normalize';
import { EXCHANGES, emptyMarket, type Exchange, type MarketState, type MarketUpdate, type Timeframe } from './types';
export function useMarkets(symbol: string, timeframe: Timeframe, paused: boolean) {
  const [markets,setMarkets]=useState<MarketState[]>(()=>EXCHANGES.map(e=>emptyMarket(e)));
  const [now,setNow]=useState(0);
  const store=useRef<MarketState[]>([]), pause=useRef(paused); pause.current=paused;
  useEffect(()=> {
    let active=true;
    store.current=EXCHANGES.map(e=>emptyMarket(e,Date.now()));
    setMarkets(store.current); setNow(Date.now());
    const seen=new Map<Exchange,Map<string,number>>(EXCHANGES.map(e=>[e,new Map()]));
    const emit=(exchange: Exchange)=>(u: MarketUpdate)=> {
      if(!active) return;
      const m=store.current.find(m=>m.exchange===exchange); if(!m) return;
      if(u.status) m.status=u.status;
      if(u.lastMessage) m.lastMessage=u.lastMessage;
      if(u.error!==undefined) m.error=u.error;
      if(u.historyError!==undefined) m.historyError=u.historyError;
      if(u.ticker) for(const [key,value] of Object.entries(u.ticker)) { if(typeof value==='number' && Number.isFinite(value)) m.ticker={...m.ticker,[key]:value}; }
      if(u.book) m.book=u.book;
      const ids=seen.get(exchange), time=Date.now();
      if(u.trades && ids) for(const trade of u.trades) { if(validTrade(trade) && trade.time>time-60000 && trade.time<=time+2000 && !ids.has(trade.id)) { ids.set(trade.id,trade.time); m.trades.push(trade); } }
      if(u.history) m.candles=mergeCandles(u.history,m.candles);
      if(u.candle) m.candles=mergeCandles(m.candles,[u.candle]);
    };
    const adapters=[new BinanceSpotAdapter(symbol,timeframe,emit('binance')),new BybitLinearAdapter(symbol,timeframe,emit('bybit')),new OKXSpotAdapter(symbol,timeframe,emit('okx'))];
    adapters.forEach(a=>a.start());
    const interval=setInterval(()=> { const time=Date.now(); for(const m of store.current) { m.trades=m.trades.filter(t=>t.time>time-60000).sort((a,b)=>a.time-b.time); const ids=seen.get(m.exchange); if(ids) for(const [id,t] of ids) if(t<=time-60000) ids.delete(id); if((m.status==='live' || m.status==='stale') && m.lastMessage) m.status=time-m.lastMessage>15000?'stale':'live'; }
      if(!pause.current) { setMarkets(store.current.map(m=>({...m,trades:[...m.trades],candles:[...m.candles],ticker:{...m.ticker}}))); setNow(time); }
    },500);
    return ()=> { active=false; clearInterval(interval); adapters.forEach(a=>a.stop()); };
  },[symbol,timeframe]);
  return {markets,now};
}
