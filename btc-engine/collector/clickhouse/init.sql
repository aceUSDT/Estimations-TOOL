CREATE DATABASE IF NOT EXISTS btc;

CREATE TABLE IF NOT EXISTS btc.raw_trades
(
    event_time DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC'),
    event_time_ms UInt64,
    venue LowCardinality(String),
    market_type LowCardinality(String),
    symbol LowCardinality(String),
    price Float64,
    qty Float64,
    notional_usd Float64,
    side Enum8('buy' = 1, 'sell' = -1),
    trade_id String
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(event_time)
ORDER BY (market_type, venue, symbol, event_time, trade_id)
TTL event_time + INTERVAL 3 HOUR DELETE
SETTINGS index_granularity = 8192;

ALTER TABLE btc.raw_trades MODIFY TTL event_time + INTERVAL 3 HOUR DELETE;

-- ONE-TIME RESET: the initial test collector filled the 500 MB Railway volume.
-- This is removed immediately after the first successful cleanup deployment.
TRUNCATE TABLE btc.raw_trades SYNC;

-- Keep sub-second books live in Redis, but do not persist every raw depth message
-- on the small ClickHouse volume. A sampled liquidity-history table will replace this.
DROP TABLE IF EXISTS btc.orderbook_snapshots SYNC;

CREATE TABLE btc.orderbook_snapshots
(
    event_time DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC'),
    event_time_ms UInt64,
    venue LowCardinality(String),
    market_type LowCardinality(String),
    symbol LowCardinality(String),
    sequence String,
    bid_prices Array(Float64),
    bid_sizes Array(Float64),
    ask_prices Array(Float64),
    ask_sizes Array(Float64),
    best_bid Nullable(Float64),
    best_ask Nullable(Float64),
    spread_bps Nullable(Float64)
)
ENGINE = Null;

CREATE TABLE IF NOT EXISTS btc.minute_flow
(
    minute DateTime('UTC'),
    venue LowCardinality(String),
    market_type LowCardinality(String),
    symbol LowCardinality(String),
    taker_buy_usd Float64,
    taker_sell_usd Float64,
    delta_usd Float64,
    trades UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(minute)
ORDER BY (market_type, venue, symbol, minute)
TTL minute + INTERVAL 365 DAY DELETE;

CREATE MATERIALIZED VIEW IF NOT EXISTS btc.minute_flow_mv
TO btc.minute_flow
AS
SELECT
    toStartOfMinute(event_time) AS minute,
    venue,
    market_type,
    symbol,
    sumIf(notional_usd, side = 'buy') AS taker_buy_usd,
    sumIf(notional_usd, side = 'sell') AS taker_sell_usd,
    sum(if(side = 'buy', notional_usd, -notional_usd)) AS delta_usd,
    count() AS trades
FROM btc.raw_trades
GROUP BY minute, venue, market_type, symbol;

CREATE TABLE IF NOT EXISTS btc.collector_health
(
    observed_at DateTime64(3, 'UTC'),
    service String,
    status LowCardinality(String),
    payload String
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(observed_at)
ORDER BY (service, observed_at)
TTL observed_at + INTERVAL 30 DAY DELETE;

ALTER TABLE btc.collector_health MODIFY TTL observed_at + INTERVAL 30 DAY DELETE;
