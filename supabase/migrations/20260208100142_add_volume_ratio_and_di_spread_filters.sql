/*
  # Add Volume Ratio and DI Spread Filters

  1. New Filters
    - Volume Ratio: Calculated as volume/vol_avg_5d with min and max values
    - DI Spread: Calculated as absolute difference between di_plus and di_minus with min and max values
    
  2. Filter Configuration
    - volume_ratio: { "enabled": false, "min_value": 0.0, "max_value": 10.0 }
    - di_spread: { "enabled": false, "min_value": 0, "max_value": 100 }
    
  3. Use Cases
    - Volume Ratio: Filter signals based on current volume compared to 5-day average (e.g., require 1.5x average volume)
    - DI Spread: Filter signals based on strength of directional movement (wider spread = stronger trend)
*/

-- Update the get_default_signal_filters function with new filters
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
    },
    "volume_ratio": {
      "enabled": false,
      "min_value": 0.0,
      "max_value": 10.0
    },
    "di_spread": {
      "enabled": false,
      "min_value": 0,
      "max_value": 100
    }
  }'::jsonb;
$$;

-- Add volume_ratio filter to existing broker_connections if missing
UPDATE broker_connections
SET signal_filters = signal_filters || '{"volume_ratio": {"enabled": false, "min_value": 0.0, "max_value": 10.0}}'::jsonb
WHERE signal_filters IS NOT NULL 
  AND NOT (signal_filters ? 'volume_ratio');

-- Add di_spread filter to existing broker_connections if missing
UPDATE broker_connections
SET signal_filters = signal_filters || '{"di_spread": {"enabled": false, "min_value": 0, "max_value": 100}}'::jsonb
WHERE signal_filters IS NOT NULL 
  AND NOT (signal_filters ? 'di_spread');

COMMENT ON COLUMN broker_connections.signal_filters IS 'JSONB configuration object defining filter rules for TradingView signals. Includes volume_ratio (volume/vol_avg_5d) and di_spread (abs(di_plus - di_minus)) filters for advanced signal filtering.';