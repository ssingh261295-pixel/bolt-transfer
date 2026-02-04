/*
  # Add dist_ema21_atr Filter and Fix Entry Phase

  1. New Filter
    - Add dist_ema21_atr filter with min_value and max_value
    - Allows filtering signals based on distance from EMA21 in ATR units
    
  2. Entry Phase Fix
    - Add 'MID' to allowed_phases alongside EARLY, OPTIMAL, LATE
    - Fixes issue where signals with entry_phase: MID were being rejected

  3. Schema Changes
    - dist_ema21_atr: { "enabled": false, "min_value": -10.0, "max_value": 10.0 }
    - entry_phase: { "enabled": false, "allowed_phases": ["EARLY", "MID", "OPTIMAL", "LATE"] }
*/

-- Update the get_default_signal_filters function with new dist_ema21_atr filter and MID phase
CREATE OR REPLACE FUNCTION get_default_signal_filters()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT '{
    "symbols": {
      "mode": "whitelist",
      "list": []
    },
    "trade_types": {
      "allow_buy": true,
      "allow_sell": true
    },
    "time_filters": {
      "enabled": false,
      "start_time": "09:15",
      "end_time": "15:15",
      "timezone": "Asia/Kolkata"
    },
    "trade_grade": {
      "enabled": false,
      "allowed_grades": ["A", "B", "C", "D"]
    },
    "trade_score": {
      "enabled": false,
      "min_score": 5.0
    },
    "entry_phase": {
      "enabled": false,
      "allowed_phases": ["EARLY", "MID", "OPTIMAL", "LATE"]
    },
    "adx": {
      "enabled": false,
      "min_value": 0,
      "max_value": 100
    },
    "volume": {
      "enabled": false,
      "min_avg_volume_5d": 0
    },
    "price_range": {
      "enabled": false,
      "min_price": 0,
      "max_price": 1000000
    },
    "dist_ema21_atr": {
      "enabled": false,
      "min_value": -10.0,
      "max_value": 10.0
    }
  }'::jsonb;
$$;

-- Update existing broker_connections to add MID to entry_phase if not present
UPDATE broker_connections
SET signal_filters = jsonb_set(
  signal_filters,
  '{entry_phase,allowed_phases}',
  CASE 
    WHEN signal_filters->'entry_phase'->'allowed_phases' ? 'MID' THEN
      signal_filters->'entry_phase'->'allowed_phases'
    ELSE
      (
        SELECT jsonb_agg(phase)
        FROM (
          SELECT jsonb_array_elements_text(signal_filters->'entry_phase'->'allowed_phases') as phase
          UNION
          SELECT 'MID'
        ) phases
      )
  END
)
WHERE signal_filters IS NOT NULL 
  AND signal_filters ? 'entry_phase'
  AND signal_filters->'entry_phase' ? 'allowed_phases'
  AND NOT (signal_filters->'entry_phase'->'allowed_phases' ? 'MID');

-- Add dist_ema21_atr filter to existing broker_connections if missing
UPDATE broker_connections
SET signal_filters = signal_filters || '{"dist_ema21_atr": {"enabled": false, "min_value": -10.0, "max_value": 10.0}}'::jsonb
WHERE signal_filters IS NOT NULL 
  AND NOT (signal_filters ? 'dist_ema21_atr');

COMMENT ON COLUMN broker_connections.signal_filters IS 'JSONB configuration object defining filter rules for TradingView signals. Includes dist_ema21_atr for filtering by distance from EMA21 in ATR units. Entry phase now supports EARLY, MID, OPTIMAL, and LATE.';