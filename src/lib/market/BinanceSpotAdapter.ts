import { PublicSocket } from './socket';
import { arrayCandle, binanceTrade, levels, list, n, record } from './normalize';
export class BinanceSpotAdapter extends PublicSocket {
  start() {
    const symbol=this.symbol.toLowerCase();
    this.connect(`wss://stream.binance.com:443/stream?streams=${symbol}@trade/${symbol}@kline_${this.timeframe}m/${symbol}@depth20@1000ms/${symbol}@ticker`,()=>{},raw=> {
      const envelope=record(JSON.parse(raw)), d=record(envelope['data']), stream=String(envelope['stream']);
      if(stream.includes('@trade')) this.emit({trades:[binanceTrade(d)],ticker:{price:n(d['p'])}});
      else if(stream.includes('@kline')) { const k=record(d['k']); this.emit({candle:{time:Math.floor(n(k['t'])/1000),open:n(k['o']),high:n(k['h']),low:n(k['l']),close:n(k['c']),volume:n(k['v'])}}); }
      else if(stream.includes('@depth')) this.emit({book:{bids:levels(d['bids']),asks:levels(d['asks'])}});
      else if(stream.includes('@ticker')) this.emit({ticker:{price:n(d['c']),change:n(d['P']),high:n(d['h']),low:n(d['l']),volume:n(d['q'])}});
      else return false;
      return true;
    });
    void this.get(`https://api.binance.com/api/v3/klines?symbol=${this.symbol}&interval=${this.timeframe}m&limit=400`).then(d=>this.emit({history:list(d).map(arrayCandle),historyError:''})).catch(()=>this.historyFailed());
  }
}
