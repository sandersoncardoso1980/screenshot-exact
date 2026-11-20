import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/lib/market/types';
import { movingAverage } from '@/lib/market/flow';

function palette() {
  const css=getComputedStyle(document.documentElement), canvas=document.createElement('canvas'); canvas.width=1; canvas.height=1;
  const context=canvas.getContext('2d');
  const color=(name:string)=> { const value=css.getPropertyValue(name).trim(); if(!context) return value; context.clearRect(0,0,1,1); context.fillStyle=value; context.fillRect(0,0,1,1); const pixel=context.getImageData(0,0,1,1).data; return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`; };
  return {background:color('--background'),card:color('--card'),foreground:color('--muted-foreground'),grid:color('--border'),buy:color('--buy'),sell:color('--sell'),fast:color('--ema-fast'),medium:color('--ema-medium'),slow:color('--ema-slow'),long:color('--sma-long')};
}
export function MarketChart({candles,mini=false,indicators=true}: {candles:Candle[];mini?:boolean;indicators?:boolean}) {
  const host=useRef<HTMLDivElement>(null), chartRef=useRef<IChartApi|null>(null);
  const series=useRef<{price:ISeriesApi<'Candlestick'>|ISeriesApi<'Line'>;volume:ISeriesApi<'Histogram'>;averages:ISeriesApi<'Line'>[]}|null>(null);
  const colors=useRef<ReturnType<typeof palette>|null>(null), initialized=useRef(false);
  const previous=useRef({length:0,first:0,last:0});
  const [ready,setReady]=useState(false);
  useEffect(()=> {
    let disposed=false; let observer:ResizeObserver|undefined;
    void import('lightweight-charts').then(lib=> {
      if(disposed || !host.current) return;
      const p=palette(); colors.current=p;
      const chart=lib.createChart(host.current,{autoSize:true,layout:{background:{type:lib.ColorType.Solid,color:mini?p.card:p.background},textColor:p.foreground,fontFamily:'IBM Plex Mono',fontSize:10,attributionLogo:!mini},grid:{vertLines:{visible:!mini,color:p.grid},horzLines:{visible:!mini,color:p.grid}},rightPriceScale:{visible:!mini,borderVisible:false},timeScale:{visible:!mini,borderVisible:false,timeVisible:true,secondsVisible:false},crosshair:{mode:lib.CrosshairMode.Normal,vertLine:{visible:!mini,labelVisible:!mini},horzLine:{visible:!mini,labelVisible:!mini}},handleScroll:!mini,handleScale:!mini});
      chartRef.current=chart;
      const price=mini ? chart.addSeries(lib.LineSeries,{color:p.buy,lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false}) : chart.addSeries(lib.CandlestickSeries,{upColor:p.buy,downColor:p.sell,borderVisible:false,wickUpColor:p.buy,wickDownColor:p.sell,priceFormat:{type:'price',precision:4,minMove:0.0001}});
      const volume=chart.addSeries(lib.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:mini?'volume':'right',lastValueVisible:false,priceLineVisible:false},mini?0:1);
      if(mini) volume.priceScale().applyOptions({scaleMargins:{top:0.75,bottom:0}}); else { const pane=chart.panes()[1]; pane?.setHeight(75); }
      const averages=mini?[]:[p.fast,p.medium,p.slow,p.long].map(color=>chart.addSeries(lib.LineSeries,{color,lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false}));
      series.current={price,volume,averages}; initialized.current=false; previous.current={length:0,first:0,last:0};
      observer=new ResizeObserver(()=> { if(host.current) chart.resize(host.current.clientWidth,host.current.clientHeight); }); observer.observe(host.current);
      setReady(true);
    });
    return ()=> { disposed=true; observer?.disconnect(); chartRef.current?.remove(); chartRef.current=null; series.current=null; };
  },[mini]);
  useEffect(()=> {
    const s=series.current, chart=chartRef.current,p=colors.current; if(!s || !chart || !p || !candles.length) return;
    const data=mini?candles.slice(-50):candles;
    const priceData=data.map(c=>mini?{time:c.time as UTCTimestamp,value:c.close}:{time:c.time as UTCTimestamp,open:c.open,high:c.high,low:c.low,close:c.close});
    const last=data.at(-1), first=data[0]; if(!last || !first) return;
    const incremental=initialized.current && previous.current.first===first.time && (data.length===previous.current.length || data.length===previous.current.length+1) && last.time>=previous.current.last;
    const tail=priceData.at(-1);
    if(incremental && tail) s.price.update(tail); else s.price.setData(priceData);
    const volumeData=data.map(c=>({time:c.time as UTCTimestamp,value:c.volume,color:c.close>=c.open?p.buy:p.sell})), lastVolume=volumeData.at(-1);
    if(incremental && lastVolume) s.volume.update(lastVolume); else s.volume.setData(volumeData);
    [9,20,50,200].forEach((period,i)=> { const line=s.averages[i]; if(line) { line.applyOptions({visible:indicators}); const points=movingAverage(data,period,i!==3).map(c=>({...c,time:c.time as UTCTimestamp})), tail=points.at(-1); if(incremental && tail) line.update(tail); else line.setData(points); } });
    previous.current={length:data.length,first:first.time,last:last.time};
    if(!initialized.current) { chart.timeScale().fitContent(); if(!mini && data.length>100) chart.timeScale().setVisibleLogicalRange({from:data.length-85,to:data.length+3}); initialized.current=true; }
  },[candles,mini,ready,indicators]);
  return <div className={mini?'mini-chart':'main-chart'}><div ref={host} className="h-full w-full" />{!candles.length && <div className="chart-empty">Aguardando candles da exchange…</div>}</div>;
}
