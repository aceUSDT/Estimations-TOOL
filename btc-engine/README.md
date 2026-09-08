# BTC Global Intelligence — production data plane

This directory contains the persistent market-data plane for the BTC Global Intelligence engine.

## Runtime architecture

- **Collector:** one always-on Node.js service using exchange WebSockets.
- **Redis:** low-latency current state, rolling CVD buckets, order-book snapshots, pub/sub.
- **ClickHouse:** raw trades, order-book snapshots and materialized minute-flow history.
- **Supabase:** lower-frequency intelligence snapshots, source health, setups, alerts and engine configuration.
- **CoinGlass:** enrichment/validation layer; credential must remain server-side in Supabase Vault or deployment secrets.

## WebSocket inputs

The collector currently implements:

- Binance BTCUSDT spot aggTrade + depth20@100ms.
- Binance BTCUSDT USDT-perpetual aggTrade + depth20@100ms.
- Bybit BTCUSDT spot public trades + orderbook.50.
- Bybit BTCUSDT linear-perpetual public trades + orderbook.50.
- OKX BTC-USDT spot trades + books5.
- OKX BTC-USDT-SWAP books5.

OKX perpetual trades are intentionally excluded from USD CVD until instrument contract-value normalization is loaded. That prevents incorrect CVD from being treated as valid data.

## Redis keys

- `btc:state` — normalized current state, TTL 10 seconds.
- `btc:state:updates` — pub/sub channel.
- `btc:flow:agg:spot:<minute_ms>` — aggregate spot flow bucket.
- `btc:flow:agg:perp:<minute_ms>` — aggregate perp flow bucket.
- `btc:flow:<venue>:<market_type>:<minute_ms>` — venue flow bucket.
- `btc:book:<venue>:<market_type>` — latest order-book snapshot.
- `btc:derivatives:all` — current exchange OI/funding snapshot.

## ClickHouse retention

- Raw trades: 180 days.
- Raw order-book snapshots: 30 days.
- Materialized minute flow: 365 days.
- Collector health: 90 days.

Retention is intentionally bounded. Increase it only after estimating storage cost and query needs.

## Data integrity rules

1. Never classify REST polling as sub-second WebSocket data.
2. Each WebSocket has LIVE/STALE/DISCONNECTED state and a last-message timestamp.
3. The Redis state expires quickly; missing state must be treated as unavailable.
4. CVD is derived only from streams whose trade quantity is correctly normalized to BTC/USD notional.
5. Liquidation heatmaps remain modelled/estimated positioning, separate from executed liquidation events.
6. Supabase snapshots are durable intelligence records, not the raw tick store.

## Local run

```bash
cd btc-engine
docker compose up --build
```

Collector health: `GET http://localhost:3000/health`

Current Redis-computed state: `GET http://localhost:3000/state`

## Production environment

Required collector variables:

```text
REDIS_URL
CLICKHOUSE_URL
CLICKHOUSE_USER
CLICKHOUSE_PASSWORD
CLICKHOUSE_DB=btc
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Do not commit any secret values.

## Production deployment sequence

1. Create the dedicated BTC Supabase project and apply the BTC schema migration.
2. Store CoinGlass in that project's Vault.
3. Provision Redis.
4. Provision ClickHouse and run `collector/clickhouse/init.sql` (collector startup also bootstraps it).
5. Deploy `collector/` as an always-on Docker service.
6. Configure the collector with the dedicated BTC Supabase service-role key, Redis URL and ClickHouse credentials.
7. Verify `/health`, Redis `btc:state`, ClickHouse inserts and Supabase durable minute snapshots.
8. Point the ChatGPT BTC automation at the dedicated project.
9. Only after successful validation, disable the legacy minute collector in the old Orderflow project and remove the old BTC objects.

The old project must not be cleaned up until the new project has received live snapshots and historical migration has been validated.
