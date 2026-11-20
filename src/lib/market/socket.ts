import type { UpdateHandler } from './types';
export abstract class PublicSocket {
  protected stopped = false;
  protected abort = new AbortController();
  private sockets = new Set<WebSocket>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(protected symbol: string, protected timeframe: '1'|'5', protected emit: UpdateHandler) {}
  abstract start(): void;
  protected connect(url: string, subscribe: (ws: WebSocket)=>void, receive: (raw: string)=>boolean, heartbeat?: (ws: WebSocket)=>void, report=true) {
    let attempts=0;
    const open=()=> {
      if (this.stopped) return;
      if (report) this.emit({status:'connecting'});
      const ws=new WebSocket(url); this.sockets.add(ws);
      let lastReceived=Date.now();
      const scheduleTick=()=> { const timer=setTimeout(()=> {this.timers.delete(timer); tick();},15000); this.timers.add(timer); };
      const tick=()=> { if (this.stopped || ws.readyState!==WebSocket.OPEN) return; if (Date.now()-lastReceived>45000) { ws.close(); return; } heartbeat?.(ws); scheduleTick(); };
      ws.onopen=()=> { attempts=0; lastReceived=Date.now(); subscribe(ws); scheduleTick(); };
      ws.onmessage=e=> { lastReceived=Date.now(); try { if(receive(String(e.data)) && report) this.emit({status:'live',lastMessage:Date.now(),error:''}); } catch { if(report) this.emit({error:'Mensagem inválida da fonte.'}); } };
      ws.onerror=()=> { if(report) this.emit({error:'Conexão indisponível; verificando acesso à exchange.'}); ws.close(); };
      ws.onclose=()=> { this.sockets.delete(ws); if(this.stopped) return; if(report) this.emit({status:'offline'}); const timer=setTimeout(()=> { this.timers.delete(timer); open(); }, Math.min(30000,1000*2**Math.min(attempts++,5))); this.timers.add(timer); };
    }; open();
  }
  protected async get(url: string): Promise<unknown> { const response=await fetch(url,{signal:this.abort.signal}); if(!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
  protected historyFailed() { if(!this.stopped) this.emit({historyError:'Histórico indisponível nesta rede. Candles ao vivo continuam sendo recebidos.'}); }
  stop() { this.stopped=true; this.abort.abort(); for(const timer of this.timers) clearTimeout(timer); for(const ws of this.sockets) { ws.onclose=null; ws.close(); } this.sockets.clear(); this.timers.clear(); }
}
