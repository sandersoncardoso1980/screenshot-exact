import { describe, it, expect } from 'vitest';
import { flow, movingAverage, pressure, hasConsensus } from './flow';
import { binanceTrade, bybitTrade, okxTrade, mergeCandles, updateBook } from './normalize';
import { emptyMarket, type Trade } from './types';
const now=100000;
const trade=(time:number,side:'buy'|'sell'='buy',price=2000,quantity=2):Trade=>({id:String(time),time,price,quantity,side});
describe('real financial order flow',()=> {
  it('uses price × quantity in USDT and buyer minus seller',()=> { const f=flow([trade(99000),trade(99001,'sell',2000,1)],10,now); expect(f.buy).toBe(4000); expect(f.sell).toBe(2000); expect(f.delta).toBe(2000); expect(f.volume).toBe(6000); expect(f.deltaPct).toBeCloseTo(33.3333); expect(f.average).toBe(3000); expect(f.largest).toBe(4000); });
  for(const seconds of [10,30,60]) it(`expires trades at ${seconds} seconds and excludes future trades`,()=> { expect(flow([trade(now-seconds*1000),trade(now-seconds*1000+1),trade(now+1)],seconds,now).count).toBe(1); });
  it('interprets Binance buyer maker as sell aggression',()=> { expect(binanceTrade({t:1,T:now,p:'2000',q:'2',m:true}).side).toBe('sell'); expect(binanceTrade({t:2,T:now,p:'2000',q:'2',m:false}).side).toBe('buy'); });
  it('interprets Bybit Buy as buyer aggression',()=> { expect(bybitTrade({i:'1',T:now,p:'2000',v:'2',S:'Buy'}).side).toBe('buy'); expect(bybitTrade({i:'2',T:now,p:'2000',v:'2',S:'Sell'}).side).toBe('sell'); });
  it('interprets OKX side as taker side',()=> { expect(okxTrade({tradeId:'1',ts:now,px:'2000',sz:'2',side:'buy'}).side).toBe('buy'); expect(okxTrade({tradeId:'2',ts:now,px:'2000',sz:'2',side:'sell'}).side).toBe('sell'); });
  it('does not fabricate pressure without actual trades',()=> { const m=emptyMarket('binance'); m.status='live'; expect(pressure([m],10,now)).toBeNull(); });
  it('normalizes pressure to 100 and excludes offline sources',()=> { const m=emptyMarket('binance'); m.status='live'; m.trades=[trade(99000)]; const offline=emptyMarket('okx'); offline.trades=[trade(99000,'sell')]; const p=pressure([m,offline],10,now); expect(p?.buy).toBe(100); expect(p?.sources).toBe(1); expect((p?.buy??0)+(p?.sell??0)+(p?.neutral??0)).toBe(100); });
  it('requires 200 real candles for SMA 200',()=> { const candles=Array.from({length:200},(_,i)=>({time:i,open:i+1,close:i+1,high:i+1,low:i+1,volume:1})); expect(movingAverage(candles.slice(0,199),200,false)).toHaveLength(0); expect(movingAverage(candles,200,false)[0]?.value).toBe(100.5); });
  it('requires all three live exchanges to agree before emitting directional confluence',()=> { const markets=([ 'binance','bybit','okx'] as const).map(e=>({...emptyMarket(e),status:'live' as const,trades:[trade(99000)]})); expect(hasConsensus(markets,10,now)).toBe(true); const last=markets[2]; if(last) last.trades=[trade(99000,'sell')]; expect(hasConsensus(markets,10,now)).toBe(false); expect(hasConsensus(markets.slice(0,2),10,now)).toBe(false); });
  it('merges historical and current candles without duplicate timestamps',()=> { const c={time:1,open:1,high:2,low:1,close:1,volume:1}; expect(mergeCandles([c],[{...c,close:2}])).toEqual([{...c,close:2}]); });
  it('applies Bybit incremental order book deletions and resets snapshots',()=> { const old={bids:[[100,2]] as [number,number][],asks:[[101,3]] as [number,number][]}; expect(updateBook(old,{b:[['100','0'],['99','4']],a:[]},false).bids).toEqual([[99,4]]); expect(updateBook(old,{b:[['98','1']],a:[]},true)).toEqual({bids:[[98,1]],asks:[]}); });
});
