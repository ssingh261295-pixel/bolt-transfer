/*
  # Add Rocket Rule to Signal Filters

  1. New Feature: Rocket Rule
    - Triggers special high-conviction trades when volume ratio meets threshold
    - Uses dynamic lot sizing from NFO symbol settings
    - Applies reward multiplier from NFO symbol settings
    
  2. Configuration
    - rocket_rule: {
        "enabled": false,
        "volume_ratio_threshold": 0.70,
        "use_nfo_lot_size": true,
        "use_nfo_multiplier": true
      }
    
  3. Use Cases
    - When volume_ratio >= threshold (e.g., 0.70), order uses lot_size from nfo_symbol_settings
    - Reward (target/stoploss) uses reward_multiplier from nfo_symbol_settings
    - Allows aggressive entries on high-volume breakouts with custom sizing per symbol
    
  4. Integration
    - Works alongside existing signal filters (doesn't replace them)
    - Only applies to NFO instruments with configured symbol settings
    - Falls back to normal order parameters if NFO settings not found
*/

-- Update the get_default_signal_filters function with rocket_rule
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
    },
    "rocket_rule": {
      "enabled": false,
      "volume_ratio_threshold": 0.70,
      "use_nfo_lot_size": true,
      "use_nfo_multiplier": true
    }
  }'::jsonb;
$$;

-- Add rocket_rule to existing broker_connections if missing
UPDATE broker_connections
SET signal_filters = signal_filters || '{"rocket_rule": {"enabled": false, "volume_ratio_threshold": 0.70, "use_nfo_lot_size": true, "use_nfo_multiplier": true}}'::jsonb
WHERE signal_filters IS NOT NULL 
  AND NOT (signal_filters ? 'rocket_rule');

COMMENT ON COLUMN broker_connections.signal_filters IS 'JSONB configuration object defining filter rules for TradingView signals. Includes rocket_rule for high-conviction trades based on volume_ratio threshold with dynamic lot sizing and multipliers from NFO symbol settings.';