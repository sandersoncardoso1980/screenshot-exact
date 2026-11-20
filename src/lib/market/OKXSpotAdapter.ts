import { PublicSocket } from './socket';
import { arrayCandle, levels, list, n, okxTrade, record } from './normalize';
export class OKXSpotAdapter extends PublicSocket {
  start() {
    const instId=this.symbol.replace('USDT','-USDT');
    this.connect('wss://ws.okx.com/ws/v5/public',ws=>ws.send(JSON.stringify({op:'subscribe',args:['trades','books5','tickers'].map(channel=>({channel,instId}))})),raw=> {
      if(raw==='pong') return false;
      const d=record(JSON.parse(raw)); if(d['event']==='error') { this.emit({error:String(d['msg'])}); return false; }
      const channel=record(d['arg'])['channel'];
      for(const item of list(d['data'])) {
        const t=record(item);
        if(channel==='trades') { const trade=okxTrade(t); this.emit({trades:[trade],ticker:{price:trade.price}}); }
        else if(channel==='books5') this.emit({book:{bids:levels(t['bids']),asks:levels(t['asks'])}});
        else if(channel==='tickers') { const price=n(t['last']), open=n(t['open24h']); this.emit({ticker:{price,...(open>0?{change:(price-open)/open*100}:{}),high:n(t['high24h']),low:n(t['low24h']),volume:n(t['volCcy24h'])}}); }
      }
      return list(d['data']).length>0;
    },ws=>ws.send('ping'));
    this.connect('wss://ws.okx.com/ws/v5/business',ws=>ws.send(JSON.stringify({op:'subscribe',args:[{channel:`candle${this.timeframe}m`,instId}]})),raw=> {
      if(raw==='pong') return false;
      const d=record(JSON.parse(raw)); for(const row of list(d['data'])) this.emit({candle:arrayCandle(row)});
      return list(d['data']).length>0;
    },ws=>ws.send('ping'),false);
    void this.get(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${this.timeframe}m&limit=300`).then(d=> { const root=record(d); if(root['code']!=='0') throw new Error('Histórico recusado'); this.emit({history:list(root['data']).map(arrayCandle),historyError:''}); }).catch(()=>this.historyFailed());
  }
}
