/*
  # Add Buy/Sell Specific Signal Filters

  1. Enhancement: Direction-Specific Filter Configuration
    - Restructure signal_filters to support separate settings for BUY and SELL
    - Each direction can have its own:
      - trade_grade filters
      - trade_score filters
      - entry_phase filters
      - adx range
      - volume requirements
      - price range
      - dist_ema21_atr range
      - volume_ratio range
      - di_spread range
      - rocket_rule configuration
    
  2. New Structure
    - Global filters: symbols, trade_types, time_filters (apply to both)
    - Direction-specific filters: buy_filters, sell_filters
    - Each direction gets full filter capabilities independently
    
  3. Backward Compatibility
    - Migration will convert existing filters to new structure
    - If old format exists, copy settings to both buy and sell
    
  4. Example New Structure:
    {
      "symbols": { "mode": "whitelist", "list": [] },
      "trade_types": { "allow_buy": true, "allow_sell": true },
      "time_filters": { "enabled": false, ... },
      "buy_filters": {
        "trade_grade": { "enabled": false, "allowed_grades": ["A", "B"] },
        "trade_score": { "enabled": false, "min_score": 7.0 },
        "entry_phase": { "enabled": false, "allowed_phases": ["EARLY", "MID"] },
        "adx": { "enabled": false, "min_value": 25, "max_value": 100 },
        "volume": { "enabled": false, "min_avg_volume_5d": 100000 },
        "price_range": { "enabled": false, "min_price": 0, "max_price": 1000000 },
        "dist_ema21_atr": { "enabled": false, "min_value": -2.0, "max_value": 2.0 },
        "volume_ratio": { "enabled": false, "min_value": 0.5, "max_value": 10.0 },
        "di_spread": { "enabled": false, "min_value": 10, "max_value": 100 },
        "rocket_rule": { "enabled": false, "volume_ratio_threshold": 0.70, "lot_multiplier": 2, "target_multiplier": 3.0 }
      },
      "sell_filters": {
        ... (same structure as buy_filters)
      }
    }
*/

-- Function to get default buy/sell filters
CREATE OR REPLACE FUNCTION get_default_direction_filters()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT '{
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

-- Update the get_default_signal_filters function with new structure
CREATE OR REPLACE FUNCTION get_default_signal_filters()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'symbols', jsonb_build_object(
      'mode', 'whitelist',
      'list', '[]'::jsonb
    ),
    'trade_types', jsonb_build_object(
      'allow_buy', true,
      'allow_sell', true
    ),
    'time_filters', jsonb_build_object(
      'enabled', false,
      'start_time', '09:15',
      'end_time', '15:15',
      'timezone', 'Asia/Kolkata'
    ),
    'buy_filters', get_default_direction_filters(),
    'sell_filters', get_default_direction_filters()
  );
$$;

-- Migrate existing signal_filters to new structure
DO $$
DECLARE
  broker_record RECORD;
  old_filters jsonb;
  new_filters jsonb;
  direction_filters jsonb;
BEGIN
  FOR broker_record IN 
    SELECT id, signal_filters 
    FROM broker_connections 
    WHERE signal_filters IS NOT NULL
  LOOP
    old_filters := broker_record.signal_filters;
    
    -- Check if already in new format (has buy_filters or sell_filters)
    IF old_filters ? 'buy_filters' OR old_filters ? 'sell_filters' THEN
      CONTINUE;
    END IF;
    
    -- Build direction-specific filters from old format
    direction_filters := jsonb_build_object(
      'trade_grade', COALESCE(old_filters -> 'trade_grade', get_default_direction_filters() -> 'trade_grade'),
      'trade_score', COALESCE(old_filters -> 'trade_score', get_default_direction_filters() -> 'trade_score'),
      'entry_phase', COALESCE(old_filters -> 'entry_phase', get_default_direction_filters() -> 'entry_phase'),
      'adx', COALESCE(old_filters -> 'adx', get_default_direction_filters() -> 'adx'),
      'volume', COALESCE(old_filters -> 'volume', get_default_direction_filters() -> 'volume'),
      'price_range', COALESCE(old_filters -> 'price_range', get_default_direction_filters() -> 'price_range'),
      'dist_ema21_atr', COALESCE(old_filters -> 'dist_ema21_atr', get_default_direction_filters() -> 'dist_ema21_atr'),
      'volume_ratio', COALESCE(old_filters -> 'volume_ratio', get_default_direction_filters() -> 'volume_ratio'),
      'di_spread', COALESCE(old_filters -> 'di_spread', get_default_direction_filters() -> 'di_spread'),
      'rocket_rule', COALESCE(old_filters -> 'rocket_rule', get_default_direction_filters() -> 'rocket_rule')
    );
    
    -- Build new structure preserving global filters
    new_filters := jsonb_build_object(
      'symbols', COALESCE(old_filters -> 'symbols', get_default_signal_filters() -> 'symbols'),
      'trade_types', COALESCE(old_filters -> 'trade_types', get_default_signal_filters() -> 'trade_types'),
      'time_filters', COALESCE(old_filters -> 'time_filters', get_default_signal_filters() -> 'time_filters'),
      'buy_filters', direction_filters,
      'sell_filters', direction_filters
    );
    
    -- Update the record
    UPDATE broker_connections
    SET signal_filters = new_filters
    WHERE id = broker_record.id;
    
    RAISE NOTICE 'Migrated filters for broker connection %', broker_record.id;
  END LOOP;
END $$;

COMMENT ON COLUMN broker_connections.signal_filters IS 'JSONB configuration with global filters (symbols, trade_types, time_filters) and direction-specific filters (buy_filters, sell_filters). Each direction can have independent trade_grade, trade_score, entry_phase, adx, volume, price_range, dist_ema21_atr, volume_ratio, di_spread, and rocket_rule settings.';