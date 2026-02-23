/*
  # Enhance Rocket Rule with Custom Multipliers

  1. Enhancement: Rocket Rule Configuration
    - Add lot_multiplier to rocket_rule settings
    - Add target_multiplier to rocket_rule settings
    - When rocket rule triggers, these multipliers override NFO settings
    
  2. Updated Configuration Schema
    - rocket_rule: {
        "enabled": false,
        "volume_ratio_threshold": 0.70,
        "lot_multiplier": 2,
        "target_multiplier": 3.0
      }
    
  3. Logic Flow
    - When volume_ratio >= threshold
    - Use rocket_rule.lot_multiplier instead of NFO lot_multiplier
    - Use rocket_rule.target_multiplier instead of NFO target_multiplier
    - This allows aggressive position sizing and reward targets on high-volume signals
*/

-- Update the get_default_signal_filters function with enhanced rocket_rule
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
      "lot_multiplier": 2,
      "target_multiplier": 3.0
    }
  }'::jsonb;
$$;

-- Update existing rocket_rule configurations to include multipliers
UPDATE broker_connections
SET signal_filters = jsonb_set(
  jsonb_set(
    signal_filters,
    '{rocket_rule, lot_multiplier}',
    '2'::jsonb,
    true
  ),
  '{rocket_rule, target_multiplier}',
  '3.0'::jsonb,
  true
)
WHERE signal_filters IS NOT NULL 
  AND (signal_filters -> 'rocket_rule') IS NOT NULL
  AND NOT (signal_filters -> 'rocket_rule' ? 'lot_multiplier');

COMMENT ON COLUMN broker_connections.signal_filters IS 'JSONB configuration object defining filter rules for TradingView signals. Rocket rule includes lot_multiplier and target_multiplier for aggressive positioning when volume_ratio threshold is met.';