import WebSocket from 'ws';
import Redis from 'ioredis';
import { createClient as createClickHouseClient } from '@clickhouse/client';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import Fastify from 'fastify';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
const clickhouse = createClickHouseClient({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DB || 'btc'
});
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const fastify = Fastify({ logger: false });
const state = {
  startedAt: new Date().toISOString(),
  sockets: {},
  venue: {},
  lastComposite: null,
  lastRedisStateAt: null,
  lastClickhouseFlushAt: null,
  lastSupabaseAt: null,
  errors: []
};

const tradeBuffer = [];
const bookBuffer = [];
let flushInFlight = false;
const MAX_BUFFER = Number(process.env.MAX_BUFFER || 100000);
const SUPABASE_INTERVAL_MS = Number(process.env.SUPABASE_INTERVAL_MS || 60000);
const STATE_INTERVAL_MS = Number(process.env.STATE_INTERVAL_MS || 1000);
const REST_POLL_MS = Number(process.env.REST_POLL_MS || 5000);

function nowMs(){ return Date.now(); }
function minuteBucket(ms=Date.now()){ return Math.floor(ms/60000)*60000; }
function num(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function clamp(v,a=0,b=100){ return Math.max(a,Math.min(b,v)); }
function addError(err, context){
  const item={at:new Date().toISOString(),context,error:String(err)};
  state.errors.push(item); if(state.errors.length>50) state.errors.shift();
  log.warn(item);
}
function socketHealth(name, patch){ state.sockets[name]={...(state.sockets[name]||{}),...patch}; }

async function redisFlow(trade){
  const bucket=minuteBucket(trade.event_time_ms);
  const sideSign=trade.side==='buy'?1:-1;
  const notional=trade.notional_usd;
  const keys=[
    `btc:flow:${trade.venue}:${trade.market_type}:${bucket}`,
    `btc:flow:agg:${trade.market_type}:${bucket}`
  ];
  const p=redis.pipeline();
  for(const key of keys){
    p.hincrbyfloat(key, trade.side==='buy'?'buy_usd':'sell_usd', notional);
    p.hincrbyfloat(key, 'delta_usd', sideSign*notional);
    p.hincrby(key, 'trades', 1);
    p.expire(key, 172800);
  }
  p.set(`btc:last_trade:${trade.venue}:${trade.market_type}`, JSON.stringify(trade), 'EX', 120);
  await p.exec();
}

function pushTrade({venue,market_type,symbol,price,qty,side,event_time_ms,trade_id=null}){
  if(!price||!qty||!event_time_ms) return;
  const row={
    event_time:new Date(event_time_ms).toISOString(),
    ingested_at:new Date().toISOString(),
    event_time_ms,
    venue,market_type,symbol,
    price:Number(price),qty:Number(qty),notional_usd:Number(price)*Number(qty),side,trade_id:String(trade_id??''),
  };
  tradeBuffer.push(row); if(tradeBuffer.length>MAX_BUFFER) tradeBuffer.splice(0,tradeBuffer.length-MAX_BUFFER);
  redisFlow(row).catch(e=>addError(e,'redisFlow'));
}

function pushBook({venue,market_type,symbol,event_time_ms,bids,asks,sequence=null}){
  if(!event_time_ms||!Array.isArray(bids)||!Array.isArray(asks)) return;
  const bestBid=num(bids?.[0]?.[0]), bestAsk=num(asks?.[0]?.[0]);
  const mid=bestBid&&bestAsk?(bestBid+bestAsk)/2:null;
  const spread_bps=mid&&bestBid&&bestAsk?((bestAsk-bestBid)/mid)*10000:null;
  const row={
    event_time:new Date(event_time_ms).toISOString(),ingested_at:new Date().toISOString(),event_time_ms,
    venue,market_type,symbol,sequence:String(sequence??''),
    bid_prices:bids.slice(0,50).map(x=>Number(x[0])),bid_sizes:bids.slice(0,50).map(x=>Number(x[1])),
    ask_prices:asks.slice(0,50).map(x=>Number(x[0])),ask_sizes:asks.slice(0,50).map(x=>Number(x[1])),
    best_bid:bestBid,best_ask:bestAsk,spread_bps
  };
  bookBuffer.push(row); if(bookBuffer.length>MAX_BUFFER) bookBuffer.splice(0,bookBuffer.length-MAX_BUFFER);
  redis.set(`btc:book:${venue}:${market_type}`,JSON.stringify(row),'EX',30).catch(e=>addError(e,'redisBook'));
}

async function flushClickHouse(){
  if(flushInFlight) return;
  if(!tradeBuffer.length&&!bookBuffer.length) return;
  flushInFlight=true;
  const trades=tradeBuffer.splice(0, Math.min(tradeBuffer.length, 20000));
  const books=bookBuffer.splice(0, Math.min(bookBuffer.length, 5000));
  try{
    if(trades.length) await clickhouse.insert({table:'raw_trades',values:trades,format:'JSONEachRow'});
    if(books.length) await clickhouse.insert({table:'orderbook_snapshots',values:books,format:'JSONEachRow'});
    state.lastClickhouseFlushAt=new Date().toISOString();
  }catch(e){
    tradeBuffer.unshift(...trades); bookBuffer.unshift(...books); addError(e,'clickhouseFlush');
  }finally{flushInFlight=false;}
}

function connectSocket(name,url,onOpen,onMessage){
  let ws,closed=false,attempt=0,pingTimer,watchdog;
  const start=()=>{
    if(closed)return;
    attempt++; socketHealth(name,{status:'CONNECTING',attempt,url});
    ws=new WebSocket(url);
    ws.on('open',()=>{
      attempt=0; socketHealth(name,{status:'LIVE',connected_at:new Date().toISOString(),last_message_at:null});
      try{onOpen?.(ws)}catch(e){addError(e,`${name}:open`)}
      pingTimer=setInterval(()=>{try{if(ws.readyState===WebSocket.OPEN)ws.ping()}catch{}},20000);
      watchdog=setInterval(()=>{
        const h=state.sockets[name]; const t=h?.last_message_at?Date.parse(h.last_message_at):0;
        if(t&&Date.now()-t>30000){socketHealth(name,{status:'STALE'});try{ws.terminate()}catch{}}
      },10000);
    });
    ws.on('message',(buf)=>{socketHealth(name,{status:'LIVE',last_message_at:new Date().toISOString()});try{onMessage(JSON.parse(buf.toString()),ws)}catch(e){addError(e,`${name}:message`)}});
    ws.on('error',(e)=>{addError(e,`${name}:socket`)});
    ws.on('close',()=>{clearInterval(pingTimer);clearInterval(watchdog);socketHealth(name,{status:'DISCONNECTED',disconnected_at:new Date().toISOString()});setTimeout(start,Math.min(30000,1000*Math.pow(2,Math.min(attempt,5))))});
  };
  start();
  return ()=>{closed=true;clearInterval(pingTimer);clearInterval(watchdog);try{ws?.close()}catch{}};
}

// Binance spot trades + top-20 depth.
connectSocket('binance_spot_trade','wss://stream.binance.com:9443/ws/btcusdt@aggTrade',null,(m)=>{
  pushTrade({venue:'Binance',market_type:'spot',symbol:'BTCUSDT',price:m.p,qty:m.q,side:m.m?'sell':'buy',event_time_ms:Number(m.T),trade_id:m.a});
});
connectSocket('binance_spot_book','wss://stream.binance.com:9443/ws/btcusdt@depth20@100ms',null,(m)=>{
  pushBook({venue:'Binance',market_type:'spot',symbol:'BTCUSDT',event_time_ms:Number(m.E||Date.now()),bids:m.bids||m.b||[],asks:m.asks||m.a||[],sequence:m.lastUpdateId});
});

// Binance USDT perpetual.
connectSocket('binance_perp_trade','wss://fstream.binance.com/ws/btcusdt@aggTrade',null,(m)=>{
  pushTrade({venue:'Binance',market_type:'perp',symbol:'BTCUSDT-PERP',price:m.p,qty:m.q,side:m.m?'sell':'buy',event_time_ms:Number(m.T),trade_id:m.a});
});
connectSocket('binance_perp_book','wss://fstream.binance.com/ws/btcusdt@depth20@100ms',null,(m)=>{
  pushBook({venue:'Binance',market_type:'perp',symbol:'BTCUSDT-PERP',event_time_ms:Number(m.E||Date.now()),bids:m.b||[],asks:m.a||[],sequence:m.u});
});

function bybitSocket(category,marketType){
  const name=`bybit_${marketType}`;
  connectSocket(name,`wss://stream.bybit.com/v5/public/${category}`,(ws)=>{
    ws.send(JSON.stringify({op:'subscribe',args:['publicTrade.BTCUSDT','orderbook.50.BTCUSDT']}));
  },(m)=>{
    if(m.topic==='publicTrade.BTCUSDT') for(const t of m.data||[]) pushTrade({venue:'Bybit',market_type:marketType,symbol:marketType==='spot'?'BTCUSDT':'BTCUSDT-PERP',price:t.p,qty:t.v,side:String(t.S).toLowerCase()==='buy'?'buy':'sell',event_time_ms:Number(t.T||m.ts),trade_id:t.i});
    if(m.topic==='orderbook.50.BTCUSDT') pushBook({venue:'Bybit',market_type:marketType,symbol:marketType==='spot'?'BTCUSDT':'BTCUSDT-PERP',event_time_ms:Number(m.ts||Date.now()),bids:m.data?.b||[],asks:m.data?.a||[],sequence:m.data?.u});
  });
}
bybitSocket('spot','spot'); bybitSocket('linear','perp');

function okxSocket(instId,marketType){
  const name=`okx_${marketType}`;
  connectSocket(name,'wss://ws.okx.com:8443/ws/v5/public',(ws)=>{
    ws.send(JSON.stringify({op:'subscribe',args:[{channel:'trades',instId},{channel:'books5',instId}]}));
  },(m)=>{
    if(m.arg?.channel==='trades') for(const t of m.data||[]) pushTrade({venue:'OKX',market_type:marketType,symbol:instId,price:t.px,qty:marketType==='spot'?t.sz:null,side:t.side,event_time_ms:Number(t.ts),trade_id:t.tradeId});
    if(m.arg?.channel==='books5') for(const b of m.data||[]) pushBook({venue:'OKX',market_type:marketType,symbol:instId,event_time_ms:Number(b.ts||Date.now()),bids:b.bids||[],asks:b.asks||[],sequence:b.seqId});
  });
}
okxSocket('BTC-USDT','spot');
// For OKX swaps, contract-size conversion is required before using trades in USD CVD. We still persist order-book state, but intentionally do not push swap trades into CVD until ctVal is loaded.
connectSocket('okx_perp','wss://ws.okx.com:8443/ws/v5/public',(ws)=>ws.send(JSON.stringify({op:'subscribe',args:[{channel:'books5',instId:'BTC-USDT-SWAP'}]})),(m)=>{
  if(m.arg?.channel==='books5') for(const b of m.data||[]) pushBook({venue:'OKX',market_type:'perp',symbol:'BTC-USDT-SWAP',event_time_ms:Number(b.ts||Date.now()),bids:b.bids||[],asks:b.asks||[],sequence:b.seqId});
});

async function fetchJson(url){const r=await fetch(url,{headers:{accept:'application/json'}});if(!r.ok)throw new Error(`${r.status} ${url}`);return await r.json();}
async function pollDerivatives(){
  const out={};
  try{
    const [bp,bo,bt,yo,yt,oo,of]=await Promise.all([
      fetchJson('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
      fetchJson('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'),
      fetchJson('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT'),
      fetchJson('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT'),
      fetchJson('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT'),
      fetchJson('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'),
      fetchJson('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP')
    ]);
    const by=yo.result?.list?.[0], bs=yt.result?.list?.[0], okxOi=oo.data?.[0], okxF=of.data?.[0];
    out.Binance={price:num(bt.price),oi_usd:num(bo.openInterest)*num(bt.price),funding:num(bp.lastFundingRate),source_event_at:Number(bp.time||Date.now())};
    out.Bybit={price:num(by?.lastPrice),oi_usd:num(by?.openInterestValue)??(num(by?.openInterest)*num(by?.lastPrice)),funding:num(by?.fundingRate),spot_price:num(bs?.lastPrice),source_event_at:Date.now()};
    out.OKX={price:num(okxF?.markPx),oi_usd:num(okxOi?.oiUsd),funding:num(okxF?.fundingRate),source_event_at:Number(okxF?.ts||Date.now())};
    const pipe=redis.pipeline();
    for(const [venue,v] of Object.entries(out)){pipe.set(`btc:derivatives:${venue}`,JSON.stringify(v),'EX',30);}
    pipe.set('btc:derivatives:all',JSON.stringify(out),'EX',30); await pipe.exec();
  }catch(e){addError(e,'pollDerivatives')}
}

async function flowWindow(type,mins){
  const end=minuteBucket(); const p=redis.pipeline();
  for(let i=0;i<mins;i++) p.hgetall(`btc:flow:agg:${type}:${end-i*60000}`);
  const rs=await p.exec(); let buy=0,sell=0,delta=0,trades=0;
  for(const [err,v] of rs){if(err||!v)continue;buy+=Number(v.buy_usd||0);sell+=Number(v.sell_usd||0);delta+=Number(v.delta_usd||0);trades+=Number(v.trades||0)}
  return {buy_usd:buy,sell_usd:sell,delta_usd:delta,trades};
}
async function allBooks(){
  const keys=await redis.keys('btc:book:*'); if(!keys.length)return [];
  const vals=await redis.mget(keys);return vals.map(v=>{try{return JSON.parse(v)}catch{return null}}).filter(Boolean);
}
async function computeComposite(){
  const books=(await allBooks()).filter(x=>x.market_type==='spot'&&x.best_bid&&x.best_ask);
  const mids=books.map(x=>({venue:x.venue,mid:(x.best_bid+x.best_ask)/2,spread_bps:x.spread_bps}));
  if(!mids.length)return null;
  const sorted=mids.map(x=>x.mid).sort((a,b)=>a-b), med=sorted[Math.floor(sorted.length/2)];
  const valid=mids.filter(x=>Math.abs(x.mid-med)/med<0.005); let nume=0,den=0;
  for(const x of valid){const w=1/Math.max(Number(x.spread_bps||2),0.1);nume+=x.mid*w;den+=w;}
  const price=nume/den; const dispersion_bps=valid.length>1?((Math.max(...valid.map(x=>x.mid))-Math.min(...valid.map(x=>x.mid)))/price)*10000:0;
  return {price,venue_count:valid.length,dispersion_bps,venues:valid};
}
async function buildState(){
  const [spot1,spot5,spot15,spot60,perp1,perp5,perp15,perp60,derivs,comp]=await Promise.all([
    flowWindow('spot',1),flowWindow('spot',5),flowWindow('spot',15),flowWindow('spot',60),
    flowWindow('perp',1),flowWindow('perp',5),flowWindow('perp',15),flowWindow('perp',60),
    redis.get('btc:derivatives:all').then(x=>x?JSON.parse(x):{}),computeComposite()
  ]);
  if(!comp)return null;
  const perps=Object.values(derivs||{}).filter(v=>num(v?.oi_usd)&&num(v?.funding));
  const totalOi=perps.reduce((a,v)=>a+Number(v.oi_usd),0);
  const fundOi=totalOi?perps.reduce((a,v)=>a+Number(v.funding)*Number(v.oi_usd),0)/totalOi:null;
  const priorRaw=await redis.get('btc:state'); let prior=null; try{prior=priorRaw?JSON.parse(priorRaw):null}catch{}
  const dt=prior?.observed_at?Date.now()-Date.parse(prior.observed_at):null;
  const oiDeltaPct=prior?.open_interest_usd&&dt&&dt<10000?((totalOi-prior.open_interest_usd)/prior.open_interest_usd)*100:null;
  const priceDeltaPct=prior?.price&&dt&&dt<10000?((comp.price-prior.price)/prior.price)*100:null;
  let driver='UNCLEAR',confidence=45;
  if(priceDeltaPct!==null){const ps=Math.sign(priceDeltaPct),ss=Math.sign(spot5.delta_usd),pps=Math.sign(perp5.delta_usd);
    if(ss===ps&&Math.abs(spot5.delta_usd)>Math.max(Math.abs(perp5.delta_usd)*1.35,5e6)){driver='SPOT_LED';confidence=68;}
    else if(pps===ps&&Math.abs(perp5.delta_usd)>Math.max(Math.abs(spot5.delta_usd)*1.35,5e6)&&Math.abs(oiDeltaPct||0)>0.01){driver='LEVERAGE_LED';confidence=72;}
    else if(ss||pps){driver='MIXED';confidence=58;}
  }
  const health=Object.values(state.sockets); const live=health.filter(x=>x.status==='LIVE').length; const quality=clamp(50+live*5-health.filter(x=>x.status==='STALE'||x.status==='DISCONNECTED').length*7,20,98);
  return {observed_at:new Date().toISOString(),price:comp.price,venue_count:comp.venue_count,venue_dispersion_bps:comp.dispersion_bps,spot:{m1:spot1,m5:spot5,m15:spot15,m60:spot60},perp:{m1:perp1,m5:perp5,m15:perp15,m60:perp60},open_interest_usd:totalOi,funding_oi_weighted:fundOi,oi_delta_pct_1s:oiDeltaPct,driver_classification:driver,driver_confidence:confidence,data_quality:quality,sockets:state.sockets,derivatives:derivs};
}

async function publishState(){
  try{const s=await buildState();if(!s)return;state.lastComposite=s.price;state.lastRedisStateAt=s.observed_at;await redis.set('btc:state',JSON.stringify(s),'EX',10);await redis.publish('btc:state:updates',JSON.stringify(s));}catch(e){addError(e,'publishState')}
}
async function persistSupabase(){
  if(!supabase)return;
  try{const sRaw=await redis.get('btc:state');if(!sRaw)return;const s=JSON.parse(sRaw);
    const row={observed_at:s.observed_at,composite_price_usd:s.price,composite_method:'persistent WebSocket collector spread-weighted spot composite',venue_count:s.venue_count,venue_dispersion_bps:s.venue_dispersion_bps,spot_cvd_usd_1m:s.spot.m1.delta_usd,spot_cvd_usd_5m:s.spot.m5.delta_usd,spot_cvd_usd_15m:s.spot.m15.delta_usd,spot_cvd_usd_1h:s.spot.m60.delta_usd,perp_cvd_usd_1m:s.perp.m1.delta_usd,perp_cvd_usd_5m:s.perp.m5.delta_usd,perp_cvd_usd_15m:s.perp.m15.delta_usd,perp_cvd_usd_1h:s.perp.m60.delta_usd,spot_perp_cvd_divergence_5m:s.spot.m5.delta_usd-s.perp.m5.delta_usd,open_interest_usd:s.open_interest_usd,funding_oi_weighted:s.funding_oi_weighted,driver_classification:s.driver_classification,driver_confidence:s.driver_confidence,data_quality:s.data_quality,freshness:{collector_ms:Date.now()-Date.parse(s.observed_at)},source_health:s.sockets,raw:{collector:'websocket-v1'}};
    const {error}=await supabase.from('btc_market_snapshots').insert(row);if(error)throw error;state.lastSupabaseAt=new Date().toISOString();
  }catch(e){addError(e,'persistSupabase')}
}

setInterval(flushClickHouse,750).unref();
setInterval(pollDerivatives,REST_POLL_MS).unref();
setInterval(publishState,STATE_INTERVAL_MS).unref();
setInterval(persistSupabase,SUPABASE_INTERVAL_MS).unref();
pollDerivatives(); publishState();

fastify.get('/health',async()=>({ok:true,now:new Date().toISOString(),collector:state,redis:redis.status,trade_buffer:tradeBuffer.length,book_buffer:bookBuffer.length}));
fastify.get('/state',async()=>{const x=await redis.get('btc:state');return x?JSON.parse(x):{ok:false};});
const port=Number(process.env.PORT||3000);fastify.listen({port,host:'0.0.0.0'}).then(()=>log.info({port},'BTC collector running')).catch(e=>{log.fatal(e);process.exit(1)});

for(const sig of ['SIGTERM','SIGINT'])process.on(sig,async()=>{log.info({sig},'shutting down');try{await flushClickHouse();await redis.quit();await clickhouse.close();}finally{process.exit(0)}});
