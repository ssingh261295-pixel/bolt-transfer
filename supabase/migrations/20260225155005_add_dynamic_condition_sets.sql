/*
  # Add Dynamic Condition Sets to Signal Filters

  1. New Feature: 4 Dynamic Condition Sets (Options A, B, C, D)
    - Each direction (BUY/SELL) can have up to 4 condition sets configured
    - A signal passes if it satisfies ANY ONE of the enabled condition sets (OR logic)
    - Each condition set contains:
      * volume_ratio range (min/max)
      * di_spread range (min/max)
      * adx range (min/max)
      * ema_distance range (min/max)
      * enabled flag

  2. Structure
    - buy_filters.condition_sets: array of 4 condition set objects (Option A, B, C, D)
    - sell_filters.condition_sets: array of 4 condition set objects (Option A, B, C, D)
    - Each condition set has: enabled, volume_ratio (min/max), di_spread (min/max), adx (min/max), ema_distance (min/max)

  3. Default Values
    - Option A (BUY): volume_ratio >= 0.40, di_spread 15-100, adx 0-28, ema_distance >= 3
    - Option B (BUY): volume_ratio 0.39-100, di_spread 20-100, adx 0-35, ema_distance 1.2-2.3
    - Option C (SELL): volume_ratio 0.39-100, di_spread 16.5-100, adx 0-35, ema_distance 1.2-2.3
    - Option D (SELL): volume_ratio >= 0.40, di_spread 15-100, adx 0-35, ema_distance >= 3.0

  4. Filter Evaluation Logic
    - If condition_sets exist and at least one is enabled:
      * Signal must pass at least ONE enabled condition set (OR logic)
    - If no condition sets are configured or all disabled:
      * Falls back to individual filter checks (backward compatible)

  5. Example condition_sets structure:
    [
      {
        "name": "Option A",
        "enabled": false,
        "volume_ratio": { "min": 0.40, "max": 100 },
        "di_spread": { "min": 15, "max": 100 },
        "adx": { "min": 0, "max": 28 },
        "ema_distance": { "min": 3.0, "max": 100 }
      },
      {
        "name": "Option B",
        "enabled": false,
        "volume_ratio": { "min": 0.39, "max": 100 },
        "di_spread": { "min": 20, "max": 100 },
        "adx": { "min": 0, "max": 35 },
        "ema_distance": { "min": 1.2, "max": 2.3 }
      },
      ... (Options C and D)
    ]
*/

-- Update the get_default_direction_filters function to include condition_sets
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
    },
    "condition_sets": []
  }'::jsonb;
$$;

-- Function to get default BUY condition sets
CREATE OR REPLACE FUNCTION get_default_buy_condition_sets()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT '[
    {
      "name": "Option A",
      "enabled": false,
      "volume_ratio": { "min": 0.40, "max": 100 },
      "di_spread": { "min": 15, "max": 100 },
      "adx": { "min": 0, "max": 28 },
      "ema_distance": { "min": 3.0, "max": 100 }
    },
    {
      "name": "Option B",
      "enabled": false,
      "volume_ratio": { "min": 0.39, "max": 100 },
      "di_spread": { "min": 20, "max": 100 },
      "adx": { "min": 0, "max": 35 },
      "ema_distance": { "min": 1.2, "max": 2.3 }
    }
  ]'::jsonb;
$$;

-- Function to get default SELL condition sets
CREATE OR REPLACE FUNCTION get_default_sell_condition_sets()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT '[
    {
      "name": "Option C",
      "enabled": false,
      "volume_ratio": { "min": 0.39, "max": 100 },
      "di_spread": { "min": 16.5, "max": 100 },
      "adx": { "min": 0, "max": 35 },
      "ema_distance": { "min": 1.2, "max": 2.3 }
    },
    {
      "name": "Option D",
      "enabled": false,
      "volume_ratio": { "min": 0.40, "max": 100 },
      "di_spread": { "min": 15, "max": 100 },
      "adx": { "min": 0, "max": 35 },
      "ema_distance": { "min": 3.0, "max": 100 }
    }
  ]'::jsonb;
$$;

-- Migrate existing broker_connections to add condition_sets
DO $$
DECLARE
  broker_record RECORD;
  updated_filters jsonb;
  buy_filters jsonb;
  sell_filters jsonb;
BEGIN
  FOR broker_record IN
    SELECT id, signal_filters
    FROM broker_connections
    WHERE signal_filters IS NOT NULL
  LOOP
    -- Get current buy and sell filters
    buy_filters := broker_record.signal_filters -> 'buy_filters';
    sell_filters := broker_record.signal_filters -> 'sell_filters';

    -- Add condition_sets to buy_filters if not present
    IF buy_filters IS NOT NULL AND NOT (buy_filters ? 'condition_sets') THEN
      buy_filters := buy_filters || jsonb_build_object('condition_sets', get_default_buy_condition_sets());
    END IF;

    -- Add condition_sets to sell_filters if not present
    IF sell_filters IS NOT NULL AND NOT (sell_filters ? 'condition_sets') THEN
      sell_filters := sell_filters || jsonb_build_object('condition_sets', get_default_sell_condition_sets());
    END IF;

    -- Update the signal_filters
    updated_filters := broker_record.signal_filters || jsonb_build_object(
      'buy_filters', buy_filters,
      'sell_filters', sell_filters
    );

    UPDATE broker_connections
    SET signal_filters = updated_filters
    WHERE id = broker_record.id;

    RAISE NOTICE 'Added condition_sets to broker connection %', broker_record.id;
  END LOOP;
END $$;

COMMENT ON COLUMN broker_connections.signal_filters IS 'JSONB configuration with global filters (symbols, trade_types, time_filters) and direction-specific filters (buy_filters, sell_filters). Each direction can have independent filters and condition_sets. Condition sets allow defining multiple filter combinations where ANY ONE passing allows the signal through (OR logic).';